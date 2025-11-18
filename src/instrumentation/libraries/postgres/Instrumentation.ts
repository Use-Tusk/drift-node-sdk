import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  PostgresModuleExports,
  PostgresClientInputValue,
  PostgresInstrumentationConfig,
  PostgresRow,
  PostgresConvertedResult,
  PostgresReturnType,
  PostgresOutputValueType,
  isPostgresOutputValueType,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger, isEsm } from "../../../core/utils";

export class PostgresInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "PostgresInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: PostgresInstrumentationConfig = {}) {
    super("postgres", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "postgres",
        supportedVersions: ["3.*"],
        patch: (moduleExports: PostgresModuleExports) => this._patchPostgresModule(moduleExports),
      }),
    ];
  }

  private _patchPostgresModule(postgresModule: PostgresModuleExports): PostgresModuleExports {
    logger.debug(`[PostgresInstrumentation] Patching Postgres module in ${this.mode} mode`);

    if (this.isModulePatched(postgresModule)) {
      logger.debug(`[PostgresInstrumentation] Postgres module already patched, skipping`);
      return postgresModule;
    }

    const self = this;

    if (isEsm(postgresModule)) {
      // ESM Case: Default function exports are in the .default property
      // In ESM: import postgres from 'postgres' gives { default: function(...) {...} }
      // We need to wrap moduleExports.default, not the module itself
      logger.debug(`[PostgresInstrumentation] Wrapping ESM default export`);
      this._wrap(postgresModule, "default", (originalFunction: any) => {
        return function (this: any, ...args: any[]) {
          return self._handlePostgresConnection(originalFunction, args);
        };
      });
    } else {
      // CommonJS Case: The module IS the function directly
      // In CJS: const postgres = require('postgres') gives the function directly
      // We need to create a wrapped function and return it
      logger.debug(`[PostgresInstrumentation] Module is a function (CJS style)`);
      const originalFunction = postgresModule as any;

      const wrappedFunction = function (...args: any[]) {
        logger.debug(`[PostgresInstrumentation] Wrapped postgres() (CJS) called with args:`, args);
        return self._handlePostgresConnection(originalFunction, args);
      } as any;

      // Copy ALL properties from original function to wrapped function
      // This ensures the wrapped function has all the same properties (like .sql, etc.)
      Object.setPrototypeOf(wrappedFunction, Object.getPrototypeOf(originalFunction));
      Object.defineProperty(wrappedFunction, "name", { value: originalFunction.name });

      // Copy all enumerable properties
      for (const key in originalFunction) {
        if (originalFunction.hasOwnProperty(key)) {
          wrappedFunction[key] = originalFunction[key];
        }
      }

      // Copy all own property descriptors (for non-enumerable properties)
      Object.getOwnPropertyNames(originalFunction).forEach((key) => {
        if (key !== "prototype" && key !== "length" && key !== "name") {
          const descriptor = Object.getOwnPropertyDescriptor(originalFunction, key);
          if (descriptor) {
            Object.defineProperty(wrappedFunction, key, descriptor);
          }
        }
      });

      postgresModule = wrappedFunction;
    }

    // TODO: need to test that this actually gets patched in ESM mode
    // Also patch the sql function if it exists as a named export
    if (postgresModule.sql && typeof postgresModule.sql === "function") {
      this._wrap(postgresModule, "sql", this._getSqlPatchFn());
      logger.debug(`[PostgresInstrumentation] Wrapped sql function`);
    }

    this.markModuleAsPatched(postgresModule);
    logger.debug(`[PostgresInstrumentation] Postgres module patching complete`);

    return postgresModule;
  }

  private _handlePostgresConnection(originalFunction: Function, args: any[]): any {
    // Extract connection parameters from args
    // postgres() signature: postgres(url, options?) or postgres(options)
    const connectionString = typeof args[0] === "string" ? args[0] : undefined;
    const options = typeof args[0] === "string" ? args[1] : args[0];

    const inputValue = {
      connectionString: connectionString
        ? this._sanitizeConnectionString(connectionString)
        : undefined,
      options: options ? this._sanitizeConnectionOptions(options) : undefined,
    };

    // Handle replay mode
    if (this.mode === TuskDriftMode.REPLAY) {
      return handleReplayMode({
        noOpRequestHandler: () => {
          try {
            const sqlInstance = originalFunction(...args);
            const wrappedInstance = this._wrapSqlInstance(sqlInstance);

            return wrappedInstance;
          } catch (error: any) {
            logger.debug(
              `[PostgresInstrumentation] Postgres connection error in replay: ${error.message}`,
            );

            throw error;
          }
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => {
              const sqlInstance = originalFunction(...args);
              return this._wrapSqlInstance(sqlInstance);
            },
            {
              name: "postgres.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart: false,
            },
            (spanInfo) => {
              return this._handleReplayConnect(originalFunction, args);
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => {
          const sqlInstance = originalFunction(...args);
          return this._wrapSqlInstance(sqlInstance);
        },
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => {
              const sqlInstance = originalFunction(...args);
              return this._wrapSqlInstance(sqlInstance);
            },
            {
              name: "postgres.connect",
              kind: SpanKind.CLIENT,
              submodule: "connect",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleRecordConnect(spanInfo, originalFunction, args);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      return originalFunction(...args);
    }
  }

  private _sanitizeConnectionString(connectionString: string): string {
    try {
      // Remove password from connection string for security
      const url = new URL(connectionString);
      if (url.password) {
        url.password = "***";
      }
      return url.toString();
    } catch {
      return "[INVALID_URL]";
    }
  }

  private _sanitizeConnectionOptions(options: any): any {
    if (!options || typeof options !== "object") {
      return options;
    }

    const sanitized = { ...options };

    // Remove sensitive fields
    if (sanitized.password) {
      sanitized.password = "***";
    }
    if (sanitized.ssl && typeof sanitized.ssl === "object") {
      sanitized.ssl = { ...sanitized.ssl };
      if (sanitized.ssl.key) sanitized.ssl.key = "***";
      if (sanitized.ssl.cert) sanitized.ssl.cert = "***";
      if (sanitized.ssl.ca) sanitized.ssl.ca = "***";
    }

    return sanitized;
  }

  private _handleRecordConnect(spanInfo: SpanInfo, originalFunction: Function, args: any[]): any {
    const sqlInstance = originalFunction(...args);
    const wrappedInstance = this._wrapSqlInstance(sqlInstance);

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

  private _handleReplayConnect(originalFunction: Function, args: any[]): any {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres connection`);

    // In replay mode, we still create the sql instance but wrap it
    // The actual queries will be mocked when they're executed
    try {
      const sqlInstance = originalFunction(...args);
      const wrappedInstance = this._wrapSqlInstance(sqlInstance);

      return wrappedInstance;
    } catch (error: any) {
      logger.debug(
        `[PostgresInstrumentation] Postgres connection error in replay: ${error.message}`,
      );

      throw error;
    }
  }

  private _wrapSqlInstance(sqlInstance: any): any {
    if (!sqlInstance || typeof sqlInstance !== "function") {
      return sqlInstance;
    }

    const self = this;
    const originalSql = sqlInstance;

    // Create wrapped sql function
    const wrappedSql = function (strings: TemplateStringsArray, ...values: any[]) {
      return self._handleSqlQuery(originalSql, strings, values);
    };

    // Copy all properties from the original sql instance
    Object.setPrototypeOf(wrappedSql, Object.getPrototypeOf(originalSql));
    for (const key in originalSql) {
      if (typeof originalSql[key] !== "function") {
        (wrappedSql as any)[key] = originalSql[key];
      } else {
        (wrappedSql as any)[key] = originalSql[key].bind(originalSql);
      }
    }

    // Patch the unsafe method specifically
    if (typeof originalSql.unsafe === "function") {
      (wrappedSql as any).unsafe = self._wrapUnsafeMethod(originalSql);
      logger.debug(`[PostgresInstrumentation] Wrapped unsafe method on sql instance`);
    }

    // Patch the begin method for transaction support
    if (typeof originalSql.begin === "function") {
      (wrappedSql as any).begin = self._wrapBeginMethod(originalSql);
      logger.debug(`[PostgresInstrumentation] Wrapped begin method on sql instance`);
    }

    return wrappedSql;
  }

  private _wrapUnsafeMethod(sqlInstance: any) {
    const self = this;
    const originalUnsafe = sqlInstance.unsafe;

    return function unsafe(
      query: string,
      parameters?: any[],
      queryOptions?: { prepare?: boolean },
    ): any {
      return self._handleUnsafeQuery(sqlInstance, originalUnsafe, query, parameters, queryOptions);
    };
  }

  private _wrapBeginMethod(sqlInstance: any) {
    const self = this;
    const originalBegin = sqlInstance.begin;

    return function begin(
      optionsOrCallback?: string | ((sql: any) => any),
      callback?: (sql: any) => any,
    ): any {
      // Handle both signatures: begin(callback) and begin(options, callback)
      const options = typeof optionsOrCallback === "string" ? optionsOrCallback : "";
      const transactionCallback =
        typeof optionsOrCallback === "function" ? optionsOrCallback : callback;

      return self._handleBeginTransaction(sqlInstance, originalBegin, options, transactionCallback);
    };
  }

  private _getSqlPatchFn() {
    const self = this;

    return (originalSql: Function) => {
      return function sql(strings: TemplateStringsArray, ...values: any[]) {
        return self._handleSqlQuery(originalSql, strings, values);
      };
    };
  }

  private _handleSqlQuery(
    originalSql: Function,
    strings: TemplateStringsArray,
    values: any[],
  ): any {
    // Reconstruct the query from template strings and values
    let query = "";
    for (let i = 0; i < strings.length; i++) {
      query += strings[i];
      if (i < values.length) {
        query += `$${i + 1}`; // PostgreSQL parameter placeholder
      }
    }

    const inputValue: PostgresClientInputValue = {
      query: query.trim(),
      parameters: values,
    };

    // Handle replay mode (only if app is ready)
    if (this.mode === TuskDriftMode.REPLAY) {
      const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

      return handleReplayMode({
        noOpRequestHandler: () => {
          return;
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => originalSql(strings, ...values),
            {
              name: "postgres.query",
              kind: SpanKind.CLIENT,
              submodule: "query",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart: false,
            },
            (spanInfo) => {
              return this.handleReplaySqlQuery({
                inputValue,
                spanInfo,
                submodule: "query",
                name: "postgres.query",
                stackTrace,
              });
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => originalSql(strings, ...values),
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => originalSql(strings, ...values),
            {
              name: "postgres.query",
              kind: SpanKind.CLIENT,
              submodule: "query",
              packageType: PackageType.PG,
              instrumentationName: this.INSTRUMENTATION_NAME,
              packageName: "postgres",
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleRecordQueryInSpan(spanInfo, originalSql, strings, values);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      // Should never happen since we're only patching record and replay modes
      return originalSql(strings, ...values);
    }
  }

  private _handleUnsafeQuery(
    sqlInstance: any,
    originalUnsafe: Function,
    query: string,
    parameters?: any[],
    queryOptions?: { prepare?: boolean },
  ): any {
    // Create a function that calls unsafe with the correct arguments
    const executeUnsafe = () => {
      // Only pass arguments that were actually provided
      if (queryOptions !== undefined) {
        return originalUnsafe.call(sqlInstance, query, parameters, queryOptions);
      } else if (parameters !== undefined) {
        return originalUnsafe.call(sqlInstance, query, parameters);
      } else {
        return originalUnsafe.call(sqlInstance, query);
      }
    };

    const inputValue: PostgresClientInputValue = {
      query: query.trim(),
      parameters: parameters || [],
      options: queryOptions,
    };

    if (this.mode === TuskDriftMode.REPLAY) {
      const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

      return handleReplayMode({
        noOpRequestHandler: () => {
          return Promise.resolve(undefined);
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return this._createPendingQueryWrapper(() => {
            return SpanUtils.createAndExecuteSpan(
              this.mode,
              () => executeUnsafe(),
              {
                name: "postgres.unsafe",
                kind: SpanKind.CLIENT,
                submodule: "unsafe",
                packageType: PackageType.PG,
                packageName: "postgres",
                instrumentationName: this.INSTRUMENTATION_NAME,
                inputValue: inputValue,
                isPreAppStart: false,
              },
              (spanInfo) => {
                return this.handleReplayUnsafeQuery({
                  inputValue,
                  spanInfo,
                  submodule: "unsafe",
                  name: "postgres.unsafe",
                  stackTrace,
                });
              },
            );
          });
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: executeUnsafe,
        recordModeHandler: ({ isPreAppStart }) => {
          // Execute postgres.js query first, then create span afterwards
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            executeUnsafe,
            {
              name: "postgres.unsafe",
              kind: SpanKind.CLIENT,
              submodule: "unsafe",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._executeThenAddOutputAttributes(spanInfo, executeUnsafe);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      // Should never happen since we're only patching record and replay modes
      return executeUnsafe();
    }
  }

  private _handleBeginTransaction(
    sqlInstance: any,
    originalBegin: Function,
    options: string,
    transactionCallback?: (sql: any) => any,
  ): any {
    const inputValue = {
      query: "BEGIN",
      options: options ? { transactionOptions: options } : undefined,
    };

    const executeBegin = () => {
      if (options && transactionCallback) {
        return originalBegin.call(sqlInstance, options, transactionCallback);
      } else if (transactionCallback) {
        return originalBegin.call(sqlInstance, transactionCallback);
      } else {
        return originalBegin.call(sqlInstance, options || undefined);
      }
    };

    if (this.mode === TuskDriftMode.REPLAY) {
      const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

      return handleReplayMode({
        noOpRequestHandler: () => {
          return;
        },
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => executeBegin(),
            {
              name: "postgres.begin",
              kind: SpanKind.CLIENT,
              submodule: "transaction",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart: false,
            },
            (spanInfo) => {
              return this._handleReplayBeginTransaction(spanInfo, options, stackTrace);
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: executeBegin,
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            executeBegin,
            {
              name: "postgres.begin",
              kind: SpanKind.CLIENT,
              submodule: "transaction",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleRecordBeginTransaction(spanInfo, executeBegin);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else {
      return executeBegin();
    }
  }

  /**
   * Execute postgres.js unsafe query and create span afterwards.
   *
   * postgres.js has sophisticated internal session and connection management
   * that is extremely sensitive to async context changes. Unlike the regular 'pg' library,
   * postgres.js maintains internal state using promise identity and async context tracking.
   *
   * The issue: promise chain modification breaks postgres.js.
   * Calling .then()/.catch() creates new promise objects, breaking postgres.js's internal tracking
   *
   * Solution: We must execute the postgres.js query in its completely unmodified context:
   * - Return the original promise object unchanged
   * - Use promise.finally() to track completion without creating a new promise chain
   *
   * This preserves postgres.js's internal session management while still providing tracing.
   * The 'pg' library doesn't have this issue because it has simpler internal state management.
   */
  private _executeThenAddOutputAttributes(
    spanInfo: SpanInfo,
    executeUnsafe: () => Promise<any>,
  ): Promise<any> {
    const promise = executeUnsafe();

    // Use finally() which doesn't change the promise chain's behavior
    promise.finally(() => {
      // Create span after completion without affecting the original promise
      promise
        .then((result) => {
          logger.debug(`[PostgresInstrumentation] Postgres unsafe query completed successfully`);
          try {
            this._addOutputAttributesToSpan(spanInfo, result);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(
              `[PostgresInstrumentation] error processing unsafe query response:`,
              error,
            );
          }
        })
        .catch((error) => {
          logger.debug(`[PostgresInstrumentation] Postgres unsafe query error: ${error.message}`);
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PostgresInstrumentation] error ending span:`, error);
          }
        });
    });

    return promise; // Return the original promise
  }

  private _handleRecordBeginTransaction(
    spanInfo: SpanInfo,
    executeBegin: () => Promise<any>,
  ): Promise<any> {
    const promise = executeBegin();

    // Use finally() which doesn't change the promise chain's behavior
    promise.finally(() => {
      // Create span after completion without affecting the original promise
      promise
        .then((result) => {
          logger.debug(
            `[PostgresInstrumentation] Postgres transaction completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { status: "committed", result },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PostgresInstrumentation] error processing transaction response:`, error);
          }
        })
        .catch((error) => {
          logger.debug(
            `[PostgresInstrumentation] Postgres transaction error (rolled back): ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { status: "rolled_back", error: error.message },
            });
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (spanError) {
            logger.error(`[PostgresInstrumentation] error ending span:`, spanError);
          }
        });
    });

    return promise; // Return the original promise
  }

  private async _handleReplayBeginTransaction(
    spanInfo: SpanInfo,
    options?: string,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres transaction`);

    // Find mock data for the transaction
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "postgres.begin",
        inputValue: {
          query: "BEGIN",
          options: options ? { transactionOptions: options } : undefined,
        },
        packageName: "postgres",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "transaction",
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(`[PostgresInstrumentation] No mock data found for transaction BEGIN`);
      throw new Error(`[PostgresInstrumentation] No matching mock found for transaction BEGIN`);
    }

    logger.debug(
      `[PostgresInstrumentation] Found mock data for transaction: ${JSON.stringify(mockData)}`,
    );

    // Transaction results are stored directly without type conversion
    const transactionResult = mockData.result;

    // Check if the transaction was successful or rolled back
    const wasCommitted =
      transactionResult &&
      typeof transactionResult === "object" &&
      "status" in transactionResult &&
      transactionResult.status === "committed";

    if (wasCommitted) {
      return transactionResult.result;
    } else {
      // Transaction was rolled back
      const errorMessage =
        transactionResult &&
        typeof transactionResult === "object" &&
        "error" in transactionResult &&
        transactionResult.error
          ? transactionResult.error
          : "Transaction rolled back";
      throw new Error(errorMessage);
    }
  }

  private async _handleRecordQueryInSpan(
    spanInfo: SpanInfo,
    originalSql: Function,
    strings: TemplateStringsArray,
    values: any[],
  ): Promise<any> {
    try {
      const result = await originalSql(strings, ...values);

      try {
        logger.debug(
          `[PostgresInstrumentation] Postgres query completed successfully (${SpanUtils.getTraceInfo()})`,
        );

        this._addOutputAttributesToSpan(spanInfo, result);
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
      } catch (error) {
        logger.error(`[PostgresInstrumentation] error processing query response:`, error);
      }

      return result;
    } catch (error: any) {
      try {
        logger.debug(
          `[PostgresInstrumentation] Postgres query error: ${error.message} (${SpanUtils.getTraceInfo()})`,
        );
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      } catch (spanError) {
        logger.error(`[PostgresInstrumentation] error ending span:`, spanError);
      }

      throw error;
    }
  }

  async handleReplaySqlQuery({
    inputValue,
    spanInfo,
    submodule,
    name,
    stackTrace,
  }: {
    inputValue: PostgresClientInputValue;
    spanInfo: SpanInfo;
    submodule: string;
    name: string;
    stackTrace?: string;
  }): Promise<PostgresRow[] | undefined> {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres sql query`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name,
        inputValue: inputValue,
        packageName: "postgres",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: submodule,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      const queryText = inputValue.query || "UNKNOWN_QUERY";
      logger.warn(
        `[PostgresInstrumentation] No mock data found for Postgres sql query: ${queryText}`,
      );
      throw new Error(
        `[PostgresInstrumentation] No matching mock found for Postgres sql query: ${queryText}`,
      );
    }

    logger.debug(
      `[PostgresInstrumentation] Found mock data for Postgres sql query: ${JSON.stringify(mockData)}`,
    );

    const processedResult = this.convertPostgresTypes(mockData.result);

    logger.debug(
      `[PostgresInstrumentation] Sql query processed result: ${JSON.stringify(processedResult)}`,
    );

    // Template string queries return just the rows array
    // Type guard: check if processedResult has a 'rows' property (PostgresResult type)
    const isResultObject =
      processedResult && typeof processedResult === "object" && "rows" in processedResult;
    const rows = isResultObject
      ? processedResult.rows || []
      : (processedResult as PostgresRow[]) || [];

    // postgres.js returns an array with metadata properties attached
    const resultArray = Object.assign(rows, {
      command: isResultObject ? processedResult.command : undefined,
      count: isResultObject ? processedResult.count : undefined,
    });
    return resultArray;
  }

  async handleReplayUnsafeQuery({
    inputValue,
    spanInfo,
    submodule,
    name,
    stackTrace,
  }: {
    inputValue: PostgresClientInputValue;
    spanInfo: SpanInfo;
    submodule: string;
    name: string;
    stackTrace?: string;
  }): Promise<PostgresConvertedResult | undefined> {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres unsafe query`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name,
        inputValue: inputValue,
        packageName: "postgres",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: submodule,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      const queryText = inputValue.query || "UNKNOWN_QUERY";
      logger.warn(
        `[PostgresInstrumentation] No mock data found for Postgres unsafe query: ${queryText}`,
      );
      throw new Error(
        `[PostgresInstrumentation] No matching mock found for Postgres unsafe query: ${queryText}`,
      );
    }

    logger.debug(
      `[PostgresInstrumentation] Found mock data for Postgres unsafe query: ${JSON.stringify(mockData)}`,
    );

    const processedResult = this.convertPostgresTypes(mockData.result);

    logger.debug(
      `[PostgresInstrumentation] Unsafe query processed result: ${JSON.stringify(processedResult)}`,
    );

    return processedResult;
  }

  /**
   * Create a postgres.js-compatible PendingQuery wrapper.
   * This creates a thenable object with .values(), .raw(), etc. methods
   * that matches the postgres.js PendingQuery interface.
   *
   * NOTE: This wrapper is ONLY needed for unsafe() queries, not template string queries.
   * - unsafe() returns a PendingQuery with .values() method that Drizzle calls
   * - Template strings return a plain Promise/array and don't need the wrapper
   *
   * Also NOTE: unsafe expects a PendingQuery in return. This includes most common ones, but not all.
   * There is a possiblity we need to add the rest of the methods to the PendingQuery interface from "postgres" library.
   */
  private _createPendingQueryWrapper(
    queryPromiseFactory: () => Promise<PostgresConvertedResult>,
  ): Promise<any> {
    // Create the main promise
    const mainPromise = queryPromiseFactory();

    // Create a thenable wrapper that has the postgres.js methods
    const pendingQuery = Object.assign(mainPromise, {
      // .values() returns a promise that resolves to array of value arrays
      values: () => {
        return mainPromise.then((result: PostgresConvertedResult) => {
          if (!result) {
            return [];
          }

          // Type guard: check if result is a PostgresResult object with 'rows' property
          const isResultObject = typeof result === "object" && "rows" in result;
          const rows = isResultObject ? result.rows || [] : Array.isArray(result) ? result : [];

          // Convert rows to arrays if they're objects
          const valueArrays = rows.map((row: PostgresRow) => {
            if (Array.isArray(row)) {
              return row;
            }
            // If row is an object, convert to array of values
            return Object.values(row);
          });

          // Return array with metadata
          return Object.assign(valueArrays, {
            command: isResultObject ? result.command : undefined,
            count: isResultObject ? result.count : undefined,
          });
        });
      },
    });

    return pendingQuery;
  }

  /**
   * Convert PostgreSQL string values back to appropriate JavaScript types
   * based on common PostgreSQL data patterns.
   */
  private convertPostgresTypes(result: any): PostgresConvertedResult | undefined {
    // if result is not of type PostgresOutputValueType, throw an error
    if (!isPostgresOutputValueType(result)) {
      logger.error(
        `[PostgresInstrumentation] output value is not of type PostgresOutputValueType: ${JSON.stringify(result)}`,
      );
      return undefined;
    }

    if (!result) {
      return undefined;
    }

    // Check for our metadata flag
    const { _tdOriginalFormat: originalFormat, ...convertedResult } = result;

    // Handle postgres.js result format: { command, count, rows }
    if (originalFormat === PostgresReturnType.OBJECT) {
      return convertedResult;
    } else if (originalFormat === PostgresReturnType.ARRAY) {
      return convertedResult.rows || [];
    } else {
      logger.error(`[PostgresInstrumentation] Invalid result format: ${JSON.stringify(result)}`);
      return undefined;
    }
  }

  private _addOutputAttributesToSpan(spanInfo: SpanInfo, result?: any): void {
    if (!result) return;

    let outputValue: PostgresOutputValueType;

    if (Array.isArray(result)) {
      // Direct array result - wrap with metadata to indicate original format
      logger.debug(
        `[PostgresInstrumentation] Adding output attributes to span for array result: ${JSON.stringify(result)}`,
      );
      outputValue = {
        _tdOriginalFormat: PostgresReturnType.ARRAY,
        rows: result,
      };
    } else if (typeof result === "object") {
      logger.debug(
        `[PostgresInstrumentation] Adding output attributes to span for object result: ${JSON.stringify(result)}`,
      );
      outputValue = {
        _tdOriginalFormat: PostgresReturnType.OBJECT,
        count: result.count,
        rows: result.rows,
        command: result.command,
      };
    } else {
      logger.error(`[PostgresInstrumentation] Invalid result format: ${JSON.stringify(result)}`);
      return;
    }

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
