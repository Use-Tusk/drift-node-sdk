import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap, isWrapped } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  MysqlModuleExports,
  MysqlQueryInputValue,
  MysqlConnectionInputValue,
  MysqlTransactionInputValue,
  MysqlInstrumentationConfig,
  MysqlOutputValue,
  MysqlQueryResult,
  isMysqlOkPacket,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils";
import { EventEmitter } from "events";
import { TdMysqlConnectionMock } from "./mocks/TdMysqlConnectionMock";
import { TdMysqlQueryMock } from "./mocks/TdMysqlQueryMock";

export class MysqlInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "MysqlInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private queryMock: TdMysqlQueryMock;

  constructor(config: MysqlInstrumentationConfig = {}) {
    super("mysql", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
    this.queryMock = new TdMysqlQueryMock();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "mysql",
        supportedVersions: ["2.*"],
        files: [
          // Patch mysql/lib/Connection.js at the prototype level
          new TdInstrumentationNodeModuleFile({
            name: "mysql/lib/Connection.js",
            supportedVersions: ["2.*"],
            patch: (moduleExports: any) => this._patchConnectionFile(moduleExports),
          }),
          // Patch mysql/lib/Pool.js at the prototype level
          new TdInstrumentationNodeModuleFile({
            name: "mysql/lib/Pool.js",
            supportedVersions: ["2.*"],
            patch: (moduleExports: any) => this._patchPoolFile(moduleExports),
          }),
        ],
      }),
    ];
  }

  /**
   * Patch Connection.prototype methods at the file level
   * This ensures ALL connection instances have patched methods
   */
  private _patchConnectionFile(ConnectionClass: any): any {
    logger.debug(`[MysqlInstrumentation] Patching Connection class (file-based)`);

    if (this.isModulePatched(ConnectionClass)) {
      logger.debug(`[MysqlInstrumentation] Connection class already patched, skipping`);
      return ConnectionClass;
    }

    // Wrap Connection.prototype.query
    if (ConnectionClass.prototype && ConnectionClass.prototype.query) {
      if (!isWrapped(ConnectionClass.prototype.query)) {
        this._wrap(ConnectionClass.prototype, "query", this._getQueryPatchFn("connection"));
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.query`);
      }
    }

    // Wrap Connection.prototype.connect
    if (ConnectionClass.prototype && ConnectionClass.prototype.connect) {
      if (!isWrapped(ConnectionClass.prototype.connect)) {
        this._wrap(ConnectionClass.prototype, "connect", this._getConnectPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.connect`);
      }
    }

    // Wrap Connection.prototype.beginTransaction
    if (ConnectionClass.prototype && ConnectionClass.prototype.beginTransaction) {
      if (!isWrapped(ConnectionClass.prototype.beginTransaction)) {
        this._wrap(
          ConnectionClass.prototype,
          "beginTransaction",
          this._getBeginTransactionPatchFn(),
        );
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.beginTransaction`);
      }
    }

    // Wrap Connection.prototype.commit
    if (ConnectionClass.prototype && ConnectionClass.prototype.commit) {
      if (!isWrapped(ConnectionClass.prototype.commit)) {
        this._wrap(ConnectionClass.prototype, "commit", this._getCommitPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.commit`);
      }
    }

    // Wrap Connection.prototype.rollback
    if (ConnectionClass.prototype && ConnectionClass.prototype.rollback) {
      if (!isWrapped(ConnectionClass.prototype.rollback)) {
        this._wrap(ConnectionClass.prototype, "rollback", this._getRollbackPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.rollback`);
      }
    }

    this.markModuleAsPatched(ConnectionClass);
    logger.debug(`[MysqlInstrumentation] Connection class patching complete`);

    return ConnectionClass;
  }

  /**
   * Patch Pool.prototype methods at the file level
   */
  private _patchPoolFile(PoolClass: any): any {
    logger.debug(`[MysqlInstrumentation] Patching Pool class (file-based)`);

    if (this.isModulePatched(PoolClass)) {
      logger.debug(`[MysqlInstrumentation] Pool class already patched, skipping`);
      return PoolClass;
    }

    // Wrap Pool.prototype.query
    if (PoolClass.prototype && PoolClass.prototype.query) {
      if (!isWrapped(PoolClass.prototype.query)) {
        this._wrap(PoolClass.prototype, "query", this._getQueryPatchFn("pool"));
        logger.debug(`[MysqlInstrumentation] Wrapped Pool.prototype.query`);
      }
    }

    // Wrap Pool.prototype.getConnection
    if (PoolClass.prototype && PoolClass.prototype.getConnection) {
      if (!isWrapped(PoolClass.prototype.getConnection)) {
        this._wrap(PoolClass.prototype, "getConnection", this._getPoolGetConnectionPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Pool.prototype.getConnection`);
      }
    }

    this.markModuleAsPatched(PoolClass);
    logger.debug(`[MysqlInstrumentation] Pool class patching complete`);

    return PoolClass;
  }

  /**
   * Get wrapper function for query method (prototype-level patching)
   */
  private _getQueryPatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalQuery: Function) => {
      return function query(this: any, ...args: any[]) {
        // Parse query arguments - MySQL supports multiple signatures
        let sql: string;
        let values: any[] | undefined;
        let callback: Function | undefined;
        let options: any = {};

        // Determine which signature is being used
        if (typeof args[0] === "string") {
          sql = args[0];
          if (typeof args[1] === "function") {
            callback = args[1];
          } else if (Array.isArray(args[1])) {
            values = args[1];
            callback = args[2] as Function | undefined;
          }
        } else if (typeof args[0] === "object") {
          options = args[0];
          sql = options.sql;
          values = options.values;
          if (typeof args[1] === "function") {
            callback = args[1];
          } else if (Array.isArray(args[1])) {
            values = args[1];
            callback = args[2] as Function | undefined;
          }
        } else {
          // Unknown signature, just pass through
          return originalQuery.apply(this, args);
        }

        const inputValue: MysqlQueryInputValue = {
          sql: sql,
          values: values,
          options: options.nestTables ? { nestTables: options.nestTables } : undefined,
        };

        const isEventEmitterMode = !callback;

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (isEventEmitterMode) {
                return self.queryMock.handleNoOpReplayQuery({ sql, values, callback, options });
              }
              return undefined;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: "mysql.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.queryMock.handleReplayQuery(
                    { sql, values, callback, options },
                    inputValue,
                    spanInfo,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalQuery.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(this, args),
                {
                  name: "mysql.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordQuery(
                    spanInfo,
                    originalQuery,
                    this,
                    args,
                    callback,
                    isEventEmitterMode,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalQuery.apply(this, args);
        }
      };
    };
  }

  /**
   * Get wrapper function for connect method
   */
  private _getConnectPatchFn() {
    const self = this;
    return (originalConnect: Function) => {
      return function connect(this: any, callback?: Function) {
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return originalConnect.apply(this, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalConnect.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for beginTransaction method
   */
  private _getBeginTransactionPatchFn() {
    const self = this;
    return (originalBeginTransaction: Function) => {
      return function beginTransaction(this: any, callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "BEGIN",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalBeginTransaction.apply(this, arguments),
                {
                  name: "mysql.beginTransaction",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalBeginTransaction.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalBeginTransaction.apply(this, arguments),
                {
                  name: "mysql.beginTransaction",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalBeginTransaction,
                    this,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalBeginTransaction.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for commit method
   */
  private _getCommitPatchFn() {
    const self = this;
    return (originalCommit: Function) => {
      return function commit(this: any, callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "COMMIT",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommit.apply(this, arguments),
                {
                  name: "mysql.commit",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalCommit.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommit.apply(this, arguments),
                {
                  name: "mysql.commit",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalCommit,
                    this,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalCommit.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for rollback method
   */
  private _getRollbackPatchFn() {
    const self = this;
    return (originalRollback: Function) => {
      return function rollback(this: any, callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "ROLLBACK",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRollback.apply(this, arguments),
                {
                  name: "mysql.rollback",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalRollback.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRollback.apply(this, arguments),
                {
                  name: "mysql.rollback",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalRollback,
                    this,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalRollback.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for Pool.getConnection method
   */
  private _getPoolGetConnectionPatchFn() {
    const self = this;
    return (originalGetConnection: Function) => {
      return function getConnection(this: any, callback?: Function) {
        const inputValue = { clientType: "pool" as const };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              return self._handleNoOpReplayGetConnection(callback);
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGetConnection.apply(this, [callback]),
                {
                  name: `mysql.pool.getConnection`,
                  kind: SpanKind.CLIENT,
                  submodule: "getConnection",
                  packageName: "mysql",
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
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGetConnection.apply(this, [callback]),
                {
                  name: `mysql.pool.getConnection`,
                  kind: SpanKind.CLIENT,
                  submodule: "getConnection",
                  packageName: "mysql",
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
          return originalGetConnection.apply(this, [callback]);
        }
      };
    };
  }

  private _patchQueryMethod(connection: any) {
    const self = this;
    return (originalQuery: Function) => {
      return function query(this: any, ...args: any[]) {
        // Parse query arguments - MySQL supports multiple signatures:
        // query(sql, callback)
        // query(sql, values, callback)
        // query(options, callback)
        // query(options, values, callback)

        let sql: string;
        let values: any[] | undefined;
        let callback: Function | undefined;
        let options: any = {};

        // Determine which signature is being used
        if (typeof args[0] === "string") {
          sql = args[0];
          if (typeof args[1] === "function") {
            callback = args[1];
          } else if (Array.isArray(args[1])) {
            values = args[1];
            callback = args[2] as Function | undefined;
          }
        } else if (typeof args[0] === "object") {
          options = args[0];
          sql = options.sql;
          values = options.values;
          if (typeof args[1] === "function") {
            callback = args[1];
          } else if (Array.isArray(args[1])) {
            values = args[1];
            callback = args[2] as Function | undefined;
          }
        } else {
          // Unknown signature, just pass through
          return originalQuery.apply(this, args);
        }

        const inputValue: MysqlQueryInputValue = {
          sql: sql,
          values: values,
          options: options.nestTables ? { nestTables: options.nestTables } : undefined,
        };

        const isEventEmitterMode = !callback;

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              // For background requests, return undefined or empty result
              if (isEventEmitterMode) {
                return new EventEmitter();
              }
              return undefined;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(connection, args),
                {
                  name: "mysql.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  // Use the queryMock to handle replay - returns EventEmitter synchronously
                  return self.queryMock.handleReplayQuery(
                    {
                      sql: inputValue.sql,
                      values: inputValue.values,
                      callback: callback,
                      options: inputValue.options,
                    },
                    inputValue,
                    spanInfo,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalQuery.apply(connection, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalQuery.apply(connection, args),
                {
                  name: "mysql.query",
                  kind: SpanKind.CLIENT,
                  submodule: "query",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordQuery(
                    spanInfo,
                    originalQuery,
                    connection,
                    args,
                    callback,
                    isEventEmitterMode,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Disabled mode - pass through
          return originalQuery.apply(connection, args);
        }
      };
    };
  }

  private _handleRecordQuery(
    spanInfo: SpanInfo,
    originalQuery: Function,
    connection: any,
    args: any[],
    callback: Function | undefined,
    isEventEmitterMode: boolean,
  ): any {
    if (isEventEmitterMode) {
      // Event emitter mode - wrap the query emitter
      const queryEmitter = originalQuery.apply(connection, args);

      const results: any[] = [];
      const fields: any[] = [];
      let error: any = null;
      let queryIndex = 0;

      queryEmitter
        .on("error", (err: any) => {
          error = err;
          logger.debug(`[MysqlInstrumentation] Query error: ${err.message}`);
        })
        .on("fields", (fieldPackets: any, index: number) => {
          fields[index] = fieldPackets;
        })
        .on("result", (row: any, index: number) => {
          queryIndex = index;
          if (!results[index]) {
            if (isMysqlOkPacket(row)) {
              results[index] = row;
            } else {
              results[index] = [];
            }
          }
          if (Array.isArray(results[index])) {
            results[index].push(row);
          }
        })
        .on("end", () => {
          const queryCount = queryIndex + 1;
          const outputValue: MysqlOutputValue = {
            results: queryCount > 1 ? results : results[0],
            fields: queryCount > 1 ? fields : fields[0],
            queryCount,
          };

          if (error) {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } else {
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          }

          logger.debug(`[MysqlInstrumentation] Query completed (${SpanUtils.getTraceInfo()})`);
        });

      return queryEmitter;
    } else {
      // Callback mode - wrap the callback
      const originalCallback = callback!;
      const callbackIndex = args.findIndex((arg) => typeof arg === "function");

      args[callbackIndex] = function (err: any, results: any, fields: any) {
        if (err) {
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
        } else {
          const outputValue: MysqlOutputValue = {
            results: results,
            fields: fields,
          };
          SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        }

        logger.debug(`[MysqlInstrumentation] Query completed (${SpanUtils.getTraceInfo()})`);

        return originalCallback.apply(this, arguments);
      };

      return originalQuery.apply(connection, args);
    }
  }

  private _patchConnect(connection: any) {
    const self = this;
    return (originalConnect: Function) => {
      return function connect(this: any, callback?: Function) {
        // In both record and replay modes, we need to wrap the connect call
        // to prevent TCP instrumentation from flagging it as an unpatched dependency

        if (self.mode === TuskDriftMode.REPLAY) {
          // In replay mode, we don't actually need to connect to the database
          // Just call the callback to signal success
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback());
              }
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          // In record mode, execute the actual connection
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(connection, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              // Just pass through - we don't need to record connect events
              return originalConnect.apply(connection, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Disabled mode
          return originalConnect.apply(connection, arguments);
        }
      };
    };
  }

  private _patchBeginTransaction(connection: any) {
    const self = this;
    return (originalBeginTransaction: Function) => {
      return function beginTransaction(callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "BEGIN",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                callback();
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalBeginTransaction.apply(connection, arguments),
                {
                  name: "mysql.beginTransaction",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalBeginTransaction.apply(connection, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalBeginTransaction.apply(connection, arguments),
                {
                  name: "mysql.beginTransaction",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalBeginTransaction,
                    connection,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalBeginTransaction.apply(connection, arguments);
        }
      };
    };
  }

  private _patchCommit(connection: any) {
    const self = this;
    return (originalCommit: Function) => {
      return function commit(callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "COMMIT",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                callback();
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommit.apply(connection, arguments),
                {
                  name: "mysql.commit",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalCommit.apply(connection, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommit.apply(connection, arguments),
                {
                  name: "mysql.commit",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalCommit,
                    connection,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalCommit.apply(connection, arguments);
        }
      };
    };
  }

  private _patchRollback(connection: any) {
    const self = this;
    return (originalRollback: Function) => {
      return function rollback(callback?: Function) {
        const inputValue: MysqlTransactionInputValue = {
          query: "ROLLBACK",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                callback();
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRollback.apply(connection, arguments),
                {
                  name: "mysql.rollback",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(spanInfo, inputValue, stackTrace, callback);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalRollback.apply(connection, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRollback.apply(connection, arguments),
                {
                  name: "mysql.rollback",
                  kind: SpanKind.CLIENT,
                  submodule: "transaction",
                  packageType: PackageType.UNSPECIFIED,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordTransaction(
                    spanInfo,
                    originalRollback,
                    connection,
                    arguments,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalRollback.apply(connection, arguments);
        }
      };
    };
  }

  private _handleRecordTransaction(
    spanInfo: SpanInfo,
    originalFunction: Function,
    connection: any,
    args: IArguments,
    callback: Function | undefined,
  ): any {
    if (!callback) {
      // No callback, just execute
      try {
        const result = originalFunction.apply(connection, args);
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: { status: "success" },
        });
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        return result;
      } catch (error: any) {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      }
    }

    // Wrap the callback
    const argsArray = Array.from(args);
    const callbackIndex = argsArray.findIndex((arg) => typeof arg === "function");

    if (callbackIndex !== -1) {
      const originalCallback = callback;
      argsArray[callbackIndex] = function (err: any) {
        if (err) {
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: err.message,
          });
        } else {
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { status: "success" },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        }

        logger.debug(`[MysqlInstrumentation] Transaction completed (${SpanUtils.getTraceInfo()})`);

        return originalCallback.apply(this, arguments);
      };
    }

    return originalFunction.apply(connection, argsArray);
  }

  private async _handleReplayTransaction(
    spanInfo: SpanInfo,
    inputValue: MysqlTransactionInputValue,
    stackTrace: string,
    callback: Function | undefined,
  ): Promise<any> {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL transaction: ${inputValue.query}`);

    // Transaction operations (BEGIN, COMMIT, ROLLBACK) don't need mocks
    // Only the actual SQL queries inside transactions are mocked
    // Just call the callback to signal success
    if (callback) {
      setImmediate(() => {
        callback();
      });
    }

    return undefined;
  }

  private _handleRecordPoolGetConnectionInSpan(
    spanInfo: SpanInfo,
    originalGetConnection: Function,
    callback: Function | undefined,
    context: any,
  ): any {
    const self = this;

    if (callback) {
      // Callback-based getConnection
      const wrappedCallback = (error: Error | null, connection?: any) => {
        if (error) {
          logger.debug(
            `[MysqlInstrumentation] MySQL Pool getConnection error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } else {
          logger.debug(
            `[MysqlInstrumentation] MySQL Pool getConnection completed successfully (${SpanUtils.getTraceInfo()})`,
          );

          // Patch the connection methods
          if (connection) {
            self._wrap(connection, "query", self._patchQueryMethod(connection));
            self._wrap(connection, "connect", self._patchConnect(connection));
            self._wrap(connection, "beginTransaction", self._patchBeginTransaction(connection));
            self._wrap(connection, "commit", self._patchCommit(connection));
            self._wrap(connection, "rollback", self._patchRollback(connection));
          }

          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: {
              connected: true,
              hasConnection: !!connection,
            },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        }
        return callback(error, connection);
      };

      return originalGetConnection.call(context, wrappedCallback);
    } else {
      // No callback - just execute and end span
      // MySQL module is callback-based, but handle this case anyway
      try {
        const result = originalGetConnection.call(context);
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: {
            connected: true,
            hasConnection: true,
          },
        });
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        return result;
      } catch (error: any) {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      }
    }
  }

  private _handleNoOpReplayGetConnection(callback?: Function): any {
    logger.debug(
      `[MysqlInstrumentation] Background getConnection detected, returning mock connection`,
    );

    const mockConnection = new TdMysqlConnectionMock(this, "pool");

    if (callback) {
      process.nextTick(() => callback(null, mockConnection));
      return;
    }
    return mockConnection;
  }

  private _handleReplayPoolGetConnection(spanInfo: SpanInfo, callback?: Function) {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL Pool getConnection`);

    // For pool getConnection operations, simulate returning a mock connection
    const mockConnection = new TdMysqlConnectionMock(this, "pool", spanInfo);

    if (callback) {
      process.nextTick(() => callback(null, mockConnection));
      return;
    }
    return mockConnection;
  }

  /**
   * Handle replay of a query from a mock connection (used by TdMysqlConnectionMock)
   * Returns an EventEmitter synchronously for streaming support
   */
  public handleReplayQueryFromMock(
    spanInfo: SpanInfo,
    inputValue: MysqlQueryInputValue,
    callback: Function | undefined,
  ): EventEmitter {
    const stackTrace = captureStackTrace(["TdMysqlConnectionMock"]);

    // Use the queryMock to handle replay - it returns EventEmitter synchronously
    return this.queryMock.handleReplayQuery(
      {
        sql: inputValue.sql,
        values: inputValue.values,
        callback: callback,
        options: inputValue.options,
      },
      inputValue,
      spanInfo,
      stackTrace,
    );
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
