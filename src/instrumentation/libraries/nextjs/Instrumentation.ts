import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode, context } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { HttpReplayHooks } from "../http/HttpReplayHooks";
import { DecodedType } from "@use-tusk/drift-schemas/core/json_schema";
import {
  NextjsInstrumentationConfig,
  NextjsServerInputValue,
  NextjsServerOutputValue,
  NextjsBaseServerModule,
} from "./types";
import { wrap, handleRecordMode, handleReplayMode } from "../../core/utils";
import { shouldSample, OriginalGlobalUtils, logger } from "../../../core/utils";
import { PackageType, StatusCode } from "@use-tusk/drift-schemas/core/span";
import { EncodingType, JsonSchemaHelper } from "../../../core/tracing/JsonSchemaHelper";
import { EnvVarTracker } from "../../core/trackers";
import { combineChunks, httpBodyEncoder, getDecodedType } from "../http/utils";
import { TraceBlockingManager } from "../../../core/tracing/TraceBlockingManager";
import { IncomingMessage, ServerResponse } from "http";

export class NextjsInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "NextjsInstrumentation";
  private mode: TuskDriftMode;
  private replayHooks: HttpReplayHooks;
  private tuskDrift: TuskDriftCore;

  constructor(config: NextjsInstrumentationConfig = {}) {
    super("nextjs", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.replayHooks = new HttpReplayHooks();
    this.tuskDrift = TuskDriftCore.getInstance();
    logger.debug(`[NextjsInstrumentation] Constructor called with mode: ${this.mode}`);

    // Almost always, Next.js instrumentation hook runs after Next.js server has loaded,
    // so we need to patch existing modules in require.cache
    this._patchLoadedModules();
  }

  init(): TdInstrumentationNodeModule[] {
    logger.debug(`[NextjsInstrumentation] Initializing in ${this.mode} mode`);
    return [
      new TdInstrumentationNodeModule({
        name: "next/dist/server/base-server",
        supportedVersions: ["*"],
        patch: (moduleExports) => {
          return this._patchBaseServer(moduleExports);
        },
      }),
    ];
  }

  private _patchLoadedModules(): void {
    logger.debug(`[NextjsInstrumentation] Checking for already-loaded Next.js modules`);

    // Search require.cache directly for Next.js server modules
    const pattern = "/next/dist/server/base-server.js";

    let patchedCount = 0;
    for (const [modulePath, cached] of Object.entries(require.cache)) {
      if (modulePath.includes(pattern) && cached && cached.exports) {
        logger.debug(`[NextjsInstrumentation] Found ${pattern} at ${modulePath}, patching now`);
        this._patchBaseServer(cached.exports);
        patchedCount++;
        break; // Only patch each module once
      }
    }

    if (patchedCount === 0) {
      logger.debug(`[NextjsInstrumentation] No Next.js server modules found in require.cache yet`);
      logger.debug(
        `[NextjsInstrumentation] Will wait for require-in-the-middle hooks to catch them`,
      );
    } else {
      logger.debug(
        `[NextjsInstrumentation] Patched ${patchedCount} already-loaded Next.js modules`,
      );
    }
  }

  private _patchBaseServer(baseServerModule: NextjsBaseServerModule): NextjsBaseServerModule {
    logger.debug(`[NextjsInstrumentation] Patching Next.js BaseServer in ${this.mode} mode`);

    // Get the BaseServer class (could be default export or named export)
    const BaseServer = baseServerModule.default || baseServerModule.BaseServer || baseServerModule;

    // Check if this specific BaseServer.prototype is already patched
    // This prevents duplicate patching when multiple Next.js modules export the same BaseServer
    if (BaseServer && BaseServer.prototype) {
      if (this.isModulePatched(BaseServer.prototype)) {
        logger.debug(`[NextjsInstrumentation] BaseServer.prototype already patched, skipping`);
        return baseServerModule;
      }

      if (BaseServer.prototype.handleRequest) {
        this._wrap(BaseServer.prototype, "handleRequest", this._getHandleRequestPatchFn());
        logger.debug(`[NextjsInstrumentation] Wrapped BaseServer.prototype.handleRequest`);
        this.markModuleAsPatched(BaseServer.prototype);
      } else {
        logger.warn(`[NextjsInstrumentation] Could not find BaseServer.prototype.handleRequest`);
      }
    } else {
      logger.warn(`[NextjsInstrumentation] Could not find BaseServer class`);
    }

    logger.debug(`[NextjsInstrumentation] Next.js BaseServer patching complete`);
    return baseServerModule;
  }

  private _getHandleRequestPatchFn() {
    const self = this;

    return (originalHandleRequest: Function) => {
      return async function (
        this: any,
        req: IncomingMessage,
        res: ServerResponse,
        parsedUrl?: any,
      ) {
        // Sample as soon as we can to avoid additional overhead if this request is not sampled
        if (self.mode === TuskDriftMode.RECORD) {
          if (
            !shouldSample({
              samplingRate: self.tuskDrift.getSamplingRate(),
              isAppReady: self.tuskDrift.isAppReady(),
            })
          ) {
            return originalHandleRequest.call(this, req, res, parsedUrl);
          }
        }

        const method = req.method || "GET";
        const url = req.url || "/";

        logger.debug(`[NextjsInstrumentation] Intercepted Next.js request: ${method} ${url}`);

        // Handle replay mode using replay hooks (pass through pattern)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              // Build input value object for server request in replay mode
              const inputValue: NextjsServerInputValue = {
                method,
                url,
                target: url,
                headers: self._normalizeHeaders(req.headers || {}),
              };

              // Set replay trace context
              const replayTraceId = self.replayHooks.extractTraceIdFromHeaders(req);
              if (!replayTraceId) {
                // No trace context; proceed without span
                logger.debug(`[NextjsInstrumentation] No trace ID found, calling original handler`);
                return originalHandleRequest.call(this, req, res, parsedUrl);
              }

              logger.debug(`[NextjsInstrumentation] Setting replay trace id`, replayTraceId);

              // Set env vars for current trace
              const envVars = self.replayHooks.extractEnvVarsFromHeaders(req);
              if (envVars) {
                EnvVarTracker.setEnvVars(replayTraceId, envVars);
              }

              const ctxWithReplayTraceId = SpanUtils.setCurrentReplayTraceId(replayTraceId);

              if (!ctxWithReplayTraceId) {
                throw new Error("Error setting current replay trace id");
              }

              return context.with(ctxWithReplayTraceId, () => {
                return SpanUtils.createAndExecuteSpan(
                  self.mode,
                  () => originalHandleRequest.call(this, req, res, parsedUrl),
                  {
                    name: url,
                    kind: SpanKind.SERVER,
                    packageName: "nextjs",
                    submodule: method,
                    packageType: PackageType.HTTP,
                    instrumentationName: self.INSTRUMENTATION_NAME,
                    inputValue,
                    inputSchemaMerges: {
                      headers: {
                        matchImportance: 0,
                      },
                    },
                    isPreAppStart: false,
                  },
                  (spanInfo) => {
                    // Pass through to Next.js handler and capture response
                    return self._handleNextjsRequestInSpan({
                      req,
                      res,
                      parsedUrl,
                      originalHandleRequest,
                      spanInfo,
                      inputValue,
                      thisContext: this,
                    });
                  },
                );
              });
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          // Skip CORS preflight in RECORD mode (don't create a span)
          if (
            method.toUpperCase() === "OPTIONS" ||
            !!req.headers["access-control-request-method"]
          ) {
            return originalHandleRequest.call(this, req, res, parsedUrl);
          }

          logger.debug(`[NextjsInstrumentation] Creating server span for ${method} ${url}`);
          return handleRecordMode({
            originalFunctionCall: () => originalHandleRequest.call(this, req, res, parsedUrl),
            recordModeHandler: ({ isPreAppStart }: { isPreAppStart: boolean }) => {
              const inputValue: NextjsServerInputValue = {
                method,
                url,
                target: url,
                headers: self._normalizeHeaders(req.headers || {}),
              };

              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalHandleRequest.call(this, req, res, parsedUrl),
                {
                  name: url,
                  kind: SpanKind.SERVER,
                  packageName: "nextjs",
                  packageType: PackageType.HTTP,
                  submodule: method,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue,
                  inputSchemaMerges: {
                    headers: {
                      matchImportance: 0,
                    },
                  },
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleNextjsRequestInSpan({
                    req,
                    res,
                    parsedUrl,
                    originalHandleRequest,
                    spanInfo,
                    inputValue,
                    thisContext: this,
                  });
                },
              );
            },
            spanKind: SpanKind.SERVER,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalHandleRequest.call(this, req, res, parsedUrl);
        }
      };
    };
  }

  private async _handleNextjsRequestInSpan({
    req,
    res,
    parsedUrl,
    originalHandleRequest,
    spanInfo,
    inputValue,
    thisContext,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
    parsedUrl: any;
    originalHandleRequest: Function;
    spanInfo: SpanInfo;
    inputValue: NextjsServerInputValue;
    thisContext: any;
  }) {
    const self = this;

    // Bind context to request/response objects
    context.bind(spanInfo.context, req);
    context.bind(spanInfo.context, res);

    // Track the complete input value (will be updated when body is captured)
    let completeInputValue: NextjsServerInputValue = inputValue;

    // Capture request body if it exists
    this._captureRequestBody(req, spanInfo, inputValue, (updatedInputValue) => {
      completeInputValue = updatedInputValue;
    });

    // Store original statusCode
    let capturedStatusCode: number | undefined;
    let capturedStatusMessage: string | undefined;
    let capturedHeaders: Record<string, string> = {};
    const responseChunks: (string | Buffer)[] = [];

    // Next.js wraps the response object, so we need to access the underlying Node.js response
    const actualRes = (res as any).originalResponse || res;

    // Patch res.writeHead to capture status and headers
    const originalWriteHead = actualRes.writeHead?.bind(actualRes);
    if (originalWriteHead) {
      actualRes.writeHead = function (statusCode: number, statusMessage?: any, headers?: any) {
        capturedStatusCode = statusCode;

        // Handle both signatures: writeHead(status, headers) and writeHead(status, message, headers)
        if (typeof statusMessage === "object") {
          capturedHeaders = self._normalizeHeaders(statusMessage);
        } else {
          capturedStatusMessage = statusMessage;
          if (headers) {
            capturedHeaders = self._normalizeHeaders(headers);
          }
        }

        return originalWriteHead.call(this, statusCode, statusMessage, headers);
      };
    }

    // Patch res.setHeader to capture headers
    const originalSetHeader = actualRes.setHeader?.bind(actualRes);
    if (originalSetHeader) {
      actualRes.setHeader = function (name: string, value: string | string[]) {
        capturedHeaders[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
        return originalSetHeader.call(this, name, value);
      };
    }

    // Patch res.write to capture body chunks
    const originalWrite = actualRes.write?.bind(actualRes);
    if (originalWrite) {
      actualRes.write = function (chunk: string | Buffer, encoding?: any, callback?: any) {
        if (chunk) {
          responseChunks.push(chunk);
        }
        return originalWrite.call(this, chunk, encoding, callback);
      };
    }

    // Patch res.end to capture final body chunk
    const originalEnd = actualRes.end?.bind(actualRes);
    if (originalEnd) {
      actualRes.end = function (chunk?: any, encoding?: any, callback?: any) {
        if (chunk) {
          responseChunks.push(chunk);
        }
        return originalEnd.call(this, chunk, encoding, callback);
      };
    }

    try {
      // Call original Next.js handler (pass through)
      await originalHandleRequest.call(thisContext, req, res, parsedUrl);
    } catch (error) {
      logger.error(
        `[NextjsInstrumentation] Error in Next.js request: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      try {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } catch (e) {
        logger.error(`[NextjsInstrumentation] Error ending span:`, e);
      }
      throw error;
    }

    try {
      // Capture final status code if not already captured
      if (!capturedStatusCode) {
        capturedStatusCode = res.statusCode;
        capturedStatusMessage = res.statusMessage;
      }

      // Get final headers if not already captured
      if (Object.keys(capturedHeaders).length === 0 && res.getHeaders) {
        const rawHeaders = res.getHeaders() as Record<string, string | string[]>;
        capturedHeaders = self._normalizeHeaders(rawHeaders);
      }

      logger.debug(
        `[NextjsInstrumentation] Next.js request completed: ${capturedStatusCode} (${SpanUtils.getTraceInfo()})`,
      );

      // Build output value
      const outputValue: NextjsServerOutputValue = {
        statusCode: capturedStatusCode,
        statusMessage: capturedStatusMessage,
        headers: capturedHeaders,
      };

      // Process response body if we have chunks
      if (responseChunks.length > 0) {
        try {
          const responseBuffer = combineChunks(responseChunks);
          const contentEncoding = outputValue.headers?.["content-encoding"];

          const encodedBody = await httpBodyEncoder({
            bodyBuffer: responseBuffer,
            contentEncoding,
          });

          // Store parsed body data
          outputValue.body = encodedBody;
          outputValue.bodySize = responseBuffer.length;
        } catch (error) {
          logger.error(`[NextjsInstrumentation] Error processing response body:`, error);
        }
      }

      // Add span attributes (use completeInputValue which includes request body)
      SpanUtils.addSpanAttributes(spanInfo.span, {
        inputValue: completeInputValue,
        outputValue,
        outputSchemaMerges: {
          body: {
            encoding: EncodingType.BASE64,
            decodedType: getDecodedType(outputValue.headers?.["content-type"] || ""),
          },
          headers: {
            matchImportance: 0,
          },
        },
        metadata: {
          ENV_VARS: EnvVarTracker.getEnvVars(spanInfo.traceId),
        },
      });

      // Clear env vars
      EnvVarTracker.clearEnvVars(spanInfo.traceId);

      const status =
        (capturedStatusCode || 200) >= 400
          ? { code: SpanStatusCode.ERROR, message: `HTTP ${capturedStatusCode}` }
          : { code: SpanStatusCode.OK };

      SpanUtils.setStatus(spanInfo.span, status);

      // Ignore HTML responses
      // Must check this before ending the span
      if (getDecodedType(outputValue.headers?.["content-type"] || "") === DecodedType.HTML) {
        const traceBlockingManager = TraceBlockingManager.getInstance();
        traceBlockingManager.blockTrace(spanInfo.traceId);
        logger.debug(
          `[NextjsInstrumentation] Blocking trace ${spanInfo.traceId} because it is an HTML response`,
        );
      }

      SpanUtils.endSpan(spanInfo.span);

      // In REPLAY mode, send inbound span to CLI
      if (self.mode === TuskDriftMode.REPLAY) {
        try {
          const now = OriginalGlobalUtils.getOriginalDate();
          const replayTraceId = SpanUtils.getCurrentReplayTraceId() || spanInfo.traceId;

          // Compute schemas and hashes (use completeInputValue which includes request body)
          const { schema: inputSchema, decodedValueHash: inputValueHash } =
            JsonSchemaHelper.generateSchemaAndHash(completeInputValue, {
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(
                  (completeInputValue.headers && completeInputValue.headers["content-type"]) || "",
                ),
              },
              headers: {
                matchImportance: 0,
              },
            });

          const { schema: outputSchema, decodedValueHash: outputValueHash } =
            JsonSchemaHelper.generateSchemaAndHash(outputValue, {
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(outputValue.headers["content-type"] || ""),
              },
              headers: {
                matchImportance: 0,
              },
            });

          const cleanSpan = {
            traceId: replayTraceId,
            spanId: spanInfo.spanId,
            parentSpanId: "",
            name: completeInputValue.url,
            packageName: "nextjs",
            instrumentationName: self.INSTRUMENTATION_NAME,
            submoduleName: completeInputValue.method,
            inputValue: completeInputValue,
            outputValue,
            inputSchema,
            outputSchema,
            inputSchemaHash: JsonSchemaHelper.generateDeterministicHash(inputSchema),
            outputSchemaHash: JsonSchemaHelper.generateDeterministicHash(outputSchema),
            inputValueHash,
            outputValueHash,
            kind: SpanKind.SERVER,
            packageType: PackageType.HTTP,
            status: {
              code: (capturedStatusCode || 200) >= 400 ? StatusCode.ERROR : StatusCode.OK,
              message: (capturedStatusCode || 200) >= 400 ? `HTTP ${capturedStatusCode}` : "",
            },
            timestamp: {
              seconds: Math.floor(now.getTime() / 1000),
              nanos: (now.getTime() % 1000) * 1_000_000,
            },
            duration: { seconds: 0, nanos: 0 },
            isRootSpan: true,
            isPreAppStart: false,
            metadata: undefined,
          };

          await self.tuskDrift.sendInboundSpanForReplay(cleanSpan);
        } catch (e) {
          logger.error("[NextjsInstrumentation] Failed to build/send inbound replay span:", e);
        }
      }
    } catch (error) {
      logger.error(
        `[NextjsInstrumentation] Error in Next.js request: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      try {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      } catch (e) {
        logger.error(`[NextjsInstrumentation] Error ending span:`, e);
      }
    }
  }

  /**
   * Captures the request body from an IncomingMessage stream by patching req.read() and listening for data events.
   * Similar to HTTP instrumentation's request body capture, but adapted for Next.js.
   */
  private _captureRequestBody(
    req: any,
    spanInfo: SpanInfo,
    inputValue: NextjsServerInputValue,
    onBodyCaptured?: (updatedInputValue: NextjsServerInputValue) => void,
  ): void {
    // Next.js wraps the request object, so we need to access the underlying Node.js request
    // Try multiple possible locations for the actual IncomingMessage
    const actualReq = req.originalRequest || req._req || req;

    const requestBodyChunks: Buffer[] = [];
    let streamConsumptionMode: "NOT_CONSUMING" | "READ" | "PIPE" = "NOT_CONSUMING";

    // Patch req.read to capture body chunks when application calls read()
    const originalRead = actualReq.read?.bind(actualReq);
    if (originalRead) {
      actualReq.read = function read(size?: number) {
        const chunk = originalRead(size);
        if (
          chunk &&
          (streamConsumptionMode === "READ" || streamConsumptionMode === "NOT_CONSUMING")
        ) {
          streamConsumptionMode = "READ";
          requestBodyChunks.push(Buffer.from(chunk));
        }
        return chunk;
      };
    }

    // Check if actualReq has event emitter methods
    if (typeof actualReq.once !== "function" || typeof actualReq.addListener !== "function") {
      logger.debug(
        `[NextjsInstrumentation] Request object doesn't have event emitter methods, skipping body capture`,
      );
      return;
    }

    // Listen for 'resume' event to know when streaming starts
    actualReq.once("resume", () => {
      actualReq.addListener("data", (chunk: string | Buffer) => {
        if (
          chunk &&
          (streamConsumptionMode === "PIPE" || streamConsumptionMode === "NOT_CONSUMING")
        ) {
          streamConsumptionMode = "PIPE";
          requestBodyChunks.push(Buffer.from(chunk));
        }
      });
    });

    // Process the complete body when the request ends
    actualReq.addListener("end", async (chunk?: string | Buffer) => {
      if (chunk) {
        requestBodyChunks.push(Buffer.from(chunk));
      }

      if (requestBodyChunks.length > 0) {
        try {
          const bodyBuffer = Buffer.concat(requestBodyChunks);

          // Parse the request body using existing body parser
          const encodedBody = await httpBodyEncoder({
            bodyBuffer,
            contentEncoding: actualReq.headers["content-encoding"] as string,
          });

          // Update input value with parsed body
          const updatedInputValue: NextjsServerInputValue = {
            ...inputValue,
            body: encodedBody,
            bodySize: bodyBuffer.length,
          };

          if (onBodyCaptured) {
            onBodyCaptured(updatedInputValue);
          }

          // Update the span with the complete request body information
          SpanUtils.addSpanAttributes(spanInfo.span, {
            inputValue: updatedInputValue,
            inputSchemaMerges: {
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(actualReq.headers["content-type"] || ""),
              },
              headers: {
                matchImportance: 0,
              },
            },
          });

          logger.debug(
            `[NextjsInstrumentation] Captured request body for ${actualReq.method} ${actualReq.url}: ${bodyBuffer.length} bytes`,
          );
        } catch (error) {
          logger.error(`[NextjsInstrumentation] Error processing request body:`, error);
        }
      }
    });
  }

  private _normalizeHeaders(
    headers: Record<string, string | string[] | undefined>,
  ): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
      }
    }
    return normalized;
  }

  private _wrap(
    target: any,
    propertyName: string,
    wrapper: (original: Function) => Function,
  ): void {
    wrap(target, propertyName, wrapper);
  }
}
