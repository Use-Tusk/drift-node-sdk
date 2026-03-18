import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { SPAN_KIND_CONTEXT_KEY, CALLING_LIBRARY_CONTEXT_KEY } from "../../../core/types";
import { SpanKind } from "@opentelemetry/api";
import { sendUnpatchedDependencyAlert } from "../../../core/analytics";
import { logger, isNextJsRuntime } from "../../../core/utils";
import { SpanInfo } from "../../../core/tracing/SpanUtils";

export interface TcpInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

/**
 * TCP Instrumentation for Tusk Drift
 *
 * Behavior:
 * - REPLAY mode: Intercept TCP calls and check parent span
 *   - If parent span is SERVER (inbound), log it out
 *   - If parent span is not SERVER, log warning about unpached dependency
 *   - Custom checks for HTTP related TCP calls + ProtobufCommunicator calls, no need to log those
 */
export class TcpInstrumentation extends TdInstrumentationBase {
  private mode: TuskDriftMode;
  private loggedSpans = new Set<string>();
  // Tracks sockets that went through our patched connect(). Used to distinguish
  // inherited IPC pipes (which never call connect) from Unix domain socket
  // connections (which do). See _isNonNetworkSocket for details.
  private explicitlyConnectedSockets = new WeakSet<object>();

