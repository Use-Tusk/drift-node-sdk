import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { wrap } from "../../core/utils";
import { TdPgClientMock } from "./mocks/TdPgClientMock";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  PgModuleExports,
  PgPoolModuleExports,
  PgClientInputValue,
  PgInstrumentationConfig,
  QueryConfig,
  PgResult,
} from "./types";
// NOTE: these types are from version 8.15.5 of pg
// Older versions of pg may have different types, but this is fine for now
import { Connection, Query, Pool, PoolClient, Client } from "pg";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils/logger";

export class PgInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "PgInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: PgInstrumentationConfig = {}) {
    super("pg", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "pg",
        supportedVersions: ["8.*"],
        patch: (moduleExports: PgModuleExports) => this._patchPgModule(moduleExports),
      }),
      new TdInstrumentationNodeModule({
        name: "pg-pool",
        supportedVersions: ["2.*", "3.*"],
        patch: (moduleExports: PgPoolModuleExports) => this._patchPgPoolModule(moduleExports),
      }),
      // TODO: instrument pg-cursor
    ];
  }

  private _patchPgModule(pgModule: PgModuleExports): PgModuleExports {
    logger.debug(`[PgInstrumentation] Patching PG module in ${this.mode} mode`);

    if (pgModule._tdPatched) {
      logger.debug(`[PgInstrumentation] PG module already patched, skipping`);
      return pgModule;
    }

    // Wrap Client.prototype.query
    if (pgModule.Client && pgModule.Client.prototype) {
      this._wrap(pgModule.Client.prototype, "query", this._getQueryPatchFn("client"));
      logger.debug(`[PgInstrumentation] Wrapped Client.prototype.query`);
    }

    // Wrap Client.prototype.connect
    if (pgModule.Client && pgModule.Client.prototype) {
      this._wrap(pgModule.Client.prototype, "connect", this._getConnectPatchFn("client"));
      logger.debug(`[PgInstrumentation] Wrapped Client.prototype.connect`);
    }

    pgModule._tdPatched = true;
    logger.debug(`[PgInstrumentation] PG module patching complete`);

    return pgModule;
  }

  private _getQueryPatchFn(clientType: string) {
    const self = this;

    return (originalQuery: Function) => {
      return function query(this: Query, ...args: any[]) {
        // Parse query arguments - pg supports multiple signatures
        let queryConfig: QueryConfig | null = null;
        try {
          queryConfig = self.parseQueryArgs(args);
        } catch (error) {
          logger.error(`[PgInstrumentation] error parsing query args:`, error);
        }

        if (!queryConfig || !queryConfig.text) {
          // If we can't parse the query, let it pass through
          logger.debug(`[PgInstrumentation] Could not parse query, returning`, args);
          return originalQuery.apply(this, args);
        }

        const inputValue: PgClientInputValue = {
          text: queryConfig.text,
          values: queryConfig.values || [],
          clientType,
        };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              // Create span in replay mode
              const packageName = inputValue.clientType === "pool" ? "pg-pool" : "pg";
              const spanName = inputValue.clientType === "pool" ? "pg-pool.query" : "pg.query";
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.PG,
                  packageName: packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.handleReplayQuery(queryConfig, inputValue, spanInfo);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalQuery.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real query
              // Create span for database query
              const packageName = inputValue.clientType === "pool" ? "pg-pool" : "pg";
              const spanName = inputValue.clientType === "pool" ? "pg-pool.query" : "pg.query";
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  packageName: packageName,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordQueryInSpan(
                    spanInfo,
                    originalQuery,
                    queryConfig,
                    args,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalQuery.apply(this, args);
        }
      };
    };
  }

  private _getConnectPatchFn(clientType: string) {
    const self = this;

    return (originalConnect: Function) => {
      return function connect(this: Connection, callback?: Function) {
        const inputValue = { clientType };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              // Create span in replay mode
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `pg.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "pg",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayConnect(callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real connect
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `pg.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "pg",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordConnectInSpan(spanInfo, originalConnect, callback, this);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalConnect.apply(this, [callback]);
        }
      };
    };
  }

  parseQueryArgs(args: any[]): QueryConfig | null {
    if (args.length === 0) return null;

    const firstArg = args[0];

    // String query: query(text, values?, callback?)
    if (typeof firstArg === "string") {
      const config: QueryConfig = {
        text: firstArg,
        callback: typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined,
      };
      if (Array.isArray(args[1])) {
        config.values = args[1];
      }
      return config;
    }

    // Query config object: query(config, callback?)
    if (typeof firstArg === "object" && firstArg.text) {
      return {
        text: firstArg.text,
        values: firstArg.values,
        callback: firstArg.callback || (typeof args[1] === "function" ? args[1] : undefined),
      };
    }

    return null;
  }

  private _handleRecordQueryInSpan(
    spanInfo: SpanInfo,
    originalQuery: Function,
    queryConfig: QueryConfig,
    args: any[],
    context: Query,
  ): Query {
    const hasCallback = !!queryConfig.callback;

    if (hasCallback) {
      // Callback-based query
      const originalCallback = queryConfig.callback!;
      const wrappedCallback = (error: Error | null, result?: PgResult) => {
        if (error) {
          logger.debug(
            `[PgInstrumentation] PG query error (hasCallback): ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[PgInstrumentation] PG query completed successfully (hasCallback) (${SpanUtils.getTraceInfo()})`,
          );
          try {
            this._addOutputAttributesToSpan(spanInfo, result);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing response:`, error);
          }
        }
        return originalCallback(error, result);
      };

      // Replace callback in args
      try {
        const firstArg = args[0];
        const isConfigObject = typeof firstArg === "object" && firstArg.text && firstArg.callback;

        if (isConfigObject) {
          // Callback was in config object
          const configIndex = 0; // First argument is the config
          args[configIndex] = { ...args[configIndex], callback: wrappedCallback };
        } else {
          // Callback was separate argument (last argument)
          const callbackIndex = args.findIndex((arg) => typeof arg === "function");
          if (callbackIndex >= 0) {
            args[callbackIndex] = wrappedCallback;
          }
        }
      } catch (error) {
        logger.error(`[PgInstrumentation] error replacing callback:`, error, args);
      }

      return originalQuery.apply(context, args);
    } else {
      // Promise-based query
      const promise = originalQuery.apply(context, args);

      return promise
        .then((result: PgResult) => {
          logger.debug(
            `[PgInstrumentation] PG query completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            this._addOutputAttributesToSpan(spanInfo, result);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing response:`, error);
          }
          return result;
        })
        .catch((error: Error) => {
          logger.debug(
            `[PgInstrumentation] PG query error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
          throw error;
        });
    }
  }

  async handleReplayQuery(
    queryConfig: QueryConfig,
    inputValue: PgClientInputValue,
    spanInfo: SpanInfo,
  ): Promise<any> {
    logger.debug(`[PgInstrumentation] Replaying PG query`);

    const packageName = inputValue.clientType === "pool" ? "pg-pool" : "pg";
    const spanName = inputValue.clientType === "pool" ? "pg-pool.query" : "pg.query";

    // Look for matching recorded response
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: spanName,
        inputValue: inputValue,
        packageName: packageName,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "query",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      const queryText = queryConfig.text || inputValue.text || "UNKNOWN_QUERY";
      logger.warn(`[PgInstrumentation] No mock data found for PG query: ${queryText}`);
      if (queryConfig.callback) {
        process.nextTick(() => queryConfig.callback!(new Error("No mock data found")));
        return;
      } else {
        return Promise.reject(new Error("No mock data found"));
      }
    }

    // Convert string timestamps back to Date objects based on field metadata
    const processedResult = this.convertPostgresTypes(mockData.result);

    // Return mocked response
    if (queryConfig.callback) {
      process.nextTick(() => {
        queryConfig.callback!(null, processedResult);
      });
      return;
    } else {
      return Promise.resolve(processedResult);
    }
  }

  /**
   * Convert PostgreSQL string values back to appropriate JavaScript types
   * based on field metadata from the recorded response.
   *
   * Reference for data type IDs: https://jdbc.postgresql.org/documentation/publicapi/constant-values.html
   */
  private convertPostgresTypes(result: any): any {
    if (!result || !result.fields || !result.rows) {
      return result;
    }

    // Create a map of field names to their PostgreSQL data types
    const fieldTypeMap: Record<string, number> = {};
    result.fields.forEach((field: any) => {
      fieldTypeMap[field.name] = field.dataTypeID;
    });

    // Convert rows based on field types
    const convertedRows = result.rows.map((row: any, rowIndex: number) => {
      const convertedRow = { ...row };

      Object.keys(row).forEach((fieldName) => {
        const dataTypeID = fieldTypeMap[fieldName];
        const value = row[fieldName];

        if (value === null || value === undefined) {
          return; // Keep null/undefined values as-is
        }

        switch (dataTypeID) {
          case 1184: // timestamptz (timestamp with timezone)
          case 1114: // timestamp (timestamp without timezone)
            if (typeof value === "string") {
              const dateObj = new Date(value);
              convertedRow[fieldName] = dateObj;
            }
            break;
          case 1082: // date
            if (typeof value === "string") {
              convertedRow[fieldName] = new Date(value);
            }
            break;
          case 1083: // time
          case 1266: // timetz (time with timezone)
            // Keep time fields as strings for now, as they're not typically
            // converted to Date objects by pg client
            break;
          // Add other type conversions as needed
          default:
            // Keep other types as-is
            break;
        }
      });

      return convertedRow;
    });

    const finalResult = {
      ...result,
      rows: convertedRows,
    };

    return finalResult;
  }

  private _handleRecordConnectInSpan(
    spanInfo: SpanInfo,
    originalConnect: Function,
    callback: Function | undefined,
    context: Connection,
  ): Connection {
    if (callback) {
      // Callback-based connect
      const wrappedCallback = (error: Error | null) => {
        if (error) {
          logger.debug(
            `[PgInstrumentation] PG connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[PgInstrumentation] PG connect completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { connected: true },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing connect response:`, error);
          }
        }
        return callback(error);
      };

      return originalConnect.call(context, wrappedCallback);
    } else {
      // Promise-based connect
      const promise = originalConnect.call(context);

      return promise
        .then((result: Connection) => {
          logger.debug(
            `[PgInstrumentation] PG connect completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { connected: true },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing connect response:`, error);
          }
          return result;
        })
        .catch((error: Error) => {
          logger.debug(
            `[PgInstrumentation] PG connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
          throw error;
        });
    }
  }

  private _handleReplayConnect(callback?: Function) {
    logger.debug(`[PgInstrumentation] Replaying PG connect`);

    // For connect operations, just simulate success
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    } else {
      return Promise.resolve();
    }
  }

  private _addOutputAttributesToSpan(spanInfo: SpanInfo, result?: PgResult): void {
    if (!result) return;

    const outputValue = {
      command: result.command,
      rowCount: result.rowCount,
      oid: result.oid,
      rows: result.rows || [],
      fields: result.fields || [],
    };

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _patchPgPoolModule(pgPoolModule: PgPoolModuleExports): PgPoolModuleExports {
    if (pgPoolModule._tdPatched) {
      logger.debug(`[PgInstrumentation] PG Pool module already patched, skipping`);
      return pgPoolModule;
    }

    // Wrap Pool.prototype.query
    if (pgPoolModule.prototype) {
      this._wrap(pgPoolModule.prototype, "query", this._getQueryPatchFn("pool"));
      logger.debug(`[PgInstrumentation] Wrapped Pool.prototype.query`);
    }

    // Wrap Pool.prototype.connect
    if (pgPoolModule.prototype) {
      this._wrap(pgPoolModule.prototype, "connect", this._getPoolConnectPatchFn());
      logger.debug(`[PgInstrumentation] Wrapped Pool.prototype.connect`);
    }

    pgPoolModule._tdPatched = true;
    logger.debug(`[PgInstrumentation] PG Pool module patching complete`);

    return pgPoolModule;
  }

  private _getPoolConnectPatchFn() {
    const self = this;

    return (originalConnect: Function) => {
      return function connect(this: Connection, callback?: Function) {
        const inputValue = { clientType: "pool" };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `pg-pool.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "pg-pool",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayPoolConnect(spanInfo, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real connect
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `pg-pool.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "pg-pool",
                  packageType: PackageType.PG,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordPoolConnectInSpan(
                    spanInfo,
                    originalConnect,
                    callback,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalConnect.apply(this, [callback]);
        }
      };
    };
  }

  private _handleRecordPoolConnectInSpan(
    spanInfo: SpanInfo,
    originalConnect: Function,
    callback: Function | undefined,
    context: Connection,
  ): Connection {
    if (callback) {
      // Callback-based pool connect
      const wrappedCallback = (error: Error | null, client?: PoolClient, done?: Function) => {
        if (error) {
          logger.debug(
            `[PgInstrumentation] PG Pool connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[PgInstrumentation] PG Pool connect completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: {
                connected: true,
                hasClient: !!client,
              },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing pool connect response:`, error);
          }
        }
        return callback(error, client, done);
      };

      return originalConnect.call(context, wrappedCallback);
    } else {
      // Promise-based pool connect
      const promise = originalConnect.call(context);

      return promise
        .then((client: PoolClient) => {
          logger.debug(
            `[PgInstrumentation] PG Pool connect completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: {
                connected: true,
                hasClient: !!client,
              },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[PgInstrumentation] error processing pool connect response:`, error);
          }
          return client;
        })
        .catch((error: Error) => {
          logger.debug(
            `[PgInstrumentation] PG Pool connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[PgInstrumentation] error ending span:`, error);
          }
          throw error;
        });
    }
  }

  private _handleReplayPoolConnect(spanInfo: SpanInfo, callback?: Function) {
    logger.debug(`[PgInstrumentation] Replaying PG Pool connect`);

    // For pool connect operations, simulate returning a mock client
    // The client's query method should also be instrumented for replay
    const mockClient = new TdPgClientMock(this, spanInfo);

    if (callback) {
      process.nextTick(() => callback(null, mockClient, () => {}));
      return;
    } else {
      return Promise.resolve(mockClient);
    }
  }

  private _wrap(
    target: Query | Connection | Client | Pool,
    propertyName: string,
    wrapper: (original: any) => any,
  ): void {
    wrap(target, propertyName, wrapper);
  }
}
