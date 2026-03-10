import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { SpanUtils, SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";
import { handleRecordMode, handleReplayMode } from "../../../core/utils/modeUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../../core/utils";
import { TdFakeTopology } from "../mocks/FakeTopology";

export class ConnectionHandler {
  constructor(
    private mode: TuskDriftMode,
    private instrumentationName: string,
    private isAppReady: () => boolean,
  ) {}

  /**
   * Handle MongoClient.connect() calls.
   * - RECORD: Call original connect, create span recording connection.
   * - REPLAY: Skip TCP connection, resolve immediately with the client.
   * - DISABLED: Passthrough.
   */
  handleConnect(original: Function, thisArg: any, args: any[]): any {
    const inputValue = this.extractConnectInputValue(thisArg);

    if (this.mode === TuskDriftMode.REPLAY) {
      return handleReplayMode({
        noOpRequestHandler: () => {
          return Promise.resolve(thisArg);
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => Promise.resolve(thisArg),
            {
              name: "mongodb.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.MONGODB,
              packageName: "mongodb",
              instrumentationName: this.instrumentationName,
              inputValue: inputValue,
              isPreAppStart: !this.isAppReady(),
            },
            (spanInfo: SpanInfo) => {
              return this.handleReplayConnect(spanInfo, thisArg, args);
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => original.apply(thisArg, args),
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => original.apply(thisArg, args),
            {
              name: "mongodb.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.MONGODB,
              packageName: "mongodb",
              instrumentationName: this.instrumentationName,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo: SpanInfo) => {
              return this.handleRecordConnect(spanInfo, original, thisArg, args);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      return original.apply(thisArg, args);
    }
  }

  /**
   * Handle MongoClient.close() calls.
   * - RECORD: Call original close, create span.
   * - REPLAY: No-op (no real connection to close).
   * - DISABLED: Passthrough.
   */
  handleClose(original: Function, thisArg: any, args: any[]): any {
    if (this.mode === TuskDriftMode.REPLAY) {
      const callback =
        args.length > 0 && typeof args[args.length - 1] === "function"
          ? (args[args.length - 1] as (error?: any) => void)
          : undefined;
      return handleReplayMode({
        noOpRequestHandler: () => {
          if (callback) callback();
          return Promise.resolve();
        },
        isServerRequest: false,
        replayModeHandler: () => {
          logger.debug(`[${this.instrumentationName}] Replaying MongoDB close (no-op)`);
          if (callback) callback();
          return Promise.resolve();
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => original.apply(thisArg, args),
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => original.apply(thisArg, args),
            {
              name: "mongodb.close",
              kind: SpanKind.CLIENT,
              submodule: "client-close",
              packageType: PackageType.MONGODB,
              packageName: "mongodb",
              instrumentationName: this.instrumentationName,
              inputValue: {},
              isPreAppStart,
              stopRecordingChildSpans: true,
            },
            (spanInfo: SpanInfo) => {
              return this.handleRecordClose(spanInfo, original, thisArg, args);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      return original.apply(thisArg, args);
    }
  }

  /**
   * Handle MongoClient.db() calls.
   * db() is synchronous and purely in-memory — creates a Db object referencing
   * the client. No network I/O, no span needed. Passthrough in all modes.
   */
  handleDb(original: Function, thisArg: any, args: any[]): any {
    return original.apply(thisArg, args);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleRecordConnect(
    spanInfo: SpanInfo,
    original: Function,
    thisArg: any,
    args: any[],
  ): Promise<any> {
    const connectResult = original.apply(thisArg, args) as Promise<any> | any;
    const isPromiseLike = connectResult && typeof connectResult.then === "function";

    // mongodb@4 can still exercise callback-style internals that return void.
    // In that case, avoid crashing on ".then" and record a best-effort span.
    if (!isPromiseLike) {
      try {
        logger.debug(
          `[${this.instrumentationName}] MongoDB connect returned a non-promise value; recording best-effort span`,
        );
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: { connected: true },
        });
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
      } catch (error) {
        logger.error(`[${this.instrumentationName}] Error ending non-promise connect span:`, error);
      }
      return Promise.resolve(connectResult);
    }

    return (connectResult as Promise<any>)
      .then((result: any) => {
        try {
          logger.debug(
            `[${this.instrumentationName}] MongoDB connection created successfully (${SpanUtils.getTraceInfo()})`,
          );
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { connected: true },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(
            `[${this.instrumentationName}] Error adding span attributes for connect:`,
            error,
          );
        }
        return result;
      })
      .catch((error: any) => {
        try {
          logger.error(
            `[${this.instrumentationName}] MongoDB connection failed (${SpanUtils.getTraceInfo()}):`,
            error,
          );
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { error: error?.message || "Unknown error" },
          });
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error?.message || "Connection failed",
          });
        } catch (spanError) {
          logger.error(
            `[${this.instrumentationName}] Error recording span for connect error:`,
            spanError,
          );
        }
        throw error;
      });
  }

  private handleReplayConnect(spanInfo: SpanInfo, thisArg: any, args: any[]): Promise<any> {
    logger.debug(
      `[${this.instrumentationName}] Replaying MongoDB connection (skipping TCP connect)`,
    );

    this.injectFakeTopology(thisArg);

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: { connected: true, replayed: true },
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch (error) {
      logger.error(`[${this.instrumentationName}] Error ending replay connect span:`, error);
    }

    const callback =
      args.length > 0 && typeof args[args.length - 1] === "function"
        ? (args[args.length - 1] as (error: any, client?: any) => void)
        : undefined;

    if (callback) {
      // mongodb@4 + mongoose uses callback-style MongoClient.connect().
      // Replay must invoke the callback to unblock openUri() promise flow.
      callback(null, thisArg);
      return Promise.resolve(thisArg);
    }

    return Promise.resolve(thisArg);
  }

  private injectFakeTopology(client: any): void {
    const fakeTopology = new TdFakeTopology();
    if (!client) return;

    if (!client.topology) {
      client.topology = fakeTopology;
    }

    if (client.s && !client.s.topology) {
      client.s.topology = fakeTopology;
    }

    // Keep replay client in a "connected-enough" state for higher-level libraries
    // that inspect internal MongoClient flags before issuing operations.
    if (client.s) {
      if (client.s.hasBeenClosed === true) {
        client.s.hasBeenClosed = false;
      }
      if (client.s.isMongoClient === false) {
        client.s.isMongoClient = true;
      }
    }
  }

  private handleRecordClose(
    spanInfo: SpanInfo,
    original: Function,
    thisArg: any,
    args: any[],
  ): Promise<void> {
    const closeResult = original.apply(thisArg, args) as Promise<void> | any;
    const isPromiseLike = closeResult && typeof closeResult.then === "function";

    if (!isPromiseLike) {
      try {
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: { closed: true },
        });
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
      } catch (error) {
        logger.error(`[${this.instrumentationName}] Error ending non-promise close span:`, error);
      }
      return Promise.resolve();
    }

    return (closeResult as Promise<void>)
      .then(() => {
        try {
          logger.debug(
            `[${this.instrumentationName}] MongoDB connection closed successfully (${SpanUtils.getTraceInfo()})`,
          );
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { closed: true },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(
            `[${this.instrumentationName}] Error adding span attributes for close:`,
            error,
          );
        }
      })
      .catch((error: any) => {
        try {
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { error: error?.message || "Unknown error" },
          });
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error?.message || "Close failed",
          });
        } catch (spanError) {
          logger.error(
            `[${this.instrumentationName}] Error recording span for close error:`,
            spanError,
          );
        }
        throw error;
      });
  }

  /**
   * Sanitize a MongoDB connection string by removing password credentials.
   */
  private sanitizeConnectionString(connectionString: string): string {
    try {
      const url = new URL(connectionString);
      if (url.password) {
        url.password = "***";
      }
      return url.toString();
    } catch {
      return connectionString.replace(/(:\/\/[^:]+):([^@]+)@/, "$1:***@");
    }
  }

  /**
   * Extract the connection input value from a MongoClient instance.
   * The connection string is stored in this.s.url (set by the MongoClient constructor).
   */
  private extractConnectInputValue(mongoClient: any): Record<string, unknown> {
    const rawUrl = mongoClient?.s?.url;
    const sanitizedUrl = rawUrl ? this.sanitizeConnectionString(rawUrl) : undefined;

    return {
      connectionString: sanitizedUrl,
    };
  }
}
