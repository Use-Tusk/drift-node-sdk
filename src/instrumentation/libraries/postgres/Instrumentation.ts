import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode, context, Context } from "@opentelemetry/api";
import { TdSpanAttributes } from "../../../core/types";
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
import {
  createMockInputValue,
  createSpanInputValue,
} from "../../../core/utils/dataNormalizationUtils";

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
          // Mock SQL function that looks like a postgres client
          const mockSql: any = () =>
            Promise.resolve(Object.assign([], { count: 0, command: null }));

          // Add essential methods
          mockSql.unsafe = () => Promise.resolve(Object.assign([], { count: 0, command: null }));
          mockSql.begin = () => Promise.resolve();
          mockSql.end = () => Promise.resolve();

          return mockSql; // Returns a function-like object, not a Promise
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
              isPreAppStart: this.tuskDrift.isAppReady() ? false : true,
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

    // Patch the file method for loading queries from files
    if (typeof originalSql.file === "function") {
      (wrappedSql as any).file = self._wrapFileMethod(originalSql);
      logger.debug(`[PostgresInstrumentation] Wrapped file method on sql instance`);
    }

    // Patch the reserve method for reserved connections
    if (typeof originalSql.reserve === "function") {
      (wrappedSql as any).reserve = self._wrapReserveMethod(originalSql);
      logger.debug(`[PostgresInstrumentation] Wrapped reserve method on sql instance`);
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

  private _wrapFileMethod(sqlInstance: any) {
    const self = this;
    const originalFile = sqlInstance.file;

    return function file(
      path: string,
      parameters?: any[],
      queryOptions?: { prepare?: boolean },
    ): any {
      return self._handleFileQuery(sqlInstance, originalFile, path, parameters, queryOptions);
    };
  }

  private _wrapReserveMethod(sqlInstance: any) {
    const self = this;
    const originalReserve = sqlInstance.reserve;

    return async function reserve(): Promise<any> {
      // In REPLAY mode, avoid establishing real TCP connections
      if (self.mode === TuskDriftMode.REPLAY) {
        logger.debug(
          `[PostgresInstrumentation] REPLAY mode: Creating mock reserved connection without TCP`,
        );

        // Create a mock ReservedSql instance without calling original reserve()
        // This prevents TCP connection establishment in REPLAY mode
        const mockReservedSql = self._wrapSqlInstance(sqlInstance);

        // Add the release() method to the mock instance
        if (typeof mockReservedSql === "function") {
          (mockReservedSql as any).release = function () {
            logger.debug(`[PostgresInstrumentation] Mock reserved connection released`);
            // No-op in REPLAY mode since we didn't establish a real connection
          };
        }

        return mockReservedSql;
      }

      // In RECORD/DISABLED modes, call the original reserve() and wrap the result
      const reservedSql = await originalReserve.call(sqlInstance);

      // CRITICAL: Wrap the returned ReservedSql instance
      // This ensures queries on the reserved connection are instrumented
      const wrappedReservedSql = self._wrapSqlInstance(reservedSql);

      logger.debug(`[PostgresInstrumentation] Reserved connection obtained and wrapped`);

      return wrappedReservedSql;
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

    // Store original .then() method BEFORE wrapping it
    const originalThen = query.then.bind(query);

    const self = this;

    // Intercept .then() to track when query is actually executed
    query.then = function (onFulfilled?: any, onRejected?: any) {
      // If forEach was already called, skip span creation - forEach handles its own span
      if ((query as any)._forEachCalled) {
        return originalThen(onFulfilled, onRejected);
      }

      // Reconstruct the query string for logging
      const queryString = self._reconstructQueryString(strings, values);

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
                () => originalThen(onFulfilled, onRejected), // Fallback
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
                      logger.error(
                        `[PostgresInstrumentation] error processing query response:`,
                        error,
                      );
                    }

                    // Then pass to user's callback if provided
                    return onFulfilled ? onFulfilled(result) : result;
                  };

                  const wrappedOnRejected = (error: any) => {
                    // Save error to span FIRST
                    try {
                      logger.debug(`[PostgresInstrumentation] Postgres query error`, error);
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
            noOpRequestHandler: () =>
              Promise.resolve(Object.assign([], { count: 0, command: null })),
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
                  isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
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

    // Also wrap .execute() method if it exists to prevent TCP calls in REPLAY mode
    const originalExecute = query.execute ? query.execute.bind(query) : undefined;

    if (originalExecute) {
      query.execute = function () {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In REPLAY mode, don't call handle() which would trigger real DB execution
          // Just return this (Query object). When awaited, the wrapped .then() will provide mocked data
          return this;
        } else {
          // In RECORD/DISABLED modes, call the original execute()
          return originalExecute.call(this);
        }
      };
    }

    // Wrap cursor() method to intercept cursor-based streaming
    if (typeof query.cursor === "function") {
      const originalCursor = query.cursor.bind(query);

      // Reconstruct the query string for cursor (same as in .then())
      const queryString = self._reconstructQueryString(strings, values);

      query.cursor = function (rows?: number | Function, fn?: Function) {
        // Handle both signatures: cursor(rows, fn) and cursor(fn)
        if (typeof rows === "function") {
          fn = rows;
          rows = 1;
        }

        if (!rows) {
          rows = 1;
        }

        const inputValue: PostgresClientInputValue = {
          query: queryString.trim(),
          parameters: values,
        };

        // If callback function provided, pass it to the handlers
        if (typeof fn === "function") {
          if (self.mode === TuskDriftMode.RECORD) {
            return self._handleCursorCallbackRecord({
              originalCursor,
              rows,
              inputValue,
              creationContext,
              userCallback: fn,
              originalThen,
            });
          } else if (self.mode === TuskDriftMode.REPLAY) {
            return self._handleCursorCallbackReplay({
              inputValue,
              creationContext,
              cursorBatchSize: rows,
              userCallback: fn,
            });
          } else {
            return originalCursor(rows, fn);
          }
        }

        // Async iterator path - needs special handling
        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleCursorRecord({
            originalCursor,
            rows,
            inputValue,
            creationContext,
          });
        } else if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleCursorReplay({
            inputValue,
            creationContext,
            cursorBatchSize: rows,
          });
        } else {
          return originalCursor(rows);
        }
      };
    }

    // Wrap forEach() method to intercept row-by-row streaming
    if (typeof query.forEach === "function") {
      const originalForEach = query.forEach.bind(query);

      // Reconstruct the query string for forEach (same as in .then() and cursor())
      const forEachQueryString = self._reconstructQueryString(strings, values);

      query.forEach = function (fn: (row: any, result?: any) => void) {
        // Mark that forEach was called so .then() wrapper skips span creation
        (query as any)._forEachCalled = true;

        const forEachInputValue: PostgresClientInputValue = {
          query: forEachQueryString.trim(),
          parameters: values,
        };

        if (self.mode === TuskDriftMode.RECORD) {
          return self._handleForEachRecord({
            originalForEach,
            inputValue: forEachInputValue,
            creationContext,
            userCallback: fn,
          });
        } else if (self.mode === TuskDriftMode.REPLAY) {
          return self._handleForEachReplay({
            inputValue: forEachInputValue,
            creationContext,
            userCallback: fn,
          });
        } else {
          return originalForEach(fn);
        }
      };
    }

    // Return the Query object with intercepted .then(), .execute(), .cursor(), and .forEach()
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
    unsafeQuery.then = function (onFulfilled?: any, onRejected?: any) {
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
                      logger.error(
                        `[PostgresInstrumentation] error processing unsafe query response:`,
                        error,
                      );
                    }
                    return onFulfilled ? onFulfilled(result) : result;
                  };

                  const wrappedOnRejected = (error: any) => {
                    try {
                      logger.debug(
                        `[PostgresInstrumentation] Postgres unsafe query error: ${error.message}`,
                      );
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
            noOpRequestHandler: () =>
              Promise.resolve(Object.assign([], { count: 0, command: null })),
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
                  isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
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

    // Also wrap .execute() method if it exists to prevent TCP calls in REPLAY mode
    const originalExecute = unsafeQuery.execute ? unsafeQuery.execute.bind(unsafeQuery) : undefined;

    if (originalExecute) {
      unsafeQuery.execute = function () {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In REPLAY mode, don't call handle() which would trigger real DB execution
          // Just return this (Query object). When awaited, the wrapped .then() will provide mocked data
          return this;
        } else {
          // In RECORD/DISABLED modes, call the original execute()
          return originalExecute.call(this);
        }
      };
    }

    return unsafeQuery;
  }

  private _handleFileQuery(
    sqlInstance: any,
    originalFile: Function,
    path: string,
    parameters?: any[],
    queryOptions?: { prepare?: boolean },
  ): any {
    // Create the Query object (doesn't execute yet)
    const fileQuery = (() => {
      if (queryOptions !== undefined) {
        return originalFile.call(sqlInstance, path, parameters, queryOptions);
      } else if (parameters !== undefined) {
        return originalFile.call(sqlInstance, path, parameters);
      } else {
        return originalFile.call(sqlInstance, path);
      }
    })();

    // Capture the current context
    const creationContext = context.active();

    // Store original .then() method
    const originalThen = fileQuery.then.bind(fileQuery);

    const self = this;

    const inputValue: PostgresClientInputValue = {
      query: path, // Use file path as the query identifier
      parameters: parameters || [],
      options: queryOptions,
    };

    // Intercept .then() to track when query is actually executed
    fileQuery.then = function (onFulfilled?: any, onRejected?: any) {
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
                  name: "postgres.file",
                  kind: SpanKind.CLIENT,
                  submodule: "file",
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
                        `[PostgresInstrumentation] Postgres file query completed successfully (${SpanUtils.getTraceInfo()})`,
                      );
                      self._addOutputAttributesToSpan(spanInfo, result);
                      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                    } catch (error) {
                      logger.error(
                        `[PostgresInstrumentation] error processing file query response:`,
                        error,
                      );
                    }
                    return onFulfilled ? onFulfilled(result) : result;
                  };

                  const wrappedOnRejected = (error: any) => {
                    try {
                      logger.debug(
                        `[PostgresInstrumentation] Postgres file query error: ${error.message}`,
                      );
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
            noOpRequestHandler: () =>
              Promise.resolve(Object.assign([], { count: 0, command: null })),
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalThen(onFulfilled, onRejected),
                {
                  name: "postgres.file",
                  kind: SpanKind.CLIENT,
                  submodule: "file",
                  packageType: PackageType.PG,
                  packageName: "postgres",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
                },
                async (spanInfo) => {
                  const mockedResult = await self.handleReplayFileQuery({
                    inputValue,
                    spanInfo,
                    submodule: "file",
                    name: "postgres.file",
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

    // Also wrap .execute() method if it exists to prevent TCP calls in REPLAY mode
    const originalExecute = fileQuery.execute ? fileQuery.execute.bind(fileQuery) : undefined;
    if (originalExecute) {
      fileQuery.execute = function () {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In REPLAY mode, don't call handle() which would trigger real DB execution
          // Just return this (Query object). When awaited, the wrapped .then() will provide mocked data
          return this;
        } else {
          return originalExecute.call(this);
        }
      };
    }

    return fileQuery;
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
        noOpRequestHandler: () => Promise.resolve(),
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
              isPreAppStart: this.tuskDrift.isAppReady() ? false : true,
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
    return executeBegin()
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
        return result;
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
        throw error;
      });
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

  async handleReplayFileQuery({
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
    logger.debug(`[PostgresInstrumentation] Replaying Postgres file query`);

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
        `[PostgresInstrumentation] No mock data found for Postgres file query: ${queryText}`,
      );
      throw new Error(
        `[PostgresInstrumentation] No matching mock found for Postgres file query: ${queryText}`,
      );
    }

    logger.debug(
      `[PostgresInstrumentation] Found mock data for Postgres file query: ${JSON.stringify(mockData)}`,
    );

    const processedResult = this.convertPostgresTypes(mockData.result);

    logger.debug(
      `[PostgresInstrumentation] File query processed result: ${JSON.stringify(processedResult)}`,
    );

    return processedResult;
  }

  private _reconstructQueryString(strings: TemplateStringsArray, values: any[]): string {
    let queryString = "";
    for (let i = 0; i < strings.length; i++) {
      queryString += strings[i];
      if (i < values.length) {
        queryString += `$${i + 1}`;
      }
    }
    return queryString;
  }

  private convertPostgresTypes(result: any): PostgresConvertedResult | undefined {
    if (!isPostgresOutputValueType(result)) {
      logger.error(
        `[PostgresInstrumentation] output value is not of type PostgresOutputValueType`,
        result,
      );
      return undefined;
    }

    const { rows, count, command, columns, state, statement } = result;

    // Reconstruct Result-like object
    const resultArray = Array.from(rows || []);

    // Attach metadata as non-enumerable properties (matching postgres.js behavior)
    // Only add properties that are actually present in the recorded data to avoid
    // undefined -> null conversion which causes JSON serialization mismatches
    if (count !== undefined) {
      Object.defineProperty(resultArray, "count", {
        value: count,
        writable: true,
        enumerable: false,
      });
    }

    if (command !== undefined) {
      Object.defineProperty(resultArray, "command", {
        value: command,
        writable: true,
        enumerable: false,
      });
    }

    if (columns !== undefined) {
      Object.defineProperty(resultArray, "columns", {
        value: columns,
        writable: true,
        enumerable: false,
      });
    }

    if (state !== undefined) {
      Object.defineProperty(resultArray, "state", {
        value: state,
        writable: true,
        enumerable: false,
      });
    }

    if (statement !== undefined) {
      Object.defineProperty(resultArray, "statement", {
        value: statement,
        writable: true,
        enumerable: false,
      });
    }

    return resultArray;
  }

  private _addOutputAttributesToSpan(spanInfo: SpanInfo, result?: any): void {
    if (!result) return;

    // ALL postgres.js results are Result objects (extend Array) with metadata properties
    // We need to explicitly capture these non-enumerable properties
    const isArray = Array.isArray(result);

    logger.debug(
      `[PostgresInstrumentation] Adding output attributes to span for ${isArray ? "array" : "object"} result`,
    );

    // Helper to convert Buffers to strings for JSON serialization
    // This ensures consistent string data in both RECORD and REPLAY modes
    const normalizeValue = (val: any): any => {
      if (Buffer.isBuffer(val)) {
        return val.toString("utf8");
      } else if (Array.isArray(val)) {
        return val.map(normalizeValue);
      } else if (
        val &&
        typeof val === "object" &&
        val.type === "Buffer" &&
        Array.isArray(val.data)
      ) {
        // Handle already-serialized Buffer objects
        return Buffer.from(val.data).toString("utf8");
      }
      return val;
    };

    const outputValue: PostgresOutputValueType = {
      // Always capture rows (the array data), normalizing any Buffer objects
      rows: isArray
        ? Array.from(result).map(normalizeValue)
        : (result.rows || []).map(normalizeValue),
      // Explicitly capture non-enumerable metadata properties
      count: result.count !== undefined && result.count !== null ? result.count : undefined,
      command: result.command || undefined,
      // You could also capture: columns, state, statement if needed
      columns: result.columns || undefined,
      state: result.state || undefined,
      statement: result.statement || undefined,
    };

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _handleCursorCallbackRecord({
    originalCursor,
    rows,
    inputValue,
    creationContext,
    userCallback,
    originalThen,
  }: {
    originalCursor: Function;
    rows: number;
    inputValue: PostgresClientInputValue;
    creationContext: Context;
    userCallback: Function;
    originalThen?: Function;
  }): Promise<void> {
    const self = this;

    return context.with(creationContext, () => {
      return handleRecordMode({
        originalFunctionCall: async () => {
          const wrappedCallback = (batchRows: any[]) => {
            return userCallback(batchRows);
          };

          const cursorPromise = originalCursor(rows, wrappedCallback);
          if (originalThen) {
            await originalThen.call(cursorPromise, (result: any) => result);
          } else {
            await cursorPromise;
          }
        },
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            self.mode,
            () => {
              return self._executeAndRecordCursorCallback({
                originalCursor,
                rows,
                userCallback,
                originalThen,
              });
            },
            {
              name: "postgres.cursor",
              kind: SpanKind.CLIENT,
              submodule: "cursor",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: self.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return self._executeAndRecordCursorCallback({
                originalCursor,
                rows,
                userCallback,
                originalThen,
                spanInfo,
              });
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    });
  }

  private async _executeAndRecordCursorCallback({
    originalCursor,
    rows,
    userCallback,
    originalThen,
    spanInfo,
  }: {
    originalCursor: Function;
    rows: number;
    userCallback: Function;
    originalThen?: Function;
    spanInfo?: SpanInfo;
  }): Promise<void> {
    const allRows: any[] = [];

    try {
      const wrappedCallback = (batchRows: any[]) => {
        allRows.push(...batchRows);
        return userCallback(batchRows);
      };

      const cursorPromise = originalCursor(rows, wrappedCallback);
      let result: any;
      if (originalThen) {
        result = await originalThen.call(cursorPromise, (result: any) => result);
      } else {
        result = await cursorPromise;
      }

      if (spanInfo) {
        const resultArray = Object.assign(allRows, {
          count: allRows.length,
          columns: result?.columns,
          state: result?.state,
          statement: result?.statement,
        });
        this._addOutputAttributesToSpan(spanInfo, resultArray);
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        logger.debug(
          `[PostgresInstrumentation] Cursor callback completed, recorded ${allRows.length} rows`,
        );
      }
    } catch (error: any) {
      logger.debug(`[PostgresInstrumentation] Cursor callback error: ${error.message}`);
      if (spanInfo) {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      }
      throw error;
    }
  }

  private _handleCursorCallbackReplay({
    inputValue,
    creationContext,
    cursorBatchSize,
    userCallback,
  }: {
    inputValue: PostgresClientInputValue;
    creationContext: Context;
    cursorBatchSize: number;
    userCallback: Function;
  }): Promise<void> {
    const self = this;
    const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

    return context.with(creationContext, () => {
      return handleReplayMode({
        noOpRequestHandler: () => Promise.resolve(),
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            self.mode,
            () => Promise.resolve(),
            {
              name: "postgres.cursor",
              kind: SpanKind.CLIENT,
              submodule: "cursor",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: self.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
            },
            async (spanInfo) => {
              try {
                const mockData = await findMockResponseAsync({
                  mockRequestData: {
                    traceId: spanInfo.traceId,
                    spanId: spanInfo.spanId,
                    name: "postgres.cursor",
                    inputValue: createMockInputValue(inputValue),
                    packageName: "postgres",
                    instrumentationName: this.INSTRUMENTATION_NAME,
                    submoduleName: "cursor",
                    kind: SpanKind.CLIENT,
                    stackTrace,
                  },
                  tuskDrift: this.tuskDrift,
                });

                if (!mockData) {
                  throw new Error(
                    `[PostgresInstrumentation] No matching mock found for cursor query: ${inputValue.query}`,
                  );
                }

                logger.debug(
                  `[PostgresInstrumentation] Found mock data for cursor query: ${JSON.stringify(mockData)}`,
                );

                const processedResult = this.convertPostgresTypes(mockData.result);
                const mockedData = Array.isArray(processedResult) ? processedResult : [];

                // Call user's callback with batches from mocked data
                for (let i = 0; i < mockedData.length; i += cursorBatchSize) {
                  const batch = mockedData.slice(i, i + cursorBatchSize);
                  logger.debug(
                    `[PostgresInstrumentation] Cursor replay calling callback with batch of ${batch.length} rows`,
                  );
                  await userCallback(batch);
                }

                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              } catch (error: any) {
                logger.debug(
                  `[PostgresInstrumentation] Cursor callback replay error: ${error.message}`,
                );
                SpanUtils.endSpan(spanInfo.span, {
                  code: SpanStatusCode.ERROR,
                  message: error.message,
                });
                throw error;
              }
            },
          );
        },
      });
    });
  }

  private _handleCursorRecord({
    originalCursor,
    rows,
    inputValue,
    creationContext,
  }: {
    originalCursor: Function;
    rows: number;
    inputValue: PostgresClientInputValue;
    creationContext: Context;
  }): AsyncIterable<any[]> {
    const self = this;

    // Async iterator path
    return {
      [Symbol.asyncIterator]() {
        const iterator = originalCursor(rows)[Symbol.asyncIterator]();
        let allRows: any[] = [];
        let result: any;

        let spanInfo: SpanInfo | null = null;
        let spanStarted = false;

        return {
          async next(): Promise<IteratorResult<any[], any>> {
            return context.with(creationContext, async () => {
              // Start span on first iteration
              if (!spanStarted) {
                spanStarted = true;
                // Create span with all required attributes
                spanInfo = SpanUtils.createSpan({
                  name: "postgres.cursor",
                  kind: SpanKind.CLIENT,
                  isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
                  attributes: {
                    [TdSpanAttributes.NAME]: "postgres.cursor",
                    [TdSpanAttributes.PACKAGE_NAME]: "postgres",
                    [TdSpanAttributes.SUBMODULE_NAME]: "cursor",
                    [TdSpanAttributes.INSTRUMENTATION_NAME]: self.INSTRUMENTATION_NAME,
                    [TdSpanAttributes.PACKAGE_TYPE]: PackageType.PG,
                    [TdSpanAttributes.INPUT_VALUE]: createSpanInputValue(inputValue),
                    [TdSpanAttributes.IS_PRE_APP_START]: self.tuskDrift.isAppReady() ? false : true,
                  },
                });

                if (!spanInfo) {
                  logger.warn(
                    `[PostgresInstrumentation] Failed to create cursor span in RECORD mode`,
                  );
                }
              }

              try {
                result = await iterator.next();

                if (result.done) {
                  // End span with collected results
                  if (spanInfo) {
                    // Create a result array that mimics postgres.js result format
                    const resultArray = Object.assign(allRows, {
                      count: allRows.length,
                      columns: result?.columns,
                      state: result?.state,
                      statement: result?.statement,
                    });
                    self._addOutputAttributesToSpan(spanInfo, resultArray);
                    SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                    logger.debug(
                      `[PostgresInstrumentation] Cursor completed, recorded ${allRows.length} rows`,
                    );
                  }
                  return { done: true as const, value: undefined };
                }

                // Collect rows for recording
                if (Array.isArray(result.value)) {
                  allRows.push(...result.value);
                }
                return { done: false as const, value: result.value };
              } catch (error: any) {
                if (spanInfo) {
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: error.message,
                  });
                }
                throw error;
              }
            });
          },

          async return(): Promise<IteratorResult<any[], any>> {
            // Handle early termination (e.g., break from for-await-of loop)
            if (spanInfo) {
              const resultArray = Object.assign(allRows, {
                count: allRows.length,
                columns: result?.columns,
                state: result?.state,
                statement: result?.statement,
              });
              self._addOutputAttributesToSpan(spanInfo, resultArray);
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
              logger.debug(
                `[PostgresInstrumentation] Cursor terminated early, recorded ${allRows.length} rows`,
              );
            }
            return { done: true as const, value: undefined };
          },
        };
      },
    };
  }

  private _handleCursorReplay({
    inputValue,
    creationContext,
    cursorBatchSize,
  }: {
    inputValue: PostgresClientInputValue;
    creationContext: Context;
    cursorBatchSize: number;
  }): AsyncIterable<any[]> {
    const self = this;
    const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

    // Async iterator path
    return {
      [Symbol.asyncIterator]() {
        let mockedData: any[] | null = null;
        let currentIndex = 0;
        let spanInfo: SpanInfo | null = null;
        let dataFetched = false;

        return {
          async next(): Promise<IteratorResult<any[], any>> {
            return context.with(creationContext, async () => {
              // On first call, fetch mocked data
              if (!dataFetched) {
                dataFetched = true;

                // Create span with all required attributes
                spanInfo = SpanUtils.createSpan({
                  name: "postgres.cursor",
                  kind: SpanKind.CLIENT,
                  isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
                  attributes: {
                    [TdSpanAttributes.NAME]: "postgres.cursor",
                    [TdSpanAttributes.PACKAGE_NAME]: "postgres",
                    [TdSpanAttributes.SUBMODULE_NAME]: "cursor",
                    [TdSpanAttributes.INSTRUMENTATION_NAME]: self.INSTRUMENTATION_NAME,
                    [TdSpanAttributes.PACKAGE_TYPE]: PackageType.PG,
                    [TdSpanAttributes.INPUT_VALUE]: createSpanInputValue(inputValue),
                    [TdSpanAttributes.IS_PRE_APP_START]: self.tuskDrift.isAppReady() ? false : true,
                  },
                });

                if (!spanInfo) {
                  throw new Error(
                    `[PostgresInstrumentation] Failed to create cursor span in REPLAY mode`,
                  );
                }

                const mockData = await findMockResponseAsync({
                  mockRequestData: {
                    traceId: spanInfo.traceId,
                    spanId: spanInfo.spanId,
                    name: "postgres.cursor",
                    inputValue: createMockInputValue(inputValue),
                    packageName: "postgres",
                    instrumentationName: self.INSTRUMENTATION_NAME,
                    submoduleName: "cursor",
                    kind: SpanKind.CLIENT,
                    stackTrace,
                  },
                  tuskDrift: self.tuskDrift,
                });

                if (!mockData) {
                  SpanUtils.endSpan(spanInfo.span, {
                    code: SpanStatusCode.ERROR,
                    message: "No mock data found",
                  });
                  throw new Error(
                    `[PostgresInstrumentation] No matching mock found for cursor query: ${inputValue.query}`,
                  );
                }

                logger.debug(
                  `[PostgresInstrumentation] Found mock data for cursor query: ${JSON.stringify(mockData)}`,
                );

                const processedResult = self.convertPostgresTypes(mockData.result);
                mockedData = Array.isArray(processedResult) ? processedResult : [];
              }

              // Return data in batches (simulating cursor batches)
              if (currentIndex >= mockedData!.length) {
                if (spanInfo) {
                  SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                }
                return { done: true as const, value: undefined };
              }

              // Return batch of rows matching the cursor batch size
              const batch = mockedData!.slice(currentIndex, currentIndex + cursorBatchSize);
              currentIndex += batch.length;

              logger.debug(
                `[PostgresInstrumentation] Cursor replay returning batch of ${batch.length} rows`,
              );

              return { done: false as const, value: batch };
            });
          },

          async return(): Promise<IteratorResult<any[], any>> {
            if (spanInfo) {
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            }
            return { done: true as const, value: undefined };
          },
        };
      },
    };
  }

  private _handleForEachRecord({
    originalForEach,
    inputValue,
    creationContext,
    userCallback,
  }: {
    originalForEach: Function;
    inputValue: PostgresClientInputValue;
    creationContext: Context;
    userCallback: (row: any, result?: any) => void;
  }): Promise<any> {
    const self = this;

    return context.with(creationContext, () => {
      return handleRecordMode({
        originalFunctionCall: () => originalForEach(userCallback),
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            self.mode,
            () => originalForEach(userCallback),
            {
              name: "postgres.query",
              kind: SpanKind.CLIENT,
              submodule: "query",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: self.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart,
            },
            async (spanInfo) => {
              // Collect all rows by wrapping the user's callback
              const allRows: any[] = [];
              const wrappedCallback = (row: any, result?: any) => {
                allRows.push(row);
                return userCallback(row, result);
              };

              try {
                // Execute with wrapped callback to collect rows
                const result = await originalForEach(wrappedCallback);

                // Record all rows in the span output
                const resultArray = Object.assign(allRows, {
                  count: allRows.length,
                  command: result?.command,
                  columns: result?.columns,
                  state: result?.state,
                  statement: result?.statement,
                });
                self._addOutputAttributesToSpan(spanInfo, resultArray);
                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });

                logger.debug(
                  `[PostgresInstrumentation] forEach completed, recorded ${allRows.length} rows`,
                );

                return result;
              } catch (error: any) {
                SpanUtils.endSpan(spanInfo.span, {
                  code: SpanStatusCode.ERROR,
                  message: error.message,
                });
                throw error;
              }
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    });
  }

  private _handleForEachReplay({
    inputValue,
    creationContext,
    userCallback,
  }: {
    inputValue: PostgresClientInputValue;
    creationContext: Context;
    userCallback: (row: any, result?: any) => void;
  }): Promise<any> {
    const self = this;
    const stackTrace = captureStackTrace(["PostgresInstrumentation"]);

    return context.with(creationContext, () => {
      return handleReplayMode({
        noOpRequestHandler: () => Promise.resolve(Object.assign([], { count: 0, command: null })),
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            self.mode,
            () => Promise.resolve(Object.assign([], { count: 0, command: null })),
            {
              name: "postgres.query",
              kind: SpanKind.CLIENT,
              submodule: "query",
              packageType: PackageType.PG,
              packageName: "postgres",
              instrumentationName: self.INSTRUMENTATION_NAME,
              inputValue: inputValue,
              isPreAppStart: self.tuskDrift.isAppReady() ? false : true,
            },
            async (spanInfo) => {
              try {
                // Find mocked data from recorded spans
                const mockedResult = await self.handleReplaySqlQuery({
                  inputValue,
                  spanInfo,
                  submodule: "query",
                  name: "postgres.query",
                  stackTrace,
                });

                const mockedRows = Array.isArray(mockedResult) ? mockedResult : [];

                logger.debug(
                  `[PostgresInstrumentation] forEach replay: calling callback with ${mockedRows.length} mocked rows`,
                );

                // Call user's callback with each mocked row (simulating forEach behavior)
                for (const row of mockedRows) {
                  userCallback(row, mockedResult);
                }

                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });

                // Return empty array with count (matching postgres.js forEach behavior)
                return Object.assign([], { count: mockedRows.length, command: null });
              } catch (error: any) {
                logger.debug(`[PostgresInstrumentation] forEach replay error: ${error.message}`);
                SpanUtils.endSpan(spanInfo.span, {
                  code: SpanStatusCode.ERROR,
                  message: error.message,
                });
                throw error;
              }
            },
          );
        },
      });
    });
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
