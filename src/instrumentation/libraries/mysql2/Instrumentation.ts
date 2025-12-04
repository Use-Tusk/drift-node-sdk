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
import { captureStackTrace } from "src/instrumentation/core/utils";
import { TdMysql2ConnectionEventMock } from "./mocks/TdMysql2ConnectionEventMock";
import { EventEmitter } from "events";

// Version ranges for mysql2
const COMPLETE_SUPPORTED_VERSIONS = ">=2.3.3 <4.0.0";
const V2_3_3_TO_3_11_4 = ">=2.3.3 <3.11.5";
const V3_11_5_TO_4_0 = ">=3.11.5 <4.0.0";

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
        supportedVersions: [COMPLETE_SUPPORTED_VERSIONS],
        files: [
          // For v2.3.3-3.11.4: lib/connection.js with prototypes AND class wrapping
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/connection.js",
            supportedVersions: [V2_3_3_TO_3_11_4],
            patch: (moduleExports: any) => this._patchConnectionV2(moduleExports),
          }),
          // For v3.11.5+: lib/base/connection.js with prototypes only
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/base/connection.js",
            supportedVersions: [V3_11_5_TO_4_0],
            patch: (moduleExports: any) => this._patchBaseConnection(moduleExports),
          }),
          // For v3.11.5+: lib/connection.js with class wrapping only
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/connection.js",
            supportedVersions: [V3_11_5_TO_4_0],
            patch: (moduleExports: any) => this._patchConnectionV3(moduleExports),
          }),
          // For v2.3.3-3.11.4: lib/pool.js with prototypes AND class wrapping
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool.js",
            supportedVersions: [V2_3_3_TO_3_11_4],
            patch: (moduleExports: any) => this._patchPoolV2(moduleExports),
          }),
          // For v3.11.5+: lib/pool.js with class wrapping only
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool.js",
            supportedVersions: [V3_11_5_TO_4_0],
            patch: (moduleExports: any) => this._patchPoolV3(moduleExports),
          }),
          // For v2.3.3-3.11.4: lib/pool_connection.js with class wrapping
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool_connection.js",
            supportedVersions: [V2_3_3_TO_3_11_4],
            patch: (moduleExports: any) => this._patchPoolConnectionV2(moduleExports),
          }),
          // For v3.11.5+: lib/pool_connection.js with class wrapping
          new TdInstrumentationNodeModuleFile({
            name: "mysql2/lib/pool_connection.js",
            supportedVersions: [V3_11_5_TO_4_0],
            patch: (moduleExports: any) => this._patchPoolConnectionV3(moduleExports),
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

    // Wrap BaseConnection.prototype.prepare
    if (BaseConnectionClass.prototype && BaseConnectionClass.prototype.prepare) {
      if (!isWrapped(BaseConnectionClass.prototype.prepare)) {
        this._wrap(BaseConnectionClass.prototype, "prepare", this._getPreparePatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped BaseConnection.prototype.prepare`);
      }
    }

    this.markModuleAsPatched(BaseConnectionClass);
    logger.debug(`[Mysql2Instrumentation] BaseConnection class patching complete`);

    return BaseConnectionClass;
  }

  // v2.3.3-3.11.4: Patch prototypes AND wrap constructor
  private _patchConnectionV2(ConnectionClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching Connection class (v2)`);

    if (this.isModulePatched(ConnectionClass)) {
      logger.debug(`[Mysql2Instrumentation] Connection class already patched, skipping`);
      return ConnectionClass;
    }

    // Patch all connection prototype methods
    this._patchConnectionPrototypes(ConnectionClass);

    // Wrap the Connection constructor to handle connection events
    const patchedConnectionClass = this._getPatchedConnectionClass(ConnectionClass);

    this.markModuleAsPatched(ConnectionClass);

    logger.debug(`[Mysql2Instrumentation] Connection class (v2) patching complete`);
    return patchedConnectionClass;
  }

  // v3.11.5+: Only wrap constructor (prototypes already patched in base/connection.js)
  private _patchConnectionV3(ConnectionClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Connection class (v3) - wrapping constructor only`);
    // For v3.11.5+, lib/connection.js extends base/connection.js
    // We already patched the prototypes in base/connection.js
    // But we still need to wrap the constructor for connection event handling
    const patchedConnectionClass = this._getPatchedConnectionClass(ConnectionClass);
    return patchedConnectionClass;
  }

  // Helper to patch all connection prototype methods (used by both versions)
  private _patchConnectionPrototypes(ConnectionClass: any): void {
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

    // Wrap Connection.prototype.prepare
    if (ConnectionClass.prototype && ConnectionClass.prototype.prepare) {
      if (!isWrapped(ConnectionClass.prototype.prepare)) {
        this._wrap(ConnectionClass.prototype, "prepare", this._getPreparePatchFn("connection"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Connection.prototype.prepare`);
      }
    }
  }

  // v2.3.3-3.11.4: Patch prototypes for Pool
  private _patchPoolV2(PoolClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching Pool class (v2)`);

    if (this.isModulePatched(PoolClass)) {
      logger.debug(`[Mysql2Instrumentation] Pool class already patched, skipping`);
      return PoolClass;
    }

    // Patch pool prototype methods
    this._patchPoolPrototypes(PoolClass);

    this.markModuleAsPatched(PoolClass);

    logger.debug(`[Mysql2Instrumentation] Pool class (v2) patching complete`);
    return PoolClass;
  }

  // v3.11.5+: Patch prototypes for Pool (there's no base/pool.js)
  private _patchPoolV3(PoolClass: any): any {
    logger.debug(`[Mysql2Instrumentation] Patching Pool class (v3)`);

    if (this.isModulePatched(PoolClass)) {
      logger.debug(`[Mysql2Instrumentation] Pool class already patched, skipping`);
      return PoolClass;
    }

    // Patch pool prototype methods
    this._patchPoolPrototypes(PoolClass);

    this.markModuleAsPatched(PoolClass);

    logger.debug(`[Mysql2Instrumentation] Pool class (v3) patching complete`);
    return PoolClass;
  }

  // Helper to patch pool prototype methods
  private _patchPoolPrototypes(PoolClass: any): void {
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

    // Wrap Pool.prototype.end
    if (PoolClass.prototype && PoolClass.prototype.end) {
      if (!isWrapped(PoolClass.prototype.end)) {
        this._wrap(PoolClass.prototype, "end", this._getEndPatchFn("pool"));
        logger.debug(`[Mysql2Instrumentation] Wrapped Pool.prototype.end`);
      }
    }
  }

  // v2.3.3-3.11.4: PoolConnection extends Connection, so inherits patched methods
  private _patchPoolConnectionV2(PoolConnectionClass: any): any {
    logger.debug(
      `[Mysql2Instrumentation] PoolConnection class (v2) - skipping (inherits from Connection)`,
    );
    // PoolConnection extends Connection, so it inherits the patched methods
    // No additional patching needed
    return PoolConnectionClass;
  }

  // v3.11.5+: PoolConnection extends Connection, so inherits patched methods
  private _patchPoolConnectionV3(PoolConnectionClass: any): any {
    logger.debug(
      `[Mysql2Instrumentation] PoolConnection class (v3) - skipping (inherits from Connection)`,
    );
    // PoolConnection extends Connection, so it inherits the patched methods
    // No additional patching needed
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
          const stackTrace = captureStackTrace(["Mysql2Instrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return self.queryMock.handleNoOpReplayQuery(queryConfig);
            },
            isServerRequest: false,
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
                  return self.handleReplayQuery(
                    queryConfig,
                    inputValue,
                    spanInfo,
                    "query",
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
          const stackTrace = captureStackTrace(["Mysql2Instrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return self.queryMock.handleNoOpReplayQuery(queryConfig);
            },
            isServerRequest: false,
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
                  return self.handleReplayQuery(
                    queryConfig,
                    inputValue,
                    spanInfo,
                    "execute",
                    stackTrace,
                  );
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
            noOpRequestHandler: () => {
              return self.handleNoOpReplayGetConnection(callback);
            },
            isServerRequest: false,
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
            noOpRequestHandler: () => {
              if (callback) {
                process.nextTick(() => callback(null));
                return;
              }
              return Promise.resolve();
            },
            isServerRequest: false,
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
            noOpRequestHandler: () => {
              if (callback) {
                process.nextTick(() => callback(null));
                return;
              }
              return Promise.resolve();
            },
            isServerRequest: false,
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
                  return self._handleSimpleCallbackMethod(spanInfo, originalPing, callback, this);
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
            noOpRequestHandler: () => {
              if (callback) {
                process.nextTick(() => callback(null));
                return;
              }
              return Promise.resolve();
            },
            isServerRequest: false,
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
                  return self._handleSimpleCallbackMethod(spanInfo, originalEnd, callback, this);
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

  private _getPreparePatchFn(clientType: "connection" | "pool" | "poolConnection") {
    const self = this;

    return (originalPrepare: Function) => {
      return function prepare(this: Connection, ...args: any[]) {
        // Parse args: prepare(sql | options, callback?)
        const firstArg = args[0];
        const sql = typeof firstArg === "string" ? firstArg : firstArg?.sql;
        const originalCallback =
          typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;

        const inputValue = { sql, clientType, method: "prepare" };

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => self._handleNoOpReplayPrepare(sql, originalCallback),
            isServerRequest: false,
            replayModeHandler: () => self._handleReplayPrepare(sql, originalCallback, clientType),
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalPrepare.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) =>
              self._handleRecordPrepare(
                originalPrepare,
                args,
                sql,
                originalCallback,
                this,
                clientType,
                isPreAppStart,
              ),
            spanKind: SpanKind.CLIENT,
          });
        }

        return originalPrepare.apply(this, args);
      };
    };
  }

  private _handleRecordPrepare(
    originalPrepare: Function,
    args: any[],
    sql: string,
    originalCallback: Function | undefined,
    context: Connection,
    clientType: "connection" | "pool" | "poolConnection",
    isPreAppStart: boolean,
  ): any {
    const self = this;

    return SpanUtils.createAndExecuteSpan(
      this.mode,
      () => originalPrepare.apply(context, args),
      {
        name: `mysql2.${clientType}.prepare`,
        kind: SpanKind.CLIENT,
        submodule: "prepare",
        packageType: PackageType.MYSQL,
        packageName: "mysql2",
        instrumentationName: this.INSTRUMENTATION_NAME,
        inputValue: { sql, clientType },
        isPreAppStart,
      },
      (spanInfo) => {
        const wrappedCallback = (err: Error | null, statement: any) => {
          if (err) {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 prepare error: ${err.message} (${SpanUtils.getTraceInfo()})`,
            );
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error ending span:`, error);
            }
          } else {
            logger.debug(
              `[Mysql2Instrumentation] MySQL2 prepare completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            try {
              SpanUtils.addSpanAttributes(spanInfo.span, {
                outputValue: { prepared: true, statementId: statement?.id },
              });
              SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
            } catch (error) {
              logger.error(`[Mysql2Instrumentation] error processing prepare response:`, error);
            }

            // Wrap statement.execute() to record/replay its calls
            if (statement && statement.execute) {
              const originalExecute = statement.execute.bind(statement);
              statement.execute = self._getPreparedStatementExecuteWrapper(
                originalExecute,
                sql,
                clientType,
              );
            }
          }

          if (originalCallback) {
            originalCallback(err, statement);
          }
        };

        // Replace callback in args or add it if not present
        const newArgs = [...args];
        const callbackIndex = newArgs.findIndex((a) => typeof a === "function");
        if (callbackIndex >= 0) {
          newArgs[callbackIndex] = wrappedCallback;
        } else {
          newArgs.push(wrappedCallback);
        }

        return originalPrepare.apply(context, newArgs);
      },
    );
  }

  private _getPreparedStatementExecuteWrapper(
    originalExecute: Function,
    sql: string,
    clientType: "connection" | "pool" | "poolConnection",
  ): (...args: any[]) => any {
    const self = this;

    return function execute(...args: any[]): any {
      // Parse values and callback from args
      // PreparedStatementInfo.execute signature: execute(parameters, callback)
      // where parameters can be array or function (if no params, callback is first arg)
      let values: any[] = [];
      let callback: Function | undefined;

      for (const arg of args) {
        if (typeof arg === "function") {
          callback = arg;
        } else if (Array.isArray(arg)) {
          values = arg;
        } else if (arg !== undefined) {
          values = [arg];
        }
      }

      const inputValue = { sql, values, clientType };
      const queryConfig: Mysql2QueryConfig = { sql, values, callback };
      const stackTrace = captureStackTrace(["Mysql2Instrumentation"]);

      if (self.mode === TuskDriftMode.REPLAY) {
        return handleReplayMode({
          noOpRequestHandler: () => self.queryMock.handleNoOpReplayQuery(queryConfig),
          isServerRequest: false,
          replayModeHandler: () => {
            const spanName = `mysql2.${clientType}.preparedExecute`;
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => originalExecute(...args),
              {
                name: spanName,
                kind: SpanKind.CLIENT,
                submodule: "preparedExecute",
                packageType: PackageType.MYSQL,
                packageName: "mysql2",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart: false,
              },
              (spanInfo) => {
                return self.handleReplayQuery(
                  queryConfig,
                  inputValue,
                  spanInfo,
                  "preparedExecute",
                  stackTrace,
                );
              },
            );
          },
        });
      } else if (self.mode === TuskDriftMode.RECORD) {
        return handleRecordMode({
          originalFunctionCall: () => originalExecute(...args),
          recordModeHandler: ({ isPreAppStart }) => {
            const spanName = `mysql2.${clientType}.preparedExecute`;
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => originalExecute(...args),
              {
                name: spanName,
                kind: SpanKind.CLIENT,
                submodule: "preparedExecute",
                packageType: PackageType.MYSQL,
                packageName: "mysql2",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart,
              },
              (spanInfo) => {
                return self._handleRecordQueryInSpan(
                  spanInfo,
                  originalExecute,
                  queryConfig,
                  args,
                  null as any,
                );
              },
            );
          },
          spanKind: SpanKind.CLIENT,
        });
      }

      return originalExecute(...args);
    };
  }

  private _handleReplayPrepare(
    sql: string,
    originalCallback: Function | undefined,
    clientType: "connection" | "pool" | "poolConnection",
  ): any {
    const self = this;

    return SpanUtils.createAndExecuteSpan(
      this.mode,
      () => {}, // No original call in replay
      {
        name: `mysql2.${clientType}.prepare`,
        kind: SpanKind.CLIENT,
        submodule: "prepare",
        packageType: PackageType.MYSQL,
        packageName: "mysql2",
        instrumentationName: this.INSTRUMENTATION_NAME,
        inputValue: { sql, clientType },
        isPreAppStart: false,
      },
      (spanInfo) => {
        // Create a mock PreparedStatementInfo
        const mockStatement = {
          query: sql,
          id: 1,
          columns: [],
          parameters: [],
          execute: self._getPreparedStatementExecuteWrapper(() => {}, sql, clientType),
          close: () => {},
        };

        try {
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: { prepared: true },
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(`[Mysql2Instrumentation] error ending prepare span:`, error);
        }

        if (originalCallback) {
          process.nextTick(() => originalCallback(null, mockStatement));
        }

        return undefined; // prepare() returns the Command object, but we don't need it for replay
      },
    );
  }

  private _handleNoOpReplayPrepare(sql: string, originalCallback: Function | undefined): any {
    const self = this;

    const mockStatement = {
      query: sql,
      id: 1,
      columns: [],
      parameters: [],
      execute: (...args: any[]) => {
        const values = Array.isArray(args[0]) ? args[0] : [];
        const callback = typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined;
        return self.queryMock.handleNoOpReplayQuery({ sql, values, callback });
      },
      close: () => {},
    };

    if (originalCallback) {
      process.nextTick(() => originalCallback(null, mockStatement));
    }

    return undefined;
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
        callback: typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined,
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
    stackTrace?: string,
  ): EventEmitter {
    return this.queryMock.handleReplayQuery(
      queryConfig,
      inputValue,
      spanInfo,
      submoduleName,
      stackTrace,
    );
  }

  handleNoOpReplayQuery(queryConfig: Mysql2QueryConfig): EventEmitter {
    return this.queryMock.handleNoOpReplayQuery(queryConfig);
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

  private handleNoOpReplayGetConnection(callback?: Function): any {
    logger.debug(
      `[Mysql2Instrumentation] Background getConnection detected, returning mock connection`,
    );

    const mockConnection = new TdMysql2ConnectionMock(this, "pool");

    if (callback) {
      process.nextTick(() => callback(null, mockConnection));
      return;
    }
    return Promise.resolve(mockConnection);
  }

  private _handleReplayPoolGetConnection(spanInfo: SpanInfo, callback?: Function) {
    logger.debug(`[Mysql2Instrumentation] Replaying MySQL2 Pool getConnection`);

    // For pool getConnection operations, simulate returning a mock connection
    const mockConnection = new TdMysql2ConnectionMock(this, "pool", spanInfo);

    if (callback) {
      process.nextTick(() => callback(null, mockConnection));
      return;
    } else {
      return Promise.resolve(mockConnection);
    }
  }

  /**
   * Creates a patched Connection class that intercepts the constructor
   * to handle connection event recording/replay.
   *
   * Wrap the Connection constructor to:
   * - In RECORD mode: listen for 'connect'/'error' events and record them
   * - In REPLAY mode: create a MockConnection that fakes the connection and emits recorded events
   */
  private _getPatchedConnectionClass(OriginalConnection: any): any {
    const self = this;

    // Create the patched constructor function
    function TdPatchedConnection(this: any, ...args: any[]) {
      const inputValue = { method: "createConnection" };
      // RECORD mode: create real connection and record connect/error events
      if (self.mode === TuskDriftMode.RECORD) {
        return handleRecordMode({
          originalFunctionCall: () => new OriginalConnection(...args),
          recordModeHandler: ({ isPreAppStart }) => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => new OriginalConnection(...args),
              {
                name: `mysql2.connection.create`,
                kind: SpanKind.CLIENT,
                submodule: "connectEvent",
                packageType: PackageType.MYSQL,
                packageName: "mysql2",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart,
              },
              (spanInfo) => {
                const connection = new OriginalConnection(...args);

                // Listen for successful connection - record via span
                connection.on("connect", (connectionObj: any) => {
                  try {
                    SpanUtils.addSpanAttributes(spanInfo.span, {
                      outputValue: { connected: true, connectionObj },
                    });
                    SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
                  } catch {
                    logger.error(`[Mysql2Instrumentation] error adding span attributes:`);
                  }
                });

                // Listen for connection errors - record via span
                connection.on("error", (err: Error) => {
                  try {
                    logger.debug(
                      `[Mysql2Instrumentation] Connection error, recording: ${err.message}`,
                    );
                    SpanUtils.endSpan(spanInfo.span, {
                      code: SpanStatusCode.ERROR,
                      message: err.message,
                    });
                  } catch {
                    logger.error(`[Mysql2Instrumentation] error ending span`);
                  }
                });

                return connection;
              },
            );
          },
          spanKind: SpanKind.CLIENT,
        });
      }

      // REPLAY mode: create mock connection that doesn't actually connect
      if (self.mode === TuskDriftMode.REPLAY) {
        return handleReplayMode({
          noOpRequestHandler: () => {
            // For background connection creation, return a mock connection
            return new TdMysql2ConnectionMock(self, "connection");
          },
          isServerRequest: false,
          replayModeHandler: () => {
            return SpanUtils.createAndExecuteSpan(
              self.mode,
              () => new OriginalConnection(...args),
              {
                name: `mysql2.connection.create`,
                kind: SpanKind.CLIENT,
                submodule: "connectEvent",
                packageType: PackageType.MYSQL,
                packageName: "mysql2",
                instrumentationName: self.INSTRUMENTATION_NAME,
                inputValue,
                isPreAppStart: false,
              },
              (spanInfo) => {
                // Create a mock connection class that extends the original
                class MockConnection extends OriginalConnection {
                  private _isConnectOrErrorEmitted = false;
                  private _connectEventMock: TdMysql2ConnectionEventMock;

                  constructor(...mockConnectionArgs: any[]) {
                    // Clone the args and use fake host/port to prevent actual connection
                    const clonedArgs = JSON.parse(JSON.stringify(mockConnectionArgs));
                    if (clonedArgs[0] && clonedArgs[0].config) {
                      clonedArgs[0].config.host = "127.0.0.1";
                      clonedArgs[0].config.port = 127;
                    } else if (clonedArgs[0]) {
                      // Direct config object
                      clonedArgs[0].host = "127.0.0.1";
                      clonedArgs[0].port = 127;
                    }

                    // Call parent constructor with fake connection config
                    super(...clonedArgs);

                    // Get the recorded connection event
                    this._connectEventMock = new TdMysql2ConnectionEventMock(spanInfo);
                  }

                  // Override the 'on' method to emit recorded events
                  on(event: string, listener: Function): any {
                    if (!this._connectEventMock) {
                      return super.on(event, listener);
                    }

                    // Handle 'connect' event - emit recorded connection success
                    if (event === "connect" && !this._isConnectOrErrorEmitted) {
                      this._connectEventMock
                        .getReplayedConnectionEvent(inputValue)
                        .then(({ output }) => {
                          if (output !== undefined) {
                            process.nextTick(() => {
                              listener.call(this, output);
                              this._isConnectOrErrorEmitted = true;
                            });
                          }
                        })
                        .catch((err) => {
                          logger.error(
                            `[Mysql2Instrumentation] Error replaying connection event:`,
                            err,
                          );
                        });
                      return this;
                    }

                    // Handle 'error' event - just register the listener (connection should succeed in replay)
                    if (event === "error" && !this._isConnectOrErrorEmitted) {
                      // In replay mode, we don't expect errors (connection is mocked)
                      // But register the listener anyway for compatibility
                      return this;
                    }

                    // For other events, use the parent handler
                    return super.on(event, listener);
                  }
                }

                const mockConnection = new MockConnection(...args);

                // Add default error listener to prevent unhandled errors
                mockConnection.addListener("error", (_err: Error) => {
                  // Silently catch to prevent crashes
                });

                return mockConnection;
              },
            );
          },
        });
      }

      // Fallback for disabled mode
      return new OriginalConnection(...args);
    }

    // Copy static properties from original class
    const staticProps = Object.getOwnPropertyNames(OriginalConnection).filter(
      (key) => !["length", "name", "prototype"].includes(key),
    );
    for (const staticProp of staticProps) {
      (TdPatchedConnection as any)[staticProp] = OriginalConnection[staticProp];
    }

    // Set prototype chain
    Object.setPrototypeOf(TdPatchedConnection.prototype, OriginalConnection.prototype);

    return TdPatchedConnection;
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
      // INSERT/UPDATE/DELETE query - ResultSetHeader
      // Preserve ALL fields matching mysql2's resultset_header.js structure
      outputValue = {
        fieldCount: result.fieldCount, // Always set by mysql2
        affectedRows: result.affectedRows, // Always set by mysql2
        insertId: result.insertId, // Always set by mysql2
        info: result.info ?? "", // Initialized to '' in mysql2
        serverStatus: result.serverStatus ?? 0, // May be undefined (protocol-dependent)
        warningStatus: result.warningStatus ?? 0, // May be undefined (protocol-dependent)
        changedRows: result.changedRows ?? 0, // Default 0 in mysql2
      };
    } else {
      // Other result types
      outputValue = result;
    }

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _wrap(
    target: Connection | Pool | PoolConnection,
    propertyName: string,
    wrapper: (original: any) => any,
  ): void {
    wrap(target, propertyName, wrapper);
  }
}
