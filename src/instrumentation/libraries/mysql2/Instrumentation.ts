import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { wrap, isWrapped } from "../../core/utils/shimmerUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  Mysql2InputValue,
  Mysql2InstrumentationConfig,
  Mysql2QueryConfig,
  Connection,
  Pool,
  PoolConnection,
  QueryError,
  FieldPacket,
  QueryCallback,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils/logger";
import { TdMysql2ConnectionMock } from "./mocks/TdMysql2ConnectionMock";
import { TdMysql2QueryMock } from "./mocks/TdMysql2QueryMock";

const SUPPORTED_VERSIONS = [">=3.0.0 <4.0.0"];

export class Mysql2Instrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "Mysql2Instrumentation";
  private mode: TuskDriftMode;
  private queryMock: TdMysql2QueryMock;

  constructor(config: Mysql2InstrumentationConfig = {}) {
    super("mysql2", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.queryMock = new TdMysql2QueryMock();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "mysql2",
        supportedVersions: SUPPORTED_VERSIONS,
        files: [
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/base/connection.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchBaseConnection(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/connection.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchConnection(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchPool(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool_connection.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchPoolConnection(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/create_connection.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchCreateConnectionFile(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/create_pool.js",
            supportedVersions: SUPPORTED_VERSIONS,
            patch: (moduleExports: any) => this._patchCreatePoolFile(moduleExports),
          }),
        ],
      }),
    ];
  }

  private _patchBaseConnection(BaseConnectionClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching BaseConnection class`);

    if (this.isModulePatched(BaseConnectionClass)) {
      logger.debug(`[Mysql2Instrumentation] BaseConnection class already patched, skipping`);
      return BaseConnectionClass;
    }

    // Wrap BaseConnection.prototype.query
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.query) {
      if (!isWrapped(BaseConnectionClass.prototype.query)) {
        this._wrap(BaseConnectionClass.prototype, "query", this._getQueryPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.query`);
      }
    }

    // Wrap BaseConnection.prototype.execute (prepared statements)
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.execute) {
      if (!isWrapped(BaseConnectionClass.prototype.execute)) {
        this._wrap(BaseConnectionClass.prototype, "execute", this._getExecutePatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.execute`);
      }
    }

    // Wrap BaseConnection.prototype.connect
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.connect) {
      if (!isWrapped(BaseConnectionClass.prototype.connect)) {
        this._wrap(BaseConnectionClass.prototype, "connect", this._getConnectPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.connect`);
      }
    }

    // Wrap BaseConnection.prototype.ping
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.ping) {
      if (!isWrapped(BaseConnectionClass.prototype.ping)) {
        this._wrap(BaseConnectionClass.prototype, "ping", this._getPingPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.ping`);
      }
    }

    // Wrap BaseConnection.prototype.end
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.end) {
      if (!isWrapped(BaseConnectionClass.prototype.end)) {
        this._wrap(BaseConnectionClass.prototype, "end", this._getEndPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.end`);
      }
    }

    this.markModuleAsPatched(BaseConnectionClass);
    logger.debug(`[Mysql2Instrumentation] BaseConnection class patching complete`);

    return BaseConnectionClass;
  }

  private _patchConnection(ConnectionClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching Connection class`);

    if (this.isModulePatched(ConnectionClass)) {
      logger.debug(`[Mysql2Instrumentation] Connection class already patched, skipping`);
      return ConnectionClass;
    }

    // Wrap Connection.prototype.query
    if (ConnectionClass.prototype && ConnectionClass.prototype.query) {
      if (!isWrapped(ConnectionClass.prototype.query)) {
        this._wrap(ConnectionClass.prototype, "query", this._getQueryPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.query`);
      }
    }

    // Wrap Connection.prototype.execute (prepared statements)
    if (ConnectionClass.prototype && ConnectionClass.prototype.execute) {
      if (!isWrapped(ConnectionClass.prototype.execute)) {
        this._wrap(ConnectionClass.prototype, "execute", this._getExecutePatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.execute`);
      }
    }

    // Wrap Connection.prototype.connect
    if (ConnectionClass.prototype && ConnectionClass.prototype.connect) {
      if (!isWrapped(ConnectionClass.prototype.connect)) {
        this._wrap(ConnectionClass.prototype, "connect", this._getConnectPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.connect`);
      }
    }

    // Wrap Connection.prototype.ping
    if (ConnectionClass.prototype && ConnectionClass.prototype.ping) {
      if (!isWrapped(ConnectionClass.prototype.ping)) {
        this._wrap(ConnectionClass.prototype, "ping", this._getPingPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.ping`);
      }
    }

    // Wrap Connection.prototype.end
    if (ConnectionClass.prototype && ConnectionClass.prototype.end) {
      if (!isWrapped(ConnectionClass.prototype.end)) {
        this._wrap(ConnectionClass.prototype, "end", this._getEndPatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.end`);
      }
    }

    this.markModuleAsPatched(ConnectionClass);
    logger.debug(`[Mysql2Instrumentation] Connection class patching complete`);

    return ConnectionClass;
  }

  private _patchPool(PoolClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching Pool class`);

    if (this.isModulePatched(PoolClass)) {
      logger.debug(`[Mysql2Instrumentation] Pool class already patched, skipping`);
      return PoolClass;
    }

    // Wrap Pool.prototype.query
    if (PoolClass.prototype && PoolClass.prototype.query) {
      if (!isWrapped(PoolClass.prototype.query)) {
        this._wrap(PoolClass.prototype, "query", this._getQueryPatchFn("pool"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Pool.prototype.query`);
      }
    }

    // Wrap Pool.prototype.execute (prepared statements)
    if (PoolClass.prototype && PoolClass.prototype.execute) {
      if (!isWrapped(PoolClass.prototype.execute)) {
        this._wrap(PoolClass.prototype, "execute", this._getExecutePatchFn("pool"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Pool.prototype.execute`);
      }
    }

    // Wrap Pool.prototype.getConnection
    if (PoolClass.prototype && PoolClass.prototype.getConnection) {
      if (!isWrapped(PoolClass.prototype.getConnection)) {
        this._wrap(PoolClass.prototype, "getConnection", this._getPoolGetConnectionPatchFn());
        logger.debug(`[Mysql2Instrumentation] Wrapped Pool.prototype.getConnection`);
      }
    }

    this.markModuleAsPatched(PoolClass);
    logger.debug(`[Mysql2Instrumentation] Pool class patching complete`);

    return PoolClass;
  }

  private _patchPoolConnection(PoolConnectionClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching PoolConnection class`);

    if (this.isModulePatched(PoolConnectionClass)) {
      logger.debug(`[Mysql2Instrumentation] PoolConnection class already patched, skipping`);
      return PoolConnectionClass;
    }

    // Wrap PoolConnection.prototype.query with poolConnection client type
    if (PoolConnectionClass.prototype && PoolConnectionClass.prototype.query) {
      if (!isWrapped(PoolConnectionClass.prototype.query)) {
        this._wrap(PoolConnectionClass.prototype, "query", this._getQueryPatchFn("poolConnection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped PoolConnection.prototype.query`);
      }
    }

    // Wrap PoolConnection.prototype.execute (prepared statements)
    if (PoolConnectionClass.prototype && PoolConnectionClass.prototype.execute) {
      if (!isWrapped(PoolConnectionClass.prototype.execute)) {
        this._wrap(PoolConnectionClass.prototype, "execute", this._getExecutePatchFn("poolConnection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped PoolConnection.prototype.execute`);
      }
    }

    this.markModuleAsPatched(PoolConnectionClass);
    logger.debug(`[Mysql2Instrumentation] PoolConnection class patching complete`);

    return PoolConnectionClass;
  }

  private _getQueryPatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalQuery: Function) => {
      return function query(this: Connection | Pool | PoolConnection, ...args: any[]) {
        // Parse query arguments - mysql2 supports multiple signatures
        let queryConfig: Mysql2QueryConfig | null = null;
        try {
          queryConfig = self.parseQueryArgs(args);
        } catch (error) {
          logger.error(`[Mysql2Instrumentation] error parsing query args:`, error);
        }

        if (!queryConfig || !queryConfig.sql) {
          // If we can't parse the query, let it pass through
          logger.debug(`[Mysql2Instrumentation] Could not parse query, returning`, args);
          return originalQuery.apply(this, args);
        }

        const inputValue: Mysql2InputValue = {
          sql: queryConfig.sql,
          values: queryConfig.values || [],
          clientType,
        };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              const spanName = `mysql2.${clientType}.query`;
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.MYSQL,
                  packageName: "mysql2",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.handleReplayQuery(queryConfig, inputValue, spanInfo, "query");
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalQuery.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real query
              const spanName = `mysql2.${clientType}.query`;
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  packageName: "mysql2",
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

  private _getExecutePatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalExecute: Function) => {
      return function execute(this: Connection | Pool | PoolConnection, ...args: any[]) {
        // Parse execute arguments - similar to query but for prepared statements
        let queryConfig: Mysql2QueryConfig | null = null;
        try {
          queryConfig = self.parseQueryArgs(args);
        } catch (error) {
          logger.error(`[Mysql2Instrumentation] error parsing execute args:`, error);
        }

        if (!queryConfig || !queryConfig.sql) {
          // If we can't parse the query, let it pass through
          logger.debug(`[Mysql2Instrumentation] Could not parse execute, returning`, args);
          return originalExecute.apply(this, args);
        }

        const inputValue: Mysql2InputValue = {
          sql: queryConfig.sql,
          values: queryConfig.values || [],
          clientType,
        };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              const spanName = `mysql2.${clientType}.execute`;
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExecute.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "execute",
                  packageType: PackageType.MYSQL,
                  packageName: "mysql2",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.handleReplayQuery(queryConfig, inputValue, spanInfo, "execute");
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalExecute.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real query
              const spanName = `mysql2.${clientType}.execute`;
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExecute.apply(this, args),
                {
                  name: spanName,
                  kind: SpanKind.CLIENT,
                  submodule: "execute",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  packageName: "mysql2",
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordQueryInSpan(
                    spanInfo,
                    originalExecute,
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
          return originalExecute.apply(this, args);
        }
      };
    };
  }

  private _getPoolGetConnectionPatchFn() {
    const self = this;

    return (originalGetConnection: Function) => {
      return function getConnection(this: Pool, callback?: QueryCallback) {
        const inputValue = { clientType: "pool" as const };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGetConnection.apply(this, [callback]),
                {
                  name: `mysql2.pool.getConnection`,
                  kind: SpanKind.CLIENT,
                  submodule: "getConnection",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayPoolGetConnection(spanInfo, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalGetConnection.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real getConnection
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGetConnection.apply(this, [callback]),
                {
                  name: `mysql2.pool.getConnection`,
                  kind: SpanKind.CLIENT,
                  submodule: "getConnection",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordPoolGetConnectionInSpan(
                    spanInfo,
                    originalGetConnection,
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
          return originalGetConnection.apply(this, [callback]);
        }
      };
    };
  }

  private _getConnectPatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalConnect: Function) => {
      return function connect(this: Connection, callback?: Function) {
        const inputValue = { clientType };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  // In replay mode, just return success immediately
                  if (callback) {
                    process.nextTick(() => callback(null));
                    return;
                  }
                  return Promise.resolve();
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.connect`,
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleSimpleCallbackMethod(
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
          return originalConnect.apply(this, [callback]);
        }
      };
    };
  }

  private _getPingPatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalPing: Function) => {
      return function ping(this: Connection, callback?: Function) {
        const inputValue = { clientType };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalPing.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.ping`,
                  kind: SpanKind.CLIENT,
                  submodule: "ping",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  // In replay mode, just return success immediately
                  if (callback) {
                    process.nextTick(() => callback(null));
                    return;
                  }
                  return Promise.resolve();
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalPing.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalPing.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.ping`,
                  kind: SpanKind.CLIENT,
                  submodule: "ping",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleSimpleCallbackMethod(
                    spanInfo,
                    originalPing,
                    callback,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalPing.apply(this, [callback]);
        }
      };
    };
  }

  private _getEndPatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalEnd: Function) => {
      return function end(this: Connection, callback?: Function) {
        const inputValue = { clientType };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalEnd.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.end`,
                  kind: SpanKind.CLIENT,
                  submodule: "end",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  // In replay mode, just return success immediately
                  if (callback) {
                    process.nextTick(() => callback(null));
                    return;
                  }
                  return Promise.resolve();
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalEnd.apply(this, [callback]),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalEnd.apply(this, [callback]),
                {
                  name: `mysql2.${clientType}.end`,
                  kind: SpanKind.CLIENT,
                  submodule: "end",
                  packageName: "mysql2",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleSimpleCallbackMethod(
                    spanInfo,
                    originalEnd,
                    callback,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalEnd.apply(this, [callback]);
        }
      };
    };
  }

  private _handleSimpleCallbackMethod(
    spanInfo: SpanInfo,
    originalMethod: Function,
    callback: Function | undefined,
    context: any,
  ): any {
    if (callback) {
      const wrappedCallback = (error: Error | null) => {
        if (error) {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 method error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 method completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { success: true },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error processing response:`, error);
          }
        }
        return callback(error);
      };

      return originalMethod.call(context, wrappedCallback);
    } else {
      // No callback provided - some methods might return a promise, some might not
      // For methods like connect(), ping(), end(), we need to handle both cases
      const result = originalMethod.call(context);

      // Check if result is a promise
      if (result && typeof result.then === "function") {
        return result
          .then(() => {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 method completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            try {
              SpanUtils.addSpanAttributes(spanInfo.span, {
                outputValue: { success: true },
              });
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error processing response:`, error);
            }
          })
          .catch((error: Error) => {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 method error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error.message,
              });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error ending span:`, error);
            }
            throw error;
          });
      } else {
        // Not a promise - just return the result and end the span successfully
        logger.debug(
          `[Mysql2Instrumentation] MySQL2 method completed (non-promise) (${SpanUtils.getTraceInfo()})`,
        );
        try {
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { success: true },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(`[Mysql2Instrumentation] error processing response:`, error);
        }
        return result;
      }
    }
  }

  parseQueryArgs(args: any[]): Mysql2QueryConfig | null {
    if (args.length === 0) return null;

    const firstArg = args[0];

    // String query: query(sql, values?, callback?)
    if (typeof firstArg === "string") {
      const config: Mysql2QueryConfig = {
        sql: firstArg,
        callback:
          typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined,
      };
      if (Array.isArray(args[1])) {
        config.values = args[1];
      } else if (args.length > 1 && typeof args[1] !== "function") {
        config.values = [args[1]];
      }
      return config;
    }

    // Query options object: query(options, callback?)
    if (typeof firstArg === "object" && firstArg.sql) {
      return {
        sql: firstArg.sql,
        values: firstArg.values,
        callback: firstArg.callback || (typeof args[1] === "function" ? args[1] : undefined),
      };
    }

    return null;
  }

  private _handleRecordQueryInSpan(
    spanInfo: SpanInfo,
    originalQuery: Function,
    queryConfig: Mysql2QueryConfig,
    args: any[],
    context: Connection | Pool | PoolConnection,
  ): any {
    const hasCallback = !!queryConfig.callback;

    if (hasCallback) {
      // Callback-based query
      const originalCallback = queryConfig.callback!;
      const wrappedCallback = (error: QueryError | null, results?: any, fields?: FieldPacket[]) => {
        if (error) {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 query error (hasCallback): ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 query completed successfully (hasCallback) (${SpanUtils.getTraceInfo()})`,
          );
          try {
            this._addOutputAttributesToSpan(spanInfo, results, fields);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error processing response:`, error);
          }
        }
        return originalCallback(error, results, fields);
      };

      // Replace callback in args
      try {
        const firstArg = args[0];
        const isOptionsObject = typeof firstArg === "object" && firstArg.sql;

        if (isOptionsObject && firstArg.callback) {
          // Callback was in options object
          args[0] = { ...args[0], callback: wrappedCallback };
        } else {
          // Callback was separate argument (last argument)
          const callbackIndex = args.findIndex((arg) => typeof arg === "function");
          if (callbackIndex >= 0) {
            args[callbackIndex] = wrappedCallback;
          }
        }
      } catch (error) {
        logger.error(`[Mysql2Instrumentation] error replacing callback:`, error, args);
      }

      return originalQuery.apply(context, args);
    } else {
      // Promise-based query or streaming query (no callback)
      const result = originalQuery.apply(context, args);

      // For streaming queries (event emitters), attach event listeners
      // In mysql2, streaming queries are identified by checking if result has 'on' method
      // and we're NOT using it as a promise (not calling .then() explicitly)
      if (result && typeof result.on === "function") {
        // Collect data for streaming queries
        const streamResults: any[] = [];
        let streamFields: any = null;

        result
          .on("error", (error: Error) => {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 stream query error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error.message,
              });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error ending span:`, error);
            }
          })
          .on("fields", (fields: any) => {
            streamFields = fields;
          })
          .on("result", (row: any) => {
            streamResults.push(row);
          })
          .on("end", () => {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 stream query completed (${SpanUtils.getTraceInfo()})`,
            );
            try {
              this._addOutputAttributesToSpan(spanInfo, streamResults, streamFields);
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error ending span:`, error);
            }
          });
      }

      return result;
    }
  }

  handleReplayQuery(
    queryConfig: Mysql2QueryConfig,
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    submoduleName: string = "query",
  ): any {
    return this.queryMock.handleReplayQuery(queryConfig, inputValue, spanInfo, submoduleName);
  }

  private _handleRecordPoolGetConnectionInSpan(
    spanInfo: SpanInfo,
    originalGetConnection: Function,
    callback: Function | undefined,
    context: Pool,
  ): any {
    if (callback) {
      // Callback-based getConnection
      const wrappedCallback = (error: Error | null, connection?: PoolConnection) => {
        if (error) {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 Pool getConnection error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error ending span:`, error);
          }
        } else {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 Pool getConnection completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: {
                connected: true,
                hasConnection: !!connection,
              },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error processing getConnection response:`, error);
          }
        }
        return callback(error, connection);
      };

      return originalGetConnection.call(context, wrappedCallback);
    } else {
      // Promise-based getConnection
      const promise = originalGetConnection.call(context);

      return promise
        .then((connection: PoolConnection) => {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 Pool getConnection completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: {
                connected: true,
                hasConnection: !!connection,
              },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error processing getConnection response:`, error);
          }
          return connection;
        })
        .catch((error: Error) => {
          logger.debug(
            `[Mysql2Instrumentation] MySQL2 Pool getConnection error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[Mysql2Instrumentation] error ending span:`, error);
          }
          throw error;
        });
    }
  }

  private _handleReplayPoolGetConnection(spanInfo: SpanInfo, callback?: Function) {
    logger.debug(`[Mysql2Instrumentation] Replaying MySQL2 Pool getConnection`);

    // For pool getConnection operations, simulate returning a mock connection
    const mockConnection = new TdMysql2ConnectionMock(this, spanInfo, "pool");

    if (callback) {
      process.nextTick(() => callback(null, mockConnection));
      return;
    } else {
      return Promise.resolve(mockConnection);
    }
  }

  private _addOutputAttributesToSpan(
    spanInfo: SpanInfo,
    result?: any,
    fields?: FieldPacket[],
  ): void {
    if (!result) return;

    // Handle different result types
    let outputValue: any = {};

    if (Array.isArray(result)) {
      // SELECT query - array of rows
      outputValue = {
        rowCount: result.length,
        rows: result,
        fields: fields || [],
      };
    } else if (result.affectedRows !== undefined) {
      // INSERT/UPDATE/DELETE query - OkPacket or ResultSetHeader
      outputValue = {
        affectedRows: result.affectedRows,
        insertId: result.insertId,
        warningCount: result.warningCount,
      };
    } else {
      // Other result types
      outputValue = result;
    }

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _patchCreateConnectionFile(createConnectionFn: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching create_connection.js file`);

    // The module exports a single function, but we can't wrap module.exports directly with shimmer
    // Instead, we need to return a wrapped function
    const self = this;
    const wrappedFn = function (this: any, ...args: any[]) {
      const inputValue = { method: "createConnection" };

      if (self.mode === TuskDriftMode.REPLAY) {
        return handleReplayMode({
          replayModeHandler: () => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => createConnectionFn.apply(this, args),
              {
                name: `mysql2.createConnection`,
                kind: SpanKind.CLIENT,
                submodule: "createConnection",
                packageName: "mysql2",
                packageType: PackageType.MYSQL,
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue: inputValue,
                isPreAppStart: false,
              },
              (spanInfo) => {
                const connection = createConnectionFn.apply(this, args);
                SpanUtils.addSpanAttributes(spanInfo.span, {
                  outputValue: { created: true },
                });
                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                return connection;
              },
            );
          },
        });
      } else if (self.mode === TuskDriftMode.RECORD) {
        return handleRecordMode({
          originalFunctionCall: () => createConnectionFn.apply(this, args),
          recordModeHandler: ({ isPreAppStart }) => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => createConnectionFn.apply(this, args),
              {
                name: `mysql2.createConnection`,
                kind: SpanKind.CLIENT,
                submodule: "createConnection",
                packageName: "mysql2",
                packageType: PackageType.MYSQL,
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue: inputValue,
                isPreAppStart,
              },
              (spanInfo) => {
                const connection = createConnectionFn.apply(this, args);
                SpanUtils.addSpanAttributes(spanInfo.span, {
                  outputValue: { created: true },
                });
                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                return connection;
              },
            );
          },
          spanKind: SpanKind.CLIENT,
        });
      } else {
        return createConnectionFn.apply(this, args);
      }
    };

    logger.debug(`[Mysql2Instrumentation] Patched create_connection.js file`);
    return wrappedFn;
  }

  private _patchCreatePoolFile(createPoolFn: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching create_pool.js file`);

    const self = this;
    const wrappedFn = function (this: any, ...args: any[]) {
      const inputValue = { method: "createPool" };

      if (self.mode === TuskDriftMode.REPLAY) {
        return handleReplayMode({
          replayModeHandler: () => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => createPoolFn.apply(this, args),
              {
                name: `mysql2.createPool`,
                kind: SpanKind.CLIENT,
                submodule: "createPool",
                packageName: "mysql2",
                packageType: PackageType.MYSQL,
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue: inputValue,
                isPreAppStart: false,
              },
              (spanInfo) => {
                const pool = createPoolFn.apply(this, args);
                SpanUtils.addSpanAttributes(spanInfo.span, {
                  outputValue: { created: true },
                });
                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                return pool;
              },
            );
          },
        });
      } else if (self.mode === TuskDriftMode.RECORD) {
        return handleRecordMode({
          originalFunctionCall: () => createPoolFn.apply(this, args),
          recordModeHandler: ({ isPreAppStart }) => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => createPoolFn.apply(this, args),
              {
                name: `mysql2.createPool`,
                kind: SpanKind.CLIENT,
                submodule: "createPool",
                packageName: "mysql2",
                packageType: PackageType.MYSQL,
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue: inputValue,
                isPreAppStart,
              },
              (spanInfo) => {
                const pool = createPoolFn.apply(this, args);
                SpanUtils.addSpanAttributes(spanInfo.span, {
                  outputValue: { created: true },
                });
                SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                return pool;
              },
            );
          },
          spanKind: SpanKind.CLIENT,
        });
      } else {
        return createPoolFn.apply(this, args);
      }
    };

    logger.debug(`[Mysql2Instrumentation] Patched create_pool.js file`);
    return wrappedFn;
  }

  private _wrap(
    target: Connection | Pool | PoolConnection,
    propertyName: string,
    wrapper: (original: any) => any,
  ): void {
    wrap(target, propertyName, wrapper);
  }
}
