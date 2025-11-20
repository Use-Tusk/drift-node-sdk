import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode, context } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  PostgresModuleExports,
  PostgresClientInputValue,
  PostgresInstrumentationConfig,
  PostgresConvertedResult,
  PostgresOutputValueType,
  isPostgresOutputValueType,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger, isEsm } from "../../../core/utils";
import { createMockInputValue } from "../../../core/utils/dataNormalizationUtils";

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
    // Check if this is a Builder/Identifier call (pass through)
    if (!strings || !Array.isArray(strings.raw)) {
      return originalSql.call(this, strings, ...values);
    }

    // IMPORTANT: Capture the current context at query creation time
    // This ensures we have the right parent span when .then() is called later
    const creationContext = context.active();

    // Create the Query object (doesn't execute yet)
    const query = originalSql.call(this, strings, ...values);

    // Store original .then() method
    const originalThen = query.then.bind(query);

    const self = this;

    // Intercept .then() to track when query is actually executed
    query.then = function(onFulfilled?: any, onRejected?: any) {
      // Reconstruct the query string for logging
      let queryString = "";
      for (let i = 0; i < strings.length; i++) {
        queryString += strings[i];
        if (i < values.length) {
          queryString += `$${i + 1}`;
        }
      }

      const inputValue: PostgresClientInputValue = {
        query: queryString.trim(),
        parameters: values,
      };

      // Restore the context from query creation time
      return context.with(creationContext, () => {
        // Now track the actual execution
        if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            // When no span context, just execute normally
            originalFunctionCall: () => originalThen(onFulfilled, onRejected),
            recordModeHandler: ({ isPreAppStart }) => {
              // When we have span context, wrap in span tracking
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalThen(onFulfilled, onRejected),  // Fallback
                {
                  name: "postgres.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  packageName: "postgres",
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  // Wrap the callbacks to intercept and save the result
                  const wrappedOnFulfilled = (result: any) => {
                    // Save the raw result to span FIRST
                    try {
                      logger.debug(
                        `[PostgresInstrumentation] Postgres query completed successfully`,
                        result,
                      );
                      self._addOutputAttributesToSpan(spanInfo, result);
                      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                    } catch (error) {
                      logger.error(`[PostgresInstrumentation] error processing query response:`, error);
                    }
                    
                    // Then pass to user's callback if provided
                    return onFulfilled ? onFulfilled(result) : result;
                  };

                  const wrappedOnRejected = (error: any) => {
                    // Save error to span FIRST
                    try {
                      logger.debug(
                        `[PostgresInstrumentation] Postgres query error`,
                        error,
                      );
                      SpanUtils.endSpan(spanInfo.span, {
                        code: SpanStatusCode.ERROR,
                        message: error.message,
                      });
                    } catch (spanError) {
                      logger.error(`[PostgresInstrumentation] error ending span:`, spanError);
                    }

                    // Then pass to user's callback if provided, or rethrow
                    if (onRejected) {
                      return onRejected(error);
                    }
                    throw error;
                  };

                  // Execute with wrapped callbacks
                  return originalThen(wrappedOnFulfilled, wrappedOnRejected);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["PostgresInstrumentation"]);
          return handleReplayMode({
            noOpRequestHandler: () => {},
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalThen(onFulfilled, onRejected),
                {
                  name: "postgres.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.PG,
                  packageName: "postgres",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                async (spanInfo) => {
                  // Get mocked result
                  const mockedResult = await self.handleReplaySqlQuery({
                    inputValue,
                    spanInfo,
                    submodule: "query",
                    name: "postgres.query",
                    stackTrace,
                  });
                  
                  // Apply user callback if provided
                  return onFulfilled ? onFulfilled(mockedResult) : mockedResult;
                },
              );
            },
          });
        } else {
          // Disabled mode - just execute normally
          return originalThen(onFulfilled, onRejected);
        }
      });
    };
  
    // Return the Query object with intercepted .then()
    return query;
  }

  private _handleUnsafeQuery(
    sqlInstance: any,
    originalUnsafe: Function,
    query: string,
    parameters?: any[],
    queryOptions?: { prepare?: boolean },
  ): any {
    // Create the Query object (doesn't execute yet)
    const unsafeQuery = (() => {
      if (queryOptions !== undefined) {
        return originalUnsafe.call(sqlInstance, query, parameters, queryOptions);
      } else if (parameters !== undefined) {
        return originalUnsafe.call(sqlInstance, query, parameters);
      } else {
        return originalUnsafe.call(sqlInstance, query);
      }
    })();
  
    // Capture the current context
    const creationContext = context.active();
    
    // Store original .then() method
    const originalThen = unsafeQuery.then.bind(unsafeQuery);
    
    const self = this;
    
    const inputValue: PostgresClientInputValue = {
      query: query.trim(),
      parameters: parameters || [],
      options: queryOptions,
    };
  
    // Intercept .then() to track when query is actually executed
    unsafeQuery.then = function(onFulfilled?: any, onRejected?: any) {
      // Restore the context from query creation time
      return context.with(creationContext, () => {
        if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalThen(onFulfilled, onRejected),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalThen(onFulfilled, onRejected),
                {
                  name: "postgres.unsafe",
                  kind: SpanKind.CLIENT,
                  submodule: "unsafe",
                  packageType: PackageType.PG,
                  packageName: "postgres",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  // Wrap callbacks to intercept result
                  const wrappedOnFulfilled = (result: any) => {
                    try {
                      logger.debug(
                        `[PostgresInstrumentation] Postgres unsafe query completed successfully (${SpanUtils.getTraceInfo()})`,
                      );
                      self._addOutputAttributesToSpan(spanInfo, result);
                      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                    } catch (error) {
                      logger.error(`[PostgresInstrumentation] error processing unsafe query response:`, error);
                    }
                    return onFulfilled ? onFulfilled(result) : result;
                  };
                  
                  const wrappedOnRejected = (error: any) => {
                    try {
                      logger.debug(`[PostgresInstrumentation] Postgres unsafe query error: ${error.message}`);
                      SpanUtils.endSpan(spanInfo.span, {
                        code: SpanStatusCode.ERROR,
                        message: error.message,
                      });
                    } catch (spanError) {
                      logger.error(`[PostgresInstrumentation] error ending span:`, spanError);
                    }
                    if (onRejected) {
                      return onRejected(error);
                    }
                    throw error;
                  };
                  
                  return originalThen(wrappedOnFulfilled, wrappedOnRejected);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["PostgresInstrumentation"]);
          return handleReplayMode({
            noOpRequestHandler: () => {},
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalThen(onFulfilled, onRejected),
                {
                  name: "postgres.unsafe",
                  kind: SpanKind.CLIENT,
                  submodule: "unsafe",
                  packageType: PackageType.PG,
                  packageName: "postgres",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                async (spanInfo) => {
                  const mockedResult = await self.handleReplayUnsafeQuery({
                    inputValue,
                    spanInfo,
                    submodule: "unsafe",
                    name: "postgres.unsafe",
                    stackTrace,
                  });
                  return onFulfilled ? onFulfilled(mockedResult) : mockedResult;
                },
              );
            },
          });
        } else {
          return originalThen(onFulfilled, onRejected);
        }
      });
    };
    
    return unsafeQuery;
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
        inputValue: createMockInputValue({
          query: "BEGIN",
          options: options ? { transactionOptions: options } : undefined,
        }),
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
  }): Promise<PostgresConvertedResult | undefined> {
    logger.debug(`[PostgresInstrumentation] Replaying Postgres sql query`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name,
        inputValue: createMockInputValue(inputValue),
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

    return processedResult;
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
        inputValue: createMockInputValue(inputValue),
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

  private convertPostgresTypes(result: any): PostgresConvertedResult | undefined {
    if (!isPostgresOutputValueType(result)) {
      logger.error(
        `[PostgresInstrumentation] output value is not of type PostgresOutputValueType`,
        result,
      );
      return undefined;
    }

    const { rows, count, command } = result;
  
    // Reconstruct Result-like object
    const resultArray = Array.from(rows || []);
    
    // Attach metadata as non-enumerable properties (matching postgres.js behavior)
    Object.defineProperties(resultArray, {
      count: { 
        value: count !== undefined ? count : null, 
        writable: true,
        enumerable: false  // Match postgres.js
      },
      command: { 
        value: command || null, 
        writable: true,
        enumerable: false  // Match postgres.js
      },
    });
  
    return resultArray;
  }

  private _addOutputAttributesToSpan(spanInfo: SpanInfo, result?: any): void {
    if (!result) return;
  
    // ALL postgres.js results are Result objects (extend Array) with metadata properties
    // We need to explicitly capture these non-enumerable properties
    const isArray = Array.isArray(result);
    
    logger.debug(
      `[PostgresInstrumentation] Adding output attributes to span for ${isArray ? 'array' : 'object'} result`,
    );
  
    const outputValue: PostgresOutputValueType = {
      // Always capture rows (the array data)
      rows: isArray ? Array.from(result) : (result.rows || []),
      // Explicitly capture non-enumerable metadata properties
      count: result.count !== undefined && result.count !== null ? result.count : undefined,
      command: result.command || undefined,
      // You could also capture: columns, state, statement if needed
    };
  
    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
