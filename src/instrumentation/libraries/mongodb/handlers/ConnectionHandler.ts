import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { SpanUtils, SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";
import { handleRecordMode, handleReplayMode } from "../../../core/utils/modeUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../../core/utils";

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
              return this.handleReplayConnect(spanInfo, thisArg);
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
      return handleReplayMode({
        noOpRequestHandler: () => {
          return Promise.resolve();
        },
        isServerRequest: false,
        replayModeHandler: () => {
          logger.debug(`[${this.instrumentationName}] Replaying MongoDB close (no-op)`);
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
    const connectPromise = original.apply(thisArg, args) as Promise<any>;

    return connectPromise
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

  private handleReplayConnect(spanInfo: SpanInfo, thisArg: any): Promise<any> {
    logger.debug(
      `[${this.instrumentationName}] Replaying MongoDB connection (skipping TCP connect)`,
    );

    try {
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: { connected: true, replayed: true },
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch (error) {
      logger.error(`[${this.instrumentationName}] Error ending replay connect span:`, error);
    }

    return Promise.resolve(thisArg);
  }

  private handleRecordClose(
    spanInfo: SpanInfo,
    original: Function,
    thisArg: any,
    args: any[],
  ): Promise<void> {
    const closePromise = original.apply(thisArg, args) as Promise<void>;

    return closePromise
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
