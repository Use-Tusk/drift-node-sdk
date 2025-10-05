import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { SPAN_KIND_CONTEXT_KEY, CALLING_LIBRARY_CONTEXT_KEY } from "../../../core/types";
import { SpanKind } from "@opentelemetry/api";
import { sendUnpatchedDependencyAlert } from "../../../core/analytics";
import { logger } from "../../../core/utils/logger";
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
  private loggedSpans = new Set<string>(); // Track spans that have been logged

  constructor(config: TcpInstrumentationConfig = {}) {
    super("tcp", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
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

      logger.warn(
        `[TcpInstrumentation] TCP ${methodName} called from inbound request context, likely unpatched dependency`,
        {
          spanId: currentSpanInfo.spanId,
          traceId: currentSpanInfo.traceId,
          method: methodName,
          socketContext,
        },
      );

      logger.warn(`[TcpInstrumentation] Full stack trace:\n${new Error().stack}`);

      Error.stackTraceLimit = 10;
      sendUnpatchedDependencyAlert({
        method: methodName,
        spanId: currentSpanInfo.spanId,
        traceId: currentSpanInfo.traceId,
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
    // Don't want to log any HTTP response socket calls
    if (this._isHttpResponseSocket(socketContext)) {
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
      // Log unpatched dependency without expensive stack trace
      this._logUnpatchedDependency(methodName, currentSpanInfo, socketContext);
    }

    // TODO: if we are confident in our ability to detect unpatched dependencies, instead of returning the original method when we detect a unpatched dependency
    // We can throw an error to prevent the server from making actual outbound calls in replay mode
    return originalMethod.apply(socketContext, args);
  }

  private _isHttpResponseSocket(socketContext: any): boolean {
    // Check if this socket is associated with HTTP response handling
    return socketContext && socketContext._httpMessage;
  }
}
