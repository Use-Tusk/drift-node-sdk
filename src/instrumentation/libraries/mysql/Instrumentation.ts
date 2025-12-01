import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { context, SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap, isWrapped } from "../../core/utils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  MysqlQueryInputValue,
  MysqlTransactionInputValue,
  MysqlInstrumentationConfig,
  MysqlOutputValue,
  isMysqlOkPacket,
  MysqlStreamInputValue,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils";
import { EventEmitter } from "events";
import { Readable } from "stream";
import { TdMysqlConnectionMock } from "./mocks/TdMysqlConnectionMock";
import { TdMysqlQueryMock } from "./mocks/TdMysqlQueryMock";

export class MysqlInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "MysqlInstrumentation";
  private mode: TuskDriftMode;
  private queryMock: TdMysqlQueryMock;
  private createQuery: Function | null = null;

  constructor(config: MysqlInstrumentationConfig = {}) {
    super("mysql", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.queryMock = new TdMysqlQueryMock();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "mysql",
        supportedVersions: ["2.*"],
        files: [
          // Patch mysql/lib/protocol/sequences/Query.js for stream support
          new TdInstrumentationNodeModuleFile({
            name: "mysql/lib/protocol/sequences/Query.js",
            supportedVersions: ["2.*"],
            patch: (moduleExports: any) => this._patchQueryFile(moduleExports),
          }),
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
          // Patch mysql/lib/PoolNamespace.js at the prototype level
          new TdInstrumentationNodeModuleFile({
            name: "mysql/lib/PoolNamespace.js",
            supportedVersions: ["2.*"],
            patch: (moduleExports: any) => this._patchPoolNamespaceFile(moduleExports),
          }),
        ],
      }),
    ];
  }

  /**
   * Patch Query.prototype.stream method for streaming query support
   */
  private _patchQueryFile(QueryClass: any): any {
    logger.debug(`[MysqlInstrumentation] Patching Query class (file-based)`);

    if (this.isModulePatched(QueryClass)) {
      logger.debug(`[MysqlInstrumentation] Query class already patched, skipping`);
      return QueryClass;
    }

    // Wrap Query.prototype.stream
    if (QueryClass.prototype && QueryClass.prototype.stream) {
      if (!isWrapped(QueryClass.prototype.stream)) {
        this._wrap(QueryClass.prototype, "stream", this._getStreamPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Query.prototype.stream`);
      }
    }

    this.markModuleAsPatched(QueryClass);
    logger.debug(`[MysqlInstrumentation] Query class patching complete`);

    return QueryClass;
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

    // Store the createQuery method for parsing query arguments
    if (ConnectionClass.createQuery) {
      this.createQuery = ConnectionClass.createQuery;
      logger.debug(`[MysqlInstrumentation] Stored Connection.createQuery method`);
    }

    // Wrap Connection.prototype.query
    if (ConnectionClass.prototype && ConnectionClass.prototype.query) {
      if (!isWrapped(ConnectionClass.prototype.query)) {
        this._wrap(ConnectionClass.prototype, "query", this._getQueryPatchFn());
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

    // Wrap Connection.prototype.ping
    if (ConnectionClass.prototype && ConnectionClass.prototype.ping) {
      if (!isWrapped(ConnectionClass.prototype.ping)) {
        this._wrap(ConnectionClass.prototype, "ping", this._getPingPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.ping`);
      }
    }

    // Wrap Connection.prototype.end
    if (ConnectionClass.prototype && ConnectionClass.prototype.end) {
      if (!isWrapped(ConnectionClass.prototype.end)) {
        this._wrap(ConnectionClass.prototype, "end", this._getEndPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.end`);
      }
    }

    // Wrap Connection.prototype.changeUser
    if (ConnectionClass.prototype && ConnectionClass.prototype.changeUser) {
      if (!isWrapped(ConnectionClass.prototype.changeUser)) {
        this._wrap(ConnectionClass.prototype, "changeUser", this._getChangeUserPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.changeUser`);
      }
    }

    // Wrap Connection.prototype.pause
    if (ConnectionClass.prototype && ConnectionClass.prototype.pause) {
      if (!isWrapped(ConnectionClass.prototype.pause)) {
        this._wrap(ConnectionClass.prototype, "pause", this._getPausePatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.pause`);
      }
    }

    // Wrap Connection.prototype.resume
    if (ConnectionClass.prototype && ConnectionClass.prototype.resume) {
      if (!isWrapped(ConnectionClass.prototype.resume)) {
        this._wrap(ConnectionClass.prototype, "resume", this._getResumePatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.resume`);
      }
    }

    // Wrap Connection.prototype.destroy
    if (ConnectionClass.prototype && ConnectionClass.prototype.destroy) {
      if (!isWrapped(ConnectionClass.prototype.destroy)) {
        this._wrap(ConnectionClass.prototype, "destroy", this._getDestroyPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Connection.prototype.destroy`);
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
        this._wrap(PoolClass.prototype, "query", this._getQueryPatchFn());
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

    // Wrap Pool.prototype.end
    if (PoolClass.prototype && PoolClass.prototype.end) {
      if (!isWrapped(PoolClass.prototype.end)) {
        this._wrap(PoolClass.prototype, "end", this._getPoolEndPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped Pool.prototype.end`);
      }
    }

    this.markModuleAsPatched(PoolClass);
    logger.debug(`[MysqlInstrumentation] Pool class patching complete`);

    return PoolClass;
  }

  /**
   * Patch PoolNamespace.prototype methods at the file level
   * This handles queries made via poolCluster.of("pattern").query()
   */
  private _patchPoolNamespaceFile(PoolNamespaceClass: any): any {
    logger.debug(`[MysqlInstrumentation] Patching PoolNamespace class (file-based)`);

    if (this.isModulePatched(PoolNamespaceClass)) {
      logger.debug(`[MysqlInstrumentation] PoolNamespace class already patched, skipping`);
      return PoolNamespaceClass;
    }

    // Wrap PoolNamespace.prototype.query
    if (PoolNamespaceClass.prototype && PoolNamespaceClass.prototype.query) {
      if (!isWrapped(PoolNamespaceClass.prototype.query)) {
        this._wrap(PoolNamespaceClass.prototype, "query", this._getPoolNamespaceQueryPatchFn());
        logger.debug(`[MysqlInstrumentation] Wrapped PoolNamespace.prototype.query`);
      }
    }

    // Wrap PoolNamespace.prototype.getConnection
    if (PoolNamespaceClass.prototype && PoolNamespaceClass.prototype.getConnection) {
      if (!isWrapped(PoolNamespaceClass.prototype.getConnection)) {
        this._wrap(
          PoolNamespaceClass.prototype,
          "getConnection",
          this._getPoolNamespaceGetConnectionPatchFn(),
        );
        logger.debug(`[MysqlInstrumentation] Wrapped PoolNamespace.prototype.getConnection`);
      }
    }

    this.markModuleAsPatched(PoolNamespaceClass);
    logger.debug(`[MysqlInstrumentation] PoolNamespace class patching complete`);

    return PoolNamespaceClass;
  }

  /**
   * Get wrapper function for query method (prototype-level patching)
   */
  private _getQueryPatchFn() {
    const self = this;

    return (originalQuery: Function) => {
      return function query(this: any, ...args: any[]) {
        // Check if args[0] is a Query object with an internal callback
        // This happens when PoolNamespace.query() passes a pre-created Query object
        const firstArg = args[0];
        const hasInternalCallback =
          firstArg && typeof firstArg === "object" && typeof firstArg._callback === "function";

        // Use createQuery to parse arguments if available, otherwise fallback to manual parsing
        let sql: string;
        let values: any[] | undefined;
        let callback: Function | undefined;
        let options: any = {};

        if (self.createQuery) {
          try {
            // Use MySQL's internal createQuery method to parse arguments
            const queryObj = self.createQuery(...args);
            sql = queryObj.sql;
            values = queryObj.values;
            options = {
              nestTables: queryObj.nestTables,
            };
            // Find callback in args
            callback = args.find((arg) => typeof arg === "function");

            // If no callback in args but the Query object has an internal callback, use that
            // This handles the case where a pre-created Query object is passed to query()
            if (!callback && hasInternalCallback) {
              callback = firstArg._callback;
            }
          } catch (error) {
            logger.debug(
              `[MysqlInstrumentation] Error using createQuery, falling back to manual parsing:`,
              error,
            );
            // Fallback to manual parsing
            ({ sql, values, callback, options } = self._parseQueryArgs(args));
          }
        } else {
          // Fallback to manual parsing
          ({ sql, values, callback, options } = self._parseQueryArgs(args));
        }

        const inputValue: MysqlQueryInputValue = {
          sql: sql,
          values: values,
          options: options.nestTables ? { nestTables: options.nestTables } : undefined,
        };

        // If no callback in args but Query object has internal callback, treat as callback mode
        const isEventEmitterMode = !callback && !hasInternalCallback;

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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  const queryEmitter = self.queryMock.handleReplayQuery(
                    { sql, values, callback, options },
                    inputValue,
                    spanInfo,
                    stackTrace,
                  );

                  // Add stream() method to the emitter so query.stream() works in REPLAY mode
                  if (queryEmitter && typeof queryEmitter === "object") {
                    (queryEmitter as any).stream = function (streamOptions?: any) {
                      return self._createReplayStreamForQuery(
                        inputValue,
                        spanInfo,
                        stackTrace,
                        queryEmitter,
                        streamOptions,
                      );
                    };
                  }

                  return queryEmitter;
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
                  packageType: PackageType.MYSQL,
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
          const connectionContext = this;
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              // Emit connect event
              setImmediate(() => connectionContext.emit("connect"));
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              // Emit connect event
              setImmediate(() => connectionContext.emit("connect"));
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
      // Handle both signatures: beginTransaction(callback) and beginTransaction(options, callback)
      return function beginTransaction(this: any, optionsOrCallback?: any, callbackArg?: Function) {
        // Detect the actual callback - same logic as MySQL library
        let actualCallback: Function | undefined;
        if (typeof optionsOrCallback === "function") {
          actualCallback = optionsOrCallback;
        } else {
          actualCallback = callbackArg;
        }

        const inputValue: MysqlTransactionInputValue = {
          query: "BEGIN",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (actualCallback) {
                setImmediate(() => actualCallback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, actualCallback);
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
                  packageType: PackageType.MYSQL,
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
                    actualCallback,
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
      // Handle both signatures: commit(callback) and commit(options, callback)
      return function commit(this: any, optionsOrCallback?: any, callbackArg?: Function) {
        // Detect the actual callback - same logic as MySQL library
        let actualCallback: Function | undefined;
        if (typeof optionsOrCallback === "function") {
          actualCallback = optionsOrCallback;
        } else {
          actualCallback = callbackArg;
        }

        const inputValue: MysqlTransactionInputValue = {
          query: "COMMIT",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (actualCallback) {
                setImmediate(() => actualCallback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, actualCallback);
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
                  packageType: PackageType.MYSQL,
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
                    actualCallback,
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
      // Handle both signatures: rollback(callback) and rollback(options, callback)
      return function rollback(this: any, optionsOrCallback?: any, callbackArg?: Function) {
        // Detect the actual callback - same logic as MySQL library
        let actualCallback: Function | undefined;
        if (typeof optionsOrCallback === "function") {
          actualCallback = optionsOrCallback;
        } else {
          actualCallback = callbackArg;
        }

        const inputValue: MysqlTransactionInputValue = {
          query: "ROLLBACK",
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (actualCallback) {
                setImmediate(() => actualCallback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, actualCallback);
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
                  packageType: PackageType.MYSQL,
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
                    actualCallback,
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
   * Get wrapper function for ping method
   */
  private _getPingPatchFn() {
    const self = this;
    return (originalPing: Function) => {
      return function ping(this: any, callback?: Function) {
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalPing.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return originalPing.apply(this, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalPing.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for end method
   */
  private _getEndPatchFn() {
    const self = this;
    return (originalEnd: Function) => {
      return function end(this: any, callback?: Function) {
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              // Emit end event
              setImmediate(() => this.emit("end"));
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              // Emit end event
              setImmediate(() => this.emit("end"));
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalEnd.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return originalEnd.apply(this, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalEnd.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for changeUser method
   */
  private _getChangeUserPatchFn() {
    const self = this;
    return (originalChangeUser: Function) => {
      return function changeUser(this: any, options?: any, callback?: Function) {
        // Handle both signatures: changeUser(options, callback) and changeUser(callback)
        let userOptions = options;
        let userCallback = callback;
        if (typeof options === "function") {
          userCallback = options;
          userOptions = {};
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (userCallback) {
                setImmediate(() => userCallback(null));
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (userCallback) {
                setImmediate(() => userCallback(null));
              }
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalChangeUser.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return originalChangeUser.apply(this, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalChangeUser.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for pause method
   */
  private _getPausePatchFn() {
    const self = this;
    return (originalPause: Function) => {
      return function pause(this: any) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // No-op in replay mode
          return undefined;
        } else if (self.mode === TuskDriftMode.RECORD) {
          return originalPause.apply(this, arguments);
        } else {
          return originalPause.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for resume method
   */
  private _getResumePatchFn() {
    const self = this;
    return (originalResume: Function) => {
      return function resume(this: any) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // No-op in replay mode
          return undefined;
        } else if (self.mode === TuskDriftMode.RECORD) {
          return originalResume.apply(this, arguments);
        } else {
          return originalResume.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for destroy method
   */
  private _getDestroyPatchFn() {
    const self = this;
    return (originalDestroy: Function) => {
      return function destroy(this: any) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // No-op in replay mode - prevent actual TCP socket destruction
          return undefined;
        } else if (self.mode === TuskDriftMode.RECORD) {
          return originalDestroy.apply(this, arguments);
        } else {
          return originalDestroy.apply(this, arguments);
        }
      };
    };
  }

  /**
   * Get wrapper function for Pool.end method
   */
  private _getPoolEndPatchFn() {
    const self = this;
    return (originalEnd: Function) => {
      return function end(this: any, callback?: Function) {
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
              }
              return undefined;
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalEnd.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return originalEnd.apply(this, arguments);
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalEnd.apply(this, arguments);
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
        const pool = this; // Capture pool reference

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              return self._handleNoOpReplayGetConnection(pool, callback);
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
                  return self._handleReplayPoolGetConnection(pool, spanInfo, callback);
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
        // Check if args[0] is a Query object with an internal callback
        // This happens when PoolNamespace.query() passes a pre-created Query object
        const firstArg = args[0];
        const hasInternalCallback =
          firstArg && typeof firstArg === "object" && typeof firstArg._callback === "function";

        // Use createQuery to parse arguments if available, otherwise fallback to manual parsing
        let sql: string;
        let values: any[] | undefined;
        let callback: Function | undefined;
        let options: any = {};

        if (self.createQuery) {
          try {
            // Use MySQL's internal createQuery method to parse arguments
            const queryObj = self.createQuery(...args);
            sql = queryObj.sql;
            values = queryObj.values;
            options = {
              nestTables: queryObj.nestTables,
            };
            // Find callback in args
            callback = args.find((arg) => typeof arg === "function");

            // If no callback in args but the Query object has an internal callback, use that
            // This handles the case where a pre-created Query object is passed to query()
            if (!callback && hasInternalCallback) {
              callback = firstArg._callback;
            }
          } catch (error) {
            logger.debug(
              `[MysqlInstrumentation] Error using createQuery, falling back to manual parsing:`,
              error,
            );
            // Fallback to manual parsing
            ({ sql, values, callback, options } = self._parseQueryArgs(args));
          }
        } else {
          // Fallback to manual parsing
          ({ sql, values, callback, options } = self._parseQueryArgs(args));
        }

        const inputValue: MysqlQueryInputValue = {
          sql: sql,
          values: values,
          options: options.nestTables ? { nestTables: options.nestTables } : undefined,
        };

        // If no callback in args but Query object has internal callback, treat as callback mode
        const isEventEmitterMode = !callback && !hasInternalCallback;

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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  // Use the queryMock to handle replay - returns EventEmitter synchronously
                  const queryEmitter = self.queryMock.handleReplayQuery(
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

                  // Add stream() method to the emitter so query.stream() works in REPLAY mode
                  if (queryEmitter && typeof queryEmitter === "object") {
                    (queryEmitter as any).stream = function (streamOptions?: any) {
                      return self._createReplayStreamForQuery(
                        inputValue,
                        spanInfo,
                        stackTrace,
                        queryEmitter,
                        streamOptions,
                      );
                    };
                  }

                  return queryEmitter;
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
                  packageType: PackageType.MYSQL,
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
          queryIndex = queryEmitter._index || queryIndex;
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
          // Get final query count using _getQueryCount helper
          const finalQueryCount = this._getQueryCount(queryEmitter) || queryIndex + 1;
          const isMultiStatementQuery = finalQueryCount > 1;

          const outputValue: MysqlOutputValue = isMultiStatementQuery
            ? {
                results: results,
                fields: fields,
                queryCount: finalQueryCount,
                errQueryIndex: error ? queryIndex : undefined,
              }
            : {
                results: results[0],
                fields: fields[0],
                queryCount: finalQueryCount,
              };

          if (error) {
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error.message,
              });
            } catch (error) {
              logger.error(`[MysqlInstrumentation] error ending span:`, error);
            }
          } else {
            try {
              SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            } catch (error) {
              logger.error(`[MysqlInstrumentation] error ending span:`, error);
            }
          }

          logger.debug(`[MysqlInstrumentation] Query completed`);
        });

      return queryEmitter;
    } else {
      // Callback mode - wrap the callback
      // The callback might be in args OR inside a Query object's _callback property
      const queryObject = args[0];
      const hasInternalCallback =
        queryObject &&
        typeof queryObject === "object" &&
        typeof queryObject._callback === "function";

      if (hasInternalCallback) {
        // Wrap the internal _callback on the Query object
        const originalCallback = queryObject._callback;
        queryObject._callback = function (err: any, results: any, fields: any) {
          if (err) {
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
            } catch (error) {
              logger.error(`[MysqlInstrumentation] error ending span:`, error);
            }
          } else {
            try {
              const outputValue: MysqlOutputValue = {
                results: results,
                fields: fields,
              };
              SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            } catch (error) {
              logger.error(`[MysqlInstrumentation] error ending span:`, error);
            }
          }
          logger.debug(`[MysqlInstrumentation] Query completed`);
          originalCallback.call(this, err, results, fields);
        };
        return originalQuery.apply(connection, args);
      }

      const originalCallback = callback!;
      const callbackIndex = args.findIndex((arg) => typeof arg === "function");

      args[callbackIndex] = function (err: any, results: any, fields: any) {
        if (err) {
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: err.message,
            });
          } catch (error) {
            logger.error(`[MysqlInstrumentation] error ending span:`, error);
          }
        } else {
          try {
            const outputValue: MysqlOutputValue = {
              results: results,
              fields: fields,
            };
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[MysqlInstrumentation] error ending span:`, error);
          }
        }

        logger.debug(`[MysqlInstrumentation] Query completed`);

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
                setImmediate(() => callback(null));
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
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
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, callback);
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
                  packageType: PackageType.MYSQL,
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
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, callback);
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
                  packageType: PackageType.MYSQL,
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
          return handleReplayMode({
            noOpRequestHandler: () => {
              if (callback) {
                setImmediate(() => callback(null));
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayTransaction(inputValue, callback);
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
                  packageType: PackageType.MYSQL,
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
        try {
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { status: "success" },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(`[MysqlInstrumentation] error adding span attributes:`, error);
        }
        return result;
      } catch (error: any) {
        try {
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } catch (error) {
          logger.error(`[MysqlInstrumentation] error ending span:`, error);
        }
        throw error;
      }
    }

    // Wrap the callback
    const argsArray = Array.from(args);
    const callbackIndex = argsArray.findIndex((arg) => typeof arg === "function");

    if (callbackIndex !== -1) {
      // Use the actual callback from argsArray, not the 'callback' parameter
      // This handles both beginTransaction(callback) and beginTransaction(options, callback) signatures
      const originalCallback = argsArray[callbackIndex] as Function;
      argsArray[callbackIndex] = function (err: any) {
        if (err) {
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: err.message,
            });
          } catch (error) {
            logger.error(`[MysqlInstrumentation] error ending span:`, error);
          }
        } else {
          try {
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { status: "success" },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[MysqlInstrumentation] error ending span:`, error);
          }
        }

        logger.debug(`[MysqlInstrumentation] Transaction completed`);

        return originalCallback.apply(this, arguments);
      };

      // Bind the callback to the span context so child operations (like queries inside the transaction)
      // can access the parent span via SpanUtils.getCurrentSpanInfo() and be properly recorded.
      // Without this binding, the OpenTelemetry context is lost when the callback executes asynchronously,
      // causing child spans to have no parent context and fail the handleRecordMode check,
      // resulting in operations being executed but not recorded (leading to missing mocks in replay mode).
      argsArray[callbackIndex] = context.bind(spanInfo.context, argsArray[callbackIndex]);
    }

    return originalFunction.apply(connection, argsArray);
  }

  private async _handleReplayTransaction(
    inputValue: MysqlTransactionInputValue,
    callback: Function | undefined,
  ): Promise<any> {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL transaction: ${inputValue.query}`);

    // Transaction operations (BEGIN, COMMIT, ROLLBACK) don't need mocks
    // Only the actual SQL queries inside transactions are mocked
    // Just call the callback to signal success
    if (callback) {
      setImmediate(() => {
        callback(null);
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

  private _handleNoOpReplayGetConnection(pool: any, callback?: Function): any {
    logger.debug(
      `[MysqlInstrumentation] Background getConnection detected, returning mock connection`,
    );

    const mockConnection = new TdMysqlConnectionMock(this, "pool", undefined, pool);

    if (callback) {
      process.nextTick(() => {
        pool.emit("connection", mockConnection);
        pool.emit("acquire", mockConnection);
        callback(null, mockConnection);
      });
      return;
    }
    return mockConnection;
  }

  private _handleReplayPoolGetConnection(pool: any, spanInfo: SpanInfo, callback?: Function) {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL Pool getConnection`);

    // For pool getConnection operations, simulate returning a mock connection
    const mockConnection = new TdMysqlConnectionMock(this, "pool", spanInfo, pool);

    if (callback) {
      process.nextTick(() => {
        pool.emit("connection", mockConnection);
        pool.emit("acquire", mockConnection);
        callback(null, mockConnection);
      });
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

  /**
   * Get wrapper function for Query.stream method
   */
  private _getStreamPatchFn() {
    const self = this;

    return (originalStream: Function) => {
      return function stream(this: any, streamOptions?: any) {
        const queryInstance = this;

        // Extract query information from the Query instance
        const sql = queryInstance.sql;
        const values = queryInstance.values;
        const nestTables = queryInstance.nestTables;

        const inputValue: MysqlStreamInputValue = {
          sql: sql,
          values: values,
          streamOptions: streamOptions,
          options: nestTables ? { nestTables } : undefined,
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              // For background requests, return empty stream
              return new Readable({
                objectMode: true,
                read() {
                  this.push(null);
                },
              });
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalStream.apply(queryInstance, arguments),
                {
                  name: "mysql.stream",
                  kind: SpanKind.CLIENT,
                  submodule: "stream",
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayStream(inputValue, spanInfo, stackTrace, queryInstance);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalStream.apply(queryInstance, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalStream.apply(queryInstance, arguments),
                {
                  name: "mysql.stream",
                  kind: SpanKind.CLIENT,
                  submodule: "stream",
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordStream(
                    spanInfo,
                    originalStream,
                    queryInstance,
                    streamOptions,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalStream.apply(queryInstance, arguments);
        }
      };
    };
  }

  /**
   * Helper to get query count from Query instance
   */
  private _getQueryCount(queryInstance: any): number {
    return queryInstance?._index || 0;
  }

  /**
   * Parse query arguments manually (fallback when createQuery is not available)
   */
  private _parseQueryArgs(args: any[]): {
    sql: string;
    values: any[] | undefined;
    callback: Function | undefined;
    options: any;
  } {
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
      // Unknown signature, use empty values
      sql = "";
      logger.debug(`[MysqlInstrumentation] Unknown query signature:`, args);
    }

    return { sql, values, callback, options };
  }

  /**
   * Handle record mode for stream operations
   */
  private _handleRecordStream(
    spanInfo: SpanInfo,
    originalStream: Function,
    queryInstance: any,
    streamOptions: any,
  ): any {
    const streamInstance = originalStream.apply(queryInstance, [streamOptions]);

    const results: any[] = [];
    const fields: any[] = [];
    let error: any = null;
    let errQueryIndex: number | undefined;

    queryInstance
      .on("error", (err: any) => {
        error = err;
        errQueryIndex = queryInstance._index;
      })
      .on("fields", (fieldPackets: any, index: number) => {
        fields[index] = fieldPackets;
      })
      .on("result", (row: any, index: number) => {
        if (isMysqlOkPacket(row)) {
          results[index] = row;
          return;
        }
        if (!results[index]) {
          results[index] = [];
        }
        if (Array.isArray(results[index])) {
          results[index].push(row);
        }
      })
      .on("end", () => {
        const queryCount = this._getQueryCount(queryInstance);
        const isMultiStatementQuery = queryCount > 1;

        if (error) {
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (err) {
            logger.error(`[MysqlInstrumentation] error ending span:`, err);
          }
        } else {
          try {
            const outputValue: MysqlOutputValue = isMultiStatementQuery
              ? {
                  results: results,
                  fields: fields,
                  queryCount,
                  errQueryIndex,
                }
              : {
                  results: results[0],
                  fields: fields[0],
                  queryCount,
                };

            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (err) {
            logger.error(`[MysqlInstrumentation] error ending span:`, err);
          }
        }

        logger.debug(`[MysqlInstrumentation] Stream query completed`);
      });

    return streamInstance;
  }

  /**
   * Create a replay stream for query.stream() calls
   * This is called when user calls query.stream() on a query object
   */
  private _createReplayStreamForQuery(
    inputValue: MysqlQueryInputValue,
    spanInfo: SpanInfo,
    stackTrace: string,
    queryEmitter: EventEmitter,
    streamOptions?: any,
  ): Readable {
    logger.debug(`[MysqlInstrumentation] Creating replay stream for query.stream()`);

    // Create a Readable stream that will emit the data
    const readableStream = new Readable({
      objectMode: true,
      read() {
        // Read is handled by the emitter events
      },
    });

    // The queryEmitter already has the data from handleReplayQuery
    // We need to re-emit it as a stream
    // Forward events from the emitter to the stream
    queryEmitter.on("fields", (fields: any, index: number) => {
      // Fields event doesn't go to the stream, but we can log it
      logger.debug(`[MysqlInstrumentation] Stream received fields`);
    });

    queryEmitter.on("result", (row: any, index: number) => {
      readableStream.push(row);
    });

    queryEmitter.on("error", (err: any) => {
      readableStream.destroy(err);
    });

    queryEmitter.on("end", () => {
      readableStream.push(null);
    });

    return readableStream;
  }

  /**
   * Handle replay mode for stream operations
   */
  private _handleReplayStream(
    inputValue: MysqlStreamInputValue,
    spanInfo: SpanInfo,
    stackTrace: string,
    queryInstance: any,
  ): Readable {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL stream query`);

    // Use queryMock to get the replay data
    const emitter = this.queryMock.handleReplayQuery(
      {
        sql: inputValue.sql,
        values: inputValue.values,
        callback: undefined,
        options: inputValue.options,
      },
      inputValue,
      spanInfo,
      stackTrace,
    );

    // Create a Readable stream that will emit the data
    const readableStream = new Readable({
      objectMode: true,
      read() {
        // Read is handled by the emitter events
      },
    });

    // Forward events from the emitter to the stream
    emitter.on("fields", (fields: any, index: number) => {
      queryInstance.emit("fields", fields, index);
    });

    emitter.on("result", (row: any, index: number) => {
      readableStream.push(row);
      queryInstance.emit("result", row, index);
    });

    emitter.on("error", (err: any) => {
      readableStream.destroy(err);
      queryInstance.emit("error", err);
    });

    emitter.on("end", () => {
      readableStream.push(null);
      queryInstance.emit("end");
    });

    return readableStream;
  }

  /**
   * Get wrapper function for PoolNamespace.query method
   * This handles queries made via poolCluster.of("pattern").query()
   */
  private _getPoolNamespaceQueryPatchFn() {
    const self = this;

    return (originalQuery: Function) => {
      return function query(this: any, ...args: any[]) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // Parse arguments using same logic as regular query
          let sql: string;
          let values: any[] | undefined;
          let callback: Function | undefined;
          let options: any = {};

          if (self.createQuery) {
            try {
              const queryObj = self.createQuery(...args);
              sql = queryObj.sql;
              values = queryObj.values;
              options = { nestTables: queryObj.nestTables };
              callback = args.find((arg) => typeof arg === "function");
            } catch (error) {
              ({ sql, values, callback, options } = self._parseQueryArgs(args));
            }
          } else {
            ({ sql, values, callback, options } = self._parseQueryArgs(args));
          }

          const inputValue: MysqlQueryInputValue = {
            sql: sql,
            values: values,
            options: options.nestTables ? { nestTables: options.nestTables } : undefined,
          };
          const stackTrace = captureStackTrace(["MysqlInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return self.queryMock.handleNoOpReplayQuery({ sql, values, callback, options });
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
                  packageType: PackageType.MYSQL,
                  packageName: "mysql",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  const queryEmitter = self.queryMock.handleReplayQuery(
                    { sql, values, callback, options },
                    inputValue,
                    spanInfo,
                    stackTrace,
                  );

                  // Add stream() method to the emitter so query.stream() works in REPLAY mode
                  // This mirrors the behavior in _getQueryPatchFn()
                  if (queryEmitter && typeof queryEmitter === "object") {
                    (queryEmitter as any).stream = function (streamOptions?: any) {
                      return self._createReplayStreamForQuery(
                        inputValue,
                        spanInfo,
                        stackTrace,
                        queryEmitter,
                        streamOptions,
                      );
                    };
                  }

                  return queryEmitter;
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          // In RECORD mode, we rely on the underlying Connection.query instrumentation
          // to capture the query results. PoolNamespace.query() internally calls
          // cluster._getConnection() -> pool.getConnection() -> conn.query(queryObj)
          // The Connection.query wrapper will properly capture the results.
          return originalQuery.apply(this, args);
        } else {
          return originalQuery.apply(this, args);
        }
      };
    };
  }

  /**
   * Get wrapper function for PoolNamespace.getConnection method
   * This handles connections obtained via poolCluster.of("pattern").getConnection()
   */
  private _getPoolNamespaceGetConnectionPatchFn() {
    const self = this;

    return (originalGetConnection: Function) => {
      return function getConnection(this: any, callback?: Function) {
        const namespace = this;
        const inputValue = { clientType: "poolNamespace" as const };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              const mockConnection = new TdMysqlConnectionMock(self, "pool", undefined, undefined);
              if (callback) {
                process.nextTick(() => callback(null, mockConnection));
                return;
              }
              return mockConnection;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGetConnection.apply(namespace, [callback]),
                {
                  name: `mysql.poolNamespace.getConnection`,
                  kind: SpanKind.CLIENT,
                  submodule: "getConnection",
                  packageName: "mysql",
                  packageType: PackageType.MYSQL,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  const mockConnection = new TdMysqlConnectionMock(
                    self,
                    "pool",
                    spanInfo,
                    undefined,
                  );
                  if (callback) {
                    process.nextTick(() => callback(null, mockConnection));
                    return;
                  }
                  return mockConnection;
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          // In RECORD mode, the underlying Pool.getConnection is already patched
          return originalGetConnection.apply(namespace, [callback]);
        } else {
          return originalGetConnection.apply(namespace, [callback]);
        }
      };
    };
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