  constructor(config: TcpInstrumentationConfig = {}) {
    super("tcp", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;

    this._patchLoadedModules();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "net",
        supportedVersions: ["*"],
        patch: (moduleExports: any) => this._patchNetModule(moduleExports),
      }),
    ];
  }

  private _patchLoadedModules(): void {
    if (isNextJsRuntime()) {
      // Why this is needed for Next.js:
      // 1. Next.js's instrumentation hook (instrumentation.ts) runs DURING or AFTER framework initialization
      // 2. By that time, database clients (pg, mysql2, etc.) may have already loaded their dependencies
      // 3. Built-in modules like 'net' don't appear in require.cache like npm packages do
      // 4. The net module may never get loaded naturally if:
      //    - Database connections are lazy-loaded (only created when first needed)
      //    - Next.js webpack optimizes away certain requires
      //    - No database operations occur during startup
      // 5. By force-loading 'net' here, we trigger the require-in-the-middle hooks immediately
      // 6. This ensures that when database clients DO require('net'), they get the patched version
      //
      // For regular Node.js apps where TuskDrift.initialize() runs before any other imports,
      // this force-load is redundant but harmless - the hooks would catch net naturally.
      logger.debug(
        `[TcpInstrumentation] Next.js environment detected - force-loading net module to ensure patching`,
      );

      try {
        // This will trigger the require-in-the-middle hook which calls _onRequire -> _patchNetModule
        require("net");
        logger.debug(`[TcpInstrumentation] net module force-loaded`);
      } catch (err) {
        logger.error(`[TcpInstrumentation] Error force-loading net module:`, err);
      }
    } else {
      // Regular Node.js environment - hooks will catch net when it's first required
      logger.debug(
        `[TcpInstrumentation] Regular Node.js environment - hooks will catch net module on first require`,
      );
    }
  }

  private _patchNetModule(netModule: any): any {
    logger.debug(`[TcpInstrumentation] Patching NET module in ${this.mode} mode`);

    if (this.isModulePatched(netModule)) {
      logger.debug(`[TcpInstrumentation] NET module already patched, skipping`);
      return netModule;
    }

    if (this.mode !== TuskDriftMode.REPLAY) {
      logger.debug(`[TcpInstrumentation] Not in replay mode, returning original net module`);
      return netModule;
    }

    const originalConnect = netModule.Socket.prototype.connect;
    const originalWrite = netModule.Socket.prototype.write;

    const self = this;

    // Patch net.Socket.prototype.connect
    // Socket.prototype has other methods we can patch (read, _write, end, etc)
    // But connect should be sufficient since we are only patching TCP to get insights into what modules we haven't patched
    netModule.Socket.prototype.connect = function (...args: any[]) {
      self.explicitlyConnectedSockets.add(this);
      return self._handleTcpCall("connect", originalConnect, args, this);
    };

    netModule.Socket.prototype.write = function (...args: any[]) {
      return self._handleTcpCall("write", originalWrite, args, this);
    };

    this.markModuleAsPatched(netModule);
    return netModule;
  }

  private _logUnpatchedDependency(
    methodName: string,
    currentSpanInfo: SpanInfo,
    socketContext: any,
  ) {
    const spanKey = `${currentSpanInfo.spanId}-${methodName}`;

    if (!this.loggedSpans.has(spanKey)) {
      this.loggedSpans.add(spanKey);
      Error.stackTraceLimit = Infinity;

      // NOTE: this log string is used in run.sh's
      // If updating this log string, update the log string in the run.sh's
      logger.warn(
        `[TcpInstrumentation] TCP called from inbound request context, likely unpatched dependency`,
        {
          tcpMethod: methodName,
          spanId: currentSpanInfo.spanId,
          traceId: currentSpanInfo.traceId,
          socketContext,
        },
      );

      const stackTrace = new Error().stack || "";
      const traceTestServerSpanId = SpanUtils.getCurrentReplayTraceId();
      logger.warn(`[TcpInstrumentation] Full stack trace:\n${stackTrace}`, {
        traceTestServerSpanId,
      });

      Error.stackTraceLimit = 10;
      sendUnpatchedDependencyAlert({
        traceTestServerSpanId: traceTestServerSpanId || "",
        stackTrace,
      });

      // Clean up old span entries periodically to prevent memory leaks
      if (this.loggedSpans.size > 1000) {
        logger.debug(
          `[TcpInstrumentation] Cleaning up logged spans cache (${this.loggedSpans.size} entries)`,
        );
        this.loggedSpans.clear();
      }
    }
  }

  private _handleTcpCall(
    methodName: string,
    originalMethod: Function,
    args: any[],
    socketContext: any,
  ): any {
    if (this._isNonNetworkSocket(socketContext)) {
      return originalMethod.apply(socketContext, args);
    }

    const currentSpanInfo = SpanUtils.getCurrentSpanInfo();

    if (!currentSpanInfo) {
      return originalMethod.apply(socketContext, args);
    }

    const callingLibrary = currentSpanInfo.context.getValue(CALLING_LIBRARY_CONTEXT_KEY);
    const spanKind = currentSpanInfo.context.getValue(SPAN_KIND_CONTEXT_KEY);

    // Don't want to log any TCP calls made to the CLI
    if (spanKind === SpanKind.SERVER && callingLibrary !== "ProtobufCommunicator") {
      this._logUnpatchedDependency(methodName, currentSpanInfo, socketContext);
    }

    // TODO: if we are confident in our ability to detect unpatched dependencies, instead of returning the original method when we detect a unpatched dependency
    // We can throw an error to prevent the server from making actual outbound calls in replay mode
    return originalMethod.apply(socketContext, args);
  }

  private _isNonNetworkSocket(socketContext: any): boolean {
    if (!socketContext) return false;

    if (socketContext._httpMessage) return true;

    // Filter out inherited IPC pipes while still flagging Unix domain socket connections.
    //
    // Both IPC pipes and Unix domain sockets use Pipe handles (vs TCP handles for network
    // sockets) — see lib/net.js: https://github.com/nodejs/node/blob/main/lib/net.js#L1328-L1331
    //   this._handle = pipe ? new Pipe(PipeConstants.SOCKET) : new TCP(TCPConstants.SOCKET);
    //
    // The key distinction: IPC pipes (e.g. process.send() used by tsx, jest workers, etc.)
    // are inherited from the parent process and never go through net.Socket.prototype.connect().
    // Unix domain socket connections (e.g. PostgreSQL via /var/run/postgresql/.s.PGSQL.5432)
    // DO call connect(). We track which sockets went through our patched connect() in
    // explicitlyConnectedSockets, so we can filter Pipe sockets that were never connected
    // (IPC) while still alerting on ones that were (potential unpatched dependencies).
    const handleType = socketContext._handle?.constructor?.name;
    if (handleType === "Pipe" && !this.explicitlyConnectedSockets.has(socketContext)) {
      return true;
    }

    return false;
  }
}
