import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  UpstashRedisModuleExports,
  UpstashRedisInputValue,
  UpstashRedisInstrumentationConfig,
  UpstashRequest,
  UpstashResponse,
  UpstashRedisOutputValue,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger, isEsm } from "../../../core/utils";

const SUPPORTED_VERSIONS = [">=1.0.0"];

export class UpstashRedisInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "UpstashRedisInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: UpstashRedisInstrumentationConfig = {}) {
    super("@upstash/redis", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "@upstash/redis",
        supportedVersions: SUPPORTED_VERSIONS,
        patch: (moduleExports: UpstashRedisModuleExports) => {
          return this._patchUpstashRedisModule(moduleExports);
        },
      }),
    ];
  }

  private _patchUpstashRedisModule(
    moduleExports: UpstashRedisModuleExports,
  ): UpstashRedisModuleExports {
    logger.debug(
      `[UpstashRedisInstrumentation] Patching @upstash/redis module in ${this.mode} mode`,
    );

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[UpstashRedisInstrumentation] Module already patched, skipping`);
      return moduleExports;
    }

    // Get the Redis class from module exports
    // The module exports: { Redis, errors }
    const OriginalRedis =
      moduleExports.Redis || (moduleExports.default && moduleExports.default.Redis);

    if (!OriginalRedis || typeof OriginalRedis !== "function") {
      logger.debug(
        `[UpstashRedisInstrumentation] Redis class not found in module exports. Available keys: ${Object.keys(moduleExports).join(", ")}`,
      );
      return moduleExports;
    }

    const self = this;

    // Create wrapped Redis constructor
    // Note: We cannot modify moduleExports.Redis directly because it's non-configurable
    // Instead, we return a new moduleExports object with our wrapped Redis class
    const WrappedRedis = function Redis(this: any, ...args: any[]) {
      logger.debug(`[UpstashRedisInstrumentation] Redis constructor called`);

      // Call original constructor with proper context
      const instance = Reflect.construct(OriginalRedis, args, new.target || WrappedRedis);

      // Wrap the client.request method on this instance
      if (instance && instance.client && typeof instance.client.request === "function") {
        self._wrapClientRequest(instance.client);
        logger.debug(`[UpstashRedisInstrumentation] Wrapped client.request on Redis instance`);
      } else {
        logger.debug(
          `[UpstashRedisInstrumentation] client.request not found on Redis instance. Has client: ${!!instance?.client}`,
        );
      }

      return instance;
    } as any;

    // Copy static properties and prototype from original Redis class
    Object.setPrototypeOf(WrappedRedis, OriginalRedis);
    WrappedRedis.prototype = OriginalRedis.prototype;

    // Return a NEW moduleExports object with our wrapped Redis class
    // This avoids the "Cannot set property Redis" error since the original exports have non-configurable getters
    const newModuleExports: UpstashRedisModuleExports = {
      Redis: WrappedRedis,
      errors: moduleExports.errors,
      __esModule: true,
    };

    this.markModuleAsPatched(newModuleExports);
    logger.debug(`[UpstashRedisInstrumentation] @upstash/redis module patching complete`);

    return newModuleExports;
  }

  private _wrapClientRequest(client: any): void {
    if (this.isModulePatched(client)) {
      return;
    }

    this._wrap(client, "request", this._getRequestPatchFn());
    this.markModuleAsPatched(client);
  }

  private _getRequestPatchFn() {
    const self = this;

    return (originalRequest: Function) => {
      return function request<TResult>(
        this: any,
        req: UpstashRequest,
      ): Promise<UpstashResponse<TResult>> {
        // Extract command information from request
        const inputValue: UpstashRedisInputValue = {
          command: self._extractCommand(req.body),
          commands: self._extractCommands(req.body, req.path),
          path: req.path,
          connectionInfo: {
            baseUrl: this.baseUrl,
          },
        };

        // Determine operation name based on path and body
        const operationName = self._determineOperationName(req.path, req.body);
        const submoduleName = self._determineSubmoduleName(req.path);

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["UpstashRedisInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return { result: undefined } as UpstashResponse<TResult>;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRequest.apply(this, arguments),
                {
                  name: operationName,
                  kind: SpanKind.CLIENT,
                  submodule: submoduleName,
                  packageType: PackageType.REDIS,
                  packageName: "@upstash/redis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayRequest(
                    spanInfo,
                    inputValue,
                    operationName,
                    submoduleName,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalRequest.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRequest.apply(this, arguments),
                {
                  name: operationName,
                  kind: SpanKind.CLIENT,
                  submodule: submoduleName,
                  packageType: PackageType.REDIS,
                  packageName: "@upstash/redis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                  stopRecordingChildSpans: true,
                },
                (spanInfo) => {
                  return self._handleRecordRequest(spanInfo, originalRequest, this, req);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalRequest.apply(this, arguments);
        }
      };
    };
  }

  private _extractCommand(body: unknown): string | string[] | undefined {
    if (Array.isArray(body)) {
      // Single command is an array like ["GET", "key"]
      return body;
    }
    return undefined;
  }

  private _extractCommands(body: unknown, path?: string[]): string[][] | undefined {
    // Pipeline/multi-exec commands are sent to /pipeline or /multi-exec endpoints
    // and the body is an array of command arrays
    if (path && (path.includes("pipeline") || path.includes("multi-exec"))) {
      if (Array.isArray(body)) {
        return body as string[][];
      }
    }
    return undefined;
  }

  private _determineOperationName(path: string[] | undefined, body: unknown): string {
    // If it's a pipeline operation
    if (path && path.length > 0) {
      if (path.includes("pipeline")) {
        return "upstash-redis.pipeline";
      }
      if (path.includes("multi-exec")) {
        return "upstash-redis.multi";
      }
    }

    // Single command - extract command name from body
    if (Array.isArray(body) && body.length > 0 && typeof body[0] === "string") {
      return `upstash-redis.${body[0].toLowerCase()}`;
    }

    return "upstash-redis.command";
  }

  private _determineSubmoduleName(path: string[] | undefined): string {
    if (path && path.length > 0) {
      if (path.includes("pipeline")) {
        return "pipeline";
      }
      if (path.includes("multi-exec")) {
        return "multi";
      }
    }
    return "command";
  }

  private async _handleRecordRequest<TResult>(
    spanInfo: SpanInfo,
    originalRequest: Function,
    thisContext: any,
    req: UpstashRequest,
  ): Promise<UpstashResponse<TResult>> {
    try {
      const result: UpstashResponse<TResult> = await originalRequest.call(thisContext, req);

      logger.debug(
        `[UpstashRedisInstrumentation] Request completed successfully (${SpanUtils.getTraceInfo()})`,
      );

      const outputValue: UpstashRedisOutputValue = {
        result: result.result,
        error: result.error,
      };

      SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
      SpanUtils.endSpan(spanInfo.span, {
        code: result.error ? SpanStatusCode.ERROR : SpanStatusCode.OK,
        message: result.error,
      });

      return result;
    } catch (error: any) {
      logger.debug(
        `[UpstashRedisInstrumentation] Request error: ${error.message} (${SpanUtils.getTraceInfo()})`,
      );
      SpanUtils.endSpan(spanInfo.span, {
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      throw error;
    }
  }

  private async _handleReplayRequest<TResult>(
    spanInfo: SpanInfo,
    inputValue: UpstashRedisInputValue,
    operationName: string,
    submoduleName: string,
    stackTrace?: string,
  ): Promise<UpstashResponse<TResult>> {
    logger.debug(`[UpstashRedisInstrumentation] Replaying request: ${operationName}`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: operationName,
        inputValue: inputValue,
        packageName: "@upstash/redis",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: submoduleName,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[UpstashRedisInstrumentation] No mock data found for operation: ${operationName}`,
      );
      throw new Error(
        `[UpstashRedisInstrumentation] No matching mock found for operation: ${operationName}`,
      );
    }

    logger.debug(
      `[UpstashRedisInstrumentation] Found mock data for operation ${operationName}: ${JSON.stringify(mockData)}`,
    );

    // Return the mocked response in the expected format
    const response: UpstashResponse<TResult> = {
      result: mockData.result?.result,
      error: mockData.result?.error,
    };

    return response;
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
