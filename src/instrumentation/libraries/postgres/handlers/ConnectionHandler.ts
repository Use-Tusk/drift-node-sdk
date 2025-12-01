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
    private wrapSqlInstance: (sqlInstance: any) => any,
  ) {}

  handlePostgresConnection(originalFunction: Function, args: any[]): any {
    // Extract connection parameters from args
    // postgres() signature: postgres(url, options?) or postgres(options)
    const connectionString = typeof args[0] === "string" ? args[0] : undefined;
    const options = typeof args[0] === "string" ? args[1] : args[0];

    const inputValue = {
      connectionString: connectionString,
      options: options,
    };

    // Handle replay mode
    if (this.mode === TuskDriftMode.REPLAY) {
      return handleReplayMode({
        noOpRequestHandler: () => {
          // Mock SQL function that looks like a postgres client
          const mockSql: any = () =>
            Promise.resolve(Object.assign([], { count: 0, command: null }));

          // Add essential methods
          mockSql.unsafe = () => Promise.resolve(Object.assign([], { count: 0, command: null }));
          mockSql.begin = () => Promise.resolve();
          mockSql.end = () => Promise.resolve();
          mockSql.file = () => Promise.resolve(Object.assign([], { count: 0, command: null }));
          mockSql.reserve = () => Promise.resolve(mockSql); // Returns itself like a reserved connection
          mockSql.listen = () =>
            Promise.resolve({ state: { state: "I" }, unlisten: async () => {} });
          mockSql.notify = () => Promise.resolve();

          return mockSql; // Returns a function-like object, not a Promise
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => {
              const sqlInstance = originalFunction(...args);
              return this.wrapSqlInstance(sqlInstance);
            },
            {
              name: "postgres.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.instrumentationName,
              inputValue: inputValue,
              isPreAppStart: this.isAppReady() ? false : true,
            },
            (spanInfo) => {
              return this.handleReplayConnect(originalFunction, args);
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => {
          const sqlInstance = originalFunction(...args);
          return this.wrapSqlInstance(sqlInstance);
        },
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => {
              const sqlInstance = originalFunction(...args);
              return this.wrapSqlInstance(sqlInstance);
            },
            {
              name: "postgres.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.instrumentationName,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this.handleRecordConnect(spanInfo, originalFunction, args);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      return originalFunction(...args);
    }
  }

  private handleRecordConnect(spanInfo: SpanInfo, originalFunction: Function, args: any[]): any {
    const sqlInstance = originalFunction(...args);
    const wrappedInstance = this.wrapSqlInstance(sqlInstance);

    try {
      logger.debug(
        `[PostgresInstrumentation] Postgres connection created successfully (${SpanUtils.getTraceInfo()})`,
      );
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: { connected: true },
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch (error) {
      logger.error(`[PostgresInstrumentation] error adding span attributes:`, error);
    }

    return wrappedInstance;
  }

  private handleReplayConnect(originalFunction: Function, args: any[]): any {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres connection`);

    // In replay mode, we still create the sql instance but wrap it
    // The actual queries will be mocked when they're executed
    try {
      const sqlInstance = originalFunction(...args);
      const wrappedInstance = this.wrapSqlInstance(sqlInstance);

      return wrappedInstance;
    } catch (error: any) {
      logger.debug(
        `[PostgresInstrumentation] Postgres connection error in replay: ${error.message}`,
      );

      throw error;
    }
  }
}
