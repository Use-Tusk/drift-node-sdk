import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode, context } from "@opentelemetry/api";
import {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  RequestOptions,
  Server,
  ServerResponse,
} from "http";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { combineChunks, getDecodedType, httpBodyEncoder, normalizeHeaders } from "./utils";
import { HttpReplayHooks } from "./HttpReplayHooks";
import {
  HttpClientInputValue,
  HttpServerInputValue,
  HttpModuleExports,
  HttpsModuleExports,
  HttpClientOutputValue,
  HttpServerOutputValue,
  HttpProtocol,
} from "./types";
import {
  wrap,
  TUSK_SKIP_HEADER,
  handleRecordMode,
  handleReplayMode,
  isTuskDriftIngestionUrl,
} from "../../core/utils";
import { PackageType, StatusCode } from "@use-tusk/drift-schemas/core/span";
import {
  EncodingType,
  JsonSchemaHelper,
  SchemaMerges,
} from "../../../core/tracing/JsonSchemaHelper";
import { shouldSample, OriginalGlobalUtils, logger } from "../../../core/utils";
import { EnvVarTracker } from "../../core/trackers";
import { HttpSpanData, HttpTransformEngine, TransformConfigs } from "./HttpTransformEngine";

export interface HttpInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (request: any) => void;
  responseHook?: (response: any) => void;
  mode: TuskDriftMode;
  transforms?: TransformConfigs;
}

export class HttpInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "HttpInstrumentation";
  private mode: TuskDriftMode;
  private replayHooks: HttpReplayHooks;
  private tuskDrift: TuskDriftCore;
  private transformEngine: HttpTransformEngine;

  constructor(config: HttpInstrumentationConfig) {
    super("http", config);
    this.mode = config.mode;
    this.replayHooks = new HttpReplayHooks();
    this.tuskDrift = TuskDriftCore.getInstance();
    this.transformEngine = new HttpTransformEngine(config.transforms);
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "http",
        supportedVersions: ["*"],
        patch: (moduleExports: HttpModuleExports) => this._patchHttpModule(moduleExports, "http"),
      }),
      new TdInstrumentationNodeModule({
        name: "https",
        supportedVersions: ["*"],
        patch: (moduleExports: HttpsModuleExports) => this._patchHttpModule(moduleExports, "https"),
      }),
    ];
  }

  private _patchHttpModule(
    httpModule: HttpModuleExports | HttpsModuleExports,
    protocol: HttpProtocol,
  ): HttpModuleExports | HttpsModuleExports {
    const protocolUpper = protocol.toUpperCase();
    logger.debug(`[HttpInstrumentation] Patching ${protocolUpper} module in ${this.mode} mode`);

    if (httpModule._tdPatched) {
      logger.debug(`[HttpInstrumentation] ${protocolUpper} module already patched, skipping`);
      return httpModule;
    }

    this._wrap(httpModule, "request", this._getRequestPatchFn(protocol));
    this._wrap(httpModule, "get", this._getGetPatchFn(protocol));

    const HttpServer = httpModule.Server;
    if (HttpServer && HttpServer.prototype) {
      this._wrap(HttpServer.prototype, "emit", this._getServerEmitPatchFn(protocol));
      logger.debug(`[HttpInstrumentation] Wrapped Server.prototype.emit for ${protocolUpper}`);
    }

    httpModule._tdPatched = true;
    logger.debug(`[HttpInstrumentation] ${protocolUpper} module patching complete`);

    return httpModule;
  }

  private _createServerSpan({
    req,
    res,
    originalHandler,
    protocol,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
    originalHandler: Function;
    protocol: HttpProtocol;
  }): void {
    const method = req.method || "GET";
    const url = req.url || "/";
    const target = req.url || "/";
    const spanProtocol = this._normalizeProtocol(protocol, "http");

    // Ignore drift ingestion endpoints (avoid recording SDK export traffic)
    if (isTuskDriftIngestionUrl(url) || isTuskDriftIngestionUrl(target)) {
      return originalHandler.call(this);
    }

    // Check if transforms want to drop this inbound request entirely (prevents trace creation)
    if (this.transformEngine.shouldDropInboundRequest(method, url, req.headers)) {
      logger.debug(
        `[HttpInstrumentation] Dropping inbound request due to transforms: ${method} ${url}`,
      );
      return originalHandler.call(this);
    }

    // Handle replay mode using replay hooks (only if app is ready)
    if (this.mode === TuskDriftMode.REPLAY) {
      return handleReplayMode({
        replayModeHandler: () => {
          // Remove accept-encoding header to prevent compression during replay
          // since we're providing already-decompressed data
          if (req.headers["accept-encoding"]) {
            delete req.headers["accept-encoding"];
          }

          // Build input value object for server request in replay mode
          const fullUrl = `${spanProtocol}://${req.headers.host || "localhost"}${url}`;
          const inputValue = {
            method,
            url: fullUrl,
            target,
            headers: req.headers,
            httpVersion: req.httpVersion,
            remoteAddress: req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort,
          };

          // Set replay trace context (replaces previous replayHooks-only call)
          const replayTraceId = this.replayHooks.extractTraceIdFromHeaders(req);
          if (!replayTraceId) {
            // No trace context; proceed without span
            return originalHandler.call(this);
          }

          // Only done if we are running integration tests
          this.tuskDrift.createReplayMappingsForTrace(replayTraceId);

          // Set env vars for current trace
          const envVars = this.replayHooks.extractEnvVarsFromHeaders(req);
          if (envVars) {
            EnvVarTracker.setEnvVars(replayTraceId, envVars);
          }

          const ctxWithReplayTraceId = SpanUtils.setCurrentReplayTraceId(replayTraceId);

          if (!ctxWithReplayTraceId) {
            // Replay mode, okay to throw error
            throw new Error("Error setting current replay trace id");
          }

          return context.with(ctxWithReplayTraceId, () => {
            return SpanUtils.createAndExecuteSpan(
              this.mode,
              () => originalHandler.call(this),
              {
                name: `${target}`,
                kind: SpanKind.SERVER,
                packageName: spanProtocol,
                submodule: method,
                packageType: PackageType.HTTP,
                instrumentationName: this.INSTRUMENTATION_NAME,
                inputValue,
                inputSchemaMerges: {
                  headers: {
                    matchImportance: 0,
                  },
                },
                isPreAppStart: false,
              },
              (spanInfo) => {
                // Use the full server-span handler to capture input/output and end the span
                return this._handleInboundRequestInSpan({
                  req,
                  res,
                  originalHandler,
                  spanInfo,
                  inputValue,
                  schemaMerges: {
                    headers: {
                      matchImportance: 0,
                    },
                  },
                  protocol: spanProtocol,
                });
              },
            );
          });
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      // Skip CORS preflight in RECORD mode (don't create a span)
      if (method.toUpperCase() === "OPTIONS" || !!req.headers["access-control-request-method"]) {
        return originalHandler.call(this);
      }

      if (
        !shouldSample({
          samplingRate: this.tuskDrift.getSamplingRate(),
          isAppReady: this.tuskDrift.isAppReady(),
        })
      ) {
        logger.debug(
          `Skipping server span due to sampling rate`,
          url,
          this.tuskDrift.getSamplingRate(),
        );
        return originalHandler.call(this);
      }

      logger.debug(`[HttpInstrumentation] Creating server span for ${method} ${url}`);
      return handleRecordMode({
        originalFunctionCall: () => originalHandler.call(this),
        recordModeHandler: ({ isPreAppStart }) => {
          // Build input value object for server request
          const fullUrl = `${spanProtocol}://${req.headers.host || "localhost"}${url}`;
          const filteredHeaders = { ...req.headers };
          // Remove accept-encoding header (case-insensitive) to prevent compression during replay
          //
          // During RECORD mode, responses are compressed by the server (gzip/deflate/br),
          // then decompressed by our instrumentation and stored as uncompressed base64 data.
          // During REPLAY mode, if the client sends Accept-Encoding headers, the server's
          // compression middleware will compress our already-decompressed response data,
          // resulting in double-compressed garbage that the client can't decode.
          //
          // Therefore, we remove all Accept-Encoding headers during replay so compression middleware
          // skips compression and returns our stored decompressed data directly.
          // IMPORTANT: only update the headers object we are recording, not the original request headers
          Object.keys(filteredHeaders).forEach((key) => {
            if (key.toLowerCase() === "accept-encoding") {
              delete filteredHeaders[key];
            }
          });
          const inputValue = {
            method,
            url: fullUrl,
            target,
            headers: filteredHeaders,
            httpVersion: req.httpVersion,
            remoteAddress: req.socket?.remoteAddress,
            remotePort: req.socket?.remotePort,
          };

          logger.debug(
            `[HttpInstrumentation] Http inbound request arriving, inputValue: ${JSON.stringify(inputValue)}`,
          );

          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => originalHandler.call(this),
            {
              name: `${target}`,
              kind: SpanKind.SERVER,
              packageName: spanProtocol,
              packageType: PackageType.HTTP,
              submodule: method,
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue,
              inputSchemaMerges: {
                headers: {
                  matchImportance: 0,
                },
              },
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleInboundRequestInSpan({
                req,
                res,
                originalHandler,
                spanInfo,
                inputValue, // Body will be populated by _captureServerRequestBody in _handleInboundRequestInSpan
                schemaMerges: {
                  headers: {
                    matchImportance: 0,
                  },
                },
                protocol: spanProtocol,
              });
            },
          );
        },
        spanKind: SpanKind.SERVER,
      });
    } else {
      // Should never happen since we're only patching record and replay modes
      return originalHandler.call(this);
    }
  }

  /**
   * Handles server-side request processing within a span context.
   *
   * TypeScript typing notes:
   * - req: IncomingMessage - We can use proper typing because we only patch req.read() with signature-compatible changes
   * - res: any - We must use 'any' because we patch res.end() with incompatible signatures (async function vs sync overloads)
   *
   * NOTE: addAttributes() will override the current attributes so we need to pass current schema merges
   * to make sure we don't lose any information
   */
  private _handleInboundRequestInSpan({
    req,
    res,
    originalHandler,
    spanInfo,
    inputValue,
    schemaMerges,
    protocol,
  }: {
    req: IncomingMessage;
    res: ServerResponse;
    originalHandler: Function;
    spanInfo: SpanInfo;
    inputValue: {
      method: string;
      url: string;
      target: string;
      headers: IncomingHttpHeaders;
      httpVersion: string;
      remoteAddress?: string;
      remotePort?: number;
    };
    schemaMerges: SchemaMerges | undefined;
    protocol: HttpProtocol;
  }) {
    const self = this;
    const spanProtocol = this._normalizeProtocol(protocol, "http");
    // Bind context to request/response objects
    context.bind(spanInfo.context, req);
    context.bind(spanInfo.context, res);

    // Track the complete input value (will be updated when body is captured)
    let completeInputValue: any = inputValue;

    // Capture request body if it exists
    // NOTE: IncomingMessage doesn't have a .body property - we need to capture it from the stream
    // This patches req.read() and listens for 'data'/'end' events to collect body chunks as they arrive
    // Handles both read() consumption and pipe/stream consumption patterns used by different frameworks
    this._captureServerRequestBody(req, spanInfo, inputValue, schemaMerges, (updatedInputValue) => {
      completeInputValue = updatedInputValue;
    });

    // Track response completion
    const originalEnd = res.end.bind(res);
    const responseChunks: (string | Buffer)[] = [];

    // Patch response write to capture body with Buffer support
    const originalWrite = res.write?.bind(res);
    if (originalWrite) {
      res.write = function (chunk: string | Buffer, encoding?: any, callback?: any) {
        if (chunk) {
          responseChunks.push(chunk);
        }
        return originalWrite.call(this, chunk, encoding, callback);
      };
    }

    res.end = function (chunk: any, encoding?: any, callback?: any) {
      const statusCode = res.statusCode;

      // Capture any final response data
      if (chunk) {
        responseChunks.push(chunk);
      }

      logger.debug(
        `[HttpInstrumentation] Server request completed: ${statusCode} (${SpanUtils.getTraceInfo()})`,
      );

      // Process response body asynchronously without blocking
      process.nextTick(async () => {
        // Normalize headers to lowercase for consistent access
        const rawHeaders = res.getHeaders ? (res.getHeaders() as Record<string, string>) : {};
        const normalizedHeaders = normalizeHeaders(rawHeaders);

        const outputValue: HttpServerOutputValue = {
          statusCode,
          statusMessage: res.statusMessage,
          headers: normalizedHeaders,
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
            logger.error(`[HttpInstrumentation] Error processing server response body:`, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            outputValue.bodyProcessingError = errorMessage;
          }
        }

        try {
          // Apply transforms to span data before adding attributes
          // Use completeInputValue which includes the request body
          const spanData: HttpSpanData = {
            traceId: spanInfo.traceId,
            spanId: spanInfo.spanId,
            kind: SpanKind.SERVER,
            protocol: spanProtocol,
            inputValue: completeInputValue,
            outputValue,
          };
          self.transformEngine.applyTransforms(spanData);

          SpanUtils.addSpanAttributes(spanInfo.span, {
            inputValue: spanData.inputValue,
            outputValue: spanData.outputValue,
            outputSchemaMerges: {
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(
                  (spanData.outputValue as any).headers?.["content-type"] || "",
                ),
              },
              headers: {
                matchImportance: 0,
              },
            },
            metadata: {
              ENV_VARS: EnvVarTracker.getEnvVars(spanInfo.traceId),
            },
            ...(spanData.transformMetadata && {
              transformMetadata: spanData.transformMetadata,
            }),
          });

          // Make sure to delete the env vars from the tracker
          EnvVarTracker.clearEnvVars(spanInfo.traceId);

          const status =
            statusCode >= 400
              ? { code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` }
              : { code: SpanStatusCode.OK };

          SpanUtils.setStatus(spanInfo.span, status);
          SpanUtils.endSpan(spanInfo.span);
        } catch (error) {
          logger.error(`[HttpInstrumentation] Error adding response attributes to span:`, error);
        }

        if (self.mode === TuskDriftMode.REPLAY) {
          try {
            const now = OriginalGlobalUtils.getOriginalDate();
            const replayTraceId = SpanUtils.getCurrentReplayTraceId() || spanInfo.traceId;

            // Derive packageName from URL if needed
            let packageName = spanProtocol;
            try {
              const u = new URL(completeInputValue.url || inputValue.url);
              packageName = self._normalizeProtocol(u.protocol || undefined, spanProtocol);
            } catch {}

            // Compute schemas and hashes using the complete input value (with body)
            const { schema: inputSchema, decodedValueHash: inputValueHash } =
              JsonSchemaHelper.generateSchemaAndHash(completeInputValue, {
                body: {
                  encoding: EncodingType.BASE64,
                  decodedType: getDecodedType(
                    (completeInputValue.headers && completeInputValue.headers["content-type"]) ||
                      "",
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
              name: `${completeInputValue.target || inputValue.target}`,
              packageName,
              instrumentationName: "HttpInstrumentation",
              submoduleName: completeInputValue.method || inputValue.method,
              inputValue: completeInputValue,
              outputValue,
              inputSchema,
              outputSchema,
              inputSchemaHash: JsonSchemaHelper.generateDeterministicHash(inputSchema),
              outputSchemaHash: JsonSchemaHelper.generateDeterministicHash(outputSchema),
              inputValueHash,
              outputValueHash,
              // Use OpenTelemetry SpanKind for CleanSpanData.kind
              kind: SpanKind.SERVER,
              packageType: PackageType.HTTP,
              status: {
                code: statusCode >= 400 ? StatusCode.ERROR : StatusCode.OK,
                message: statusCode >= 400 ? `HTTP ${statusCode}` : "",
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
            logger.error("[HttpInstrumentation] Failed to build/send inbound replay span:", e);
          }
        }
      });

      return originalEnd.call(this, chunk, encoding, callback);
    };

    // Track errors
    req.on("error", (error: Error) => {
      try {
        logger.debug(
          `[HttpInstrumentation] Server request error: ${error.message} (${SpanUtils.getTraceInfo()})`,
        );
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      } catch (error) {
        logger.error(`[HttpInstrumentation] Error ending span:`, error);
      }
    });

    res.on("error", (error: Error) => {
      try {
        logger.debug(
          `[HttpInstrumentation] Server response error: ${error.message} (${SpanUtils.getTraceInfo()})`,
        );
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      } catch (error) {
        logger.error(`[HttpInstrumentation] Error ending span:`, error);
      }
    });

    // Call the original handler within the span context
    return originalHandler.call(this);
  }

  /**
   * Captures the request body from an IncomingMessage stream by patching req.read() and listening for data events.
   * This is necessary because IncomingMessage doesn't expose the body directly - it must be read from the stream.
   *
   * The method handles two consumption patterns:
   * - READ mode: When application calls req.read() directly
   * - PIPE mode: When request is piped/streamed (data events)
   *
   * When the request body is fully captured (on 'end' event), it parses the body and updates the span
   * with the complete input data. This ensures exported spans contain the full request body information.
   *
   * NOTE: addAttributes() will override the current attributes so we need to pass current schema merges
   * to make sure we don't lose any information
   */
  private _captureServerRequestBody(
    req: IncomingMessage,
    spanInfo: SpanInfo,
    inputValue: {
      method: string;
      url: string;
      target: string;
      headers: IncomingHttpHeaders;
      httpVersion: string;
      remoteAddress?: string;
      remotePort?: number;
    },
    schemaMerges: SchemaMerges | undefined,
    onBodyCaptured?: (updatedInputValue: HttpServerInputValue) => void,
  ): void {
    const requestBodyChunks: Buffer[] = [];
    let streamConsumptionMode: "NOT_CONSUMING" | "READ" | "PIPE" = "NOT_CONSUMING";

    // Patch req.read to capture body chunks when application calls read()
    const originalRead = req.read.bind(req);
    req.read = function read(size?: number) {
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

    // Listen for 'resume' event to know when streaming starts
    req.once("resume", () => {
      req.addListener("data", (chunk: string | Buffer) => {
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
    req.addListener("end", async (chunk?: string | Buffer) => {
      if (chunk) {
        requestBodyChunks.push(Buffer.from(chunk));
      }

      if (requestBodyChunks.length > 0) {
        try {
          const bodyBuffer = Buffer.concat(requestBodyChunks);

          // Parse the request body using existing body parser
          const encodedBody = await httpBodyEncoder({
            bodyBuffer,
            contentEncoding: req.headers["content-encoding"] as string,
          });

          // Update input value with parsed body
          const updatedInputValue: HttpServerInputValue = {
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
              ...schemaMerges,
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(req.headers["content-type"] || ""),
              },
            },
          });

          logger.debug(
            `[HttpInstrumentation] Captured request body for ${req.method} ${req.url}: ${bodyBuffer.length} bytes`,
          );
        } catch (error) {
          logger.error(`[HttpInstrumentation] Error processing request body:`, error);
        }
      }
    });
  }

  private _captureClientRequestBody(
    req: ClientRequest,
    spanInfo: SpanInfo,
    inputValue: HttpClientInputValue,
    schemaMerges: SchemaMerges | undefined,
  ): void {
    const requestBodyChunks: (string | Buffer)[] = [];
    let requestBodyCaptured = false;

    // Patch the write method to capture request body
    const originalWrite = req.write?.bind(req);
    if (originalWrite) {
      req.write = function (chunk: any, encoding?: any, callback?: any): boolean {
        if (chunk && !requestBodyCaptured) {
          requestBodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        }
        return originalWrite.call(this, chunk, encoding, callback);
      };
    }

    // Patch the end method to capture final request body and process it
    const originalEnd = req.end?.bind(req);
    if (originalEnd) {
      req.end = function (chunk?: any, encoding?: any, callback?: any): ClientRequest {
        // Capture final chunk if provided
        if (chunk && !requestBodyCaptured) {
          requestBodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding));
        }

        // Process captured request body asynchronously (don't block the request)
        if (requestBodyChunks.length > 0 && !requestBodyCaptured) {
          requestBodyCaptured = true;
          (async () => {
            try {
              const bodyBuffer = Buffer.concat(
                requestBodyChunks.map((chunk) =>
                  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
                ),
              );

              // Parse the request body using existing body parser
              const encodedBody = await httpBodyEncoder({
                bodyBuffer,
              });

              // Update input value with parsed body
              const updatedInputValue: HttpClientInputValue = {
                ...inputValue,
                body: encodedBody,
                bodySize: bodyBuffer.length,
              };

              // Update the span with the complete request body information
              SpanUtils.addSpanAttributes(spanInfo.span, {
                inputValue: updatedInputValue,
                inputSchemaMerges: {
                  ...schemaMerges,
                  body: {
                    encoding: EncodingType.BASE64,
                    decodedType: getDecodedType(inputValue.headers["content-type"] || ""),
                  },
                },
              });

              logger.debug(
                `[HttpInstrumentation] Captured request body for ${req.method} ${req.path}: ${bodyBuffer.length} bytes`,
              );
            } catch (error) {
              logger.error(`[HttpInstrumentation] Error processing request body:`, error);
            }
          })();
        }

        return originalEnd.call(this, chunk, encoding, callback);
      };
    }
  }

  /*
   * This is the main function that executes a real HTTP request with proper span handling
   * Should be passed to SpanExecutor.createAndExecuteSpan
   */
  private _handleOutboundRequestInSpan(
    originalRequest: Function,
    args: any[],
    spanInfo: SpanInfo,
    inputValue: HttpClientInputValue,
    schemaMerges: SchemaMerges | undefined,
  ) {
    const req = originalRequest.apply(this, args);

    // NOTE: This is a patch to capture the request body
    // This is necessary because ClientRequest doesn't have a .body property - we need to capture it from the stream
    // This patches req.write() and listens for 'data'/'end' events to collect body chunks as they arrive
    // Handles both write() consumption and pipe/stream consumption patterns used by different frameworks
    this._captureClientRequestBody(req, spanInfo, inputValue, schemaMerges);

    // Add event listeners to track request/response within span context
    req.on("response", (res: IncomingMessage) => {
      logger.debug(
        `[HttpInstrumentation] HTTP response received: ${res.statusCode} (${SpanUtils.getTraceInfo()})`,
      );

      // Build basic output value object
      const outputValue: HttpClientOutputValue = {
        statusCode: res.statusCode,
        statusMessage: res.statusMessage,
        headers: this._captureHeadersFromRawHeaders(res.rawHeaders),
        httpVersion: res.httpVersion,
        httpVersionMajor: res.httpVersionMajor,
        httpVersionMinor: res.httpVersionMinor,
        complete: res.complete,
        readable: res.readable,
      };

      // Capture response body
      const responseChunks: (string | Buffer)[] = [];

      if (res.readable) {
        res.on("data", (chunk: any) => {
          responseChunks.push(chunk);
        });

        res.on("end", async () => {
          if (responseChunks.length > 0) {
            try {
              // Combine all chunks into a single buffer
              const responseBuffer = combineChunks(responseChunks);

              // Capture raw headers before processing
              const rawHeaders = this._captureHeadersFromRawHeaders(res.rawHeaders);

              // Store the raw headers
              outputValue.headers = rawHeaders;

              // Parse response body
              const contentEncoding = rawHeaders["content-encoding"];
              const encodedBody = await httpBodyEncoder({
                bodyBuffer: responseBuffer,
                contentEncoding,
              });

              // Store parsed body data
              outputValue.body = encodedBody;
              outputValue.bodySize = responseBuffer.length;

              this._addOutputAttributesToSpan({
                spanInfo,
                outputValue,
                statusCode: res.statusCode || 1,
                outputSchemaMerges: {
                  body: {
                    encoding: EncodingType.BASE64,
                    decodedType: getDecodedType(outputValue.headers["content-type"] || ""),
                  },
                  headers: {
                    matchImportance: 0,
                  },
                },
                inputValue,
              });
            } catch (error) {
              logger.error(`[HttpInstrumentation] Error processing response body:`, error);
            }
          }
        });
      } else {
        try {
          this._addOutputAttributesToSpan({
            spanInfo,
            outputValue,
            statusCode: res.statusCode || 1,
            outputSchemaMerges: {
              body: {
                encoding: EncodingType.BASE64,
                decodedType: getDecodedType(outputValue.headers["content-type"] || ""),
              },
              headers: {
                matchImportance: 0,
              },
            },
            inputValue,
          });
        } catch (error) {
          logger.error(`[HttpInstrumentation] Error adding output attributes to span:`, error);
        }
      }
    });

    req.on("error", (error: Error) => {
      try {
        logger.debug(
          `[HttpInstrumentation] HTTP request error: ${error.message} (${SpanUtils.getTraceInfo()})`,
        );
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      } catch (error) {
        logger.error(`[HttpInstrumentation] Error ending span:`, error);
      }
    });

    return req;
  }

  /**
   * Helper method to add output attributes to span
   */
  private _addOutputAttributesToSpan({
    spanInfo,
    outputValue,
    statusCode,
    outputSchemaMerges,
    inputValue,
  }: {
    spanInfo: SpanInfo;
    outputValue: HttpClientOutputValue;
    statusCode: number;
    outputSchemaMerges?: SchemaMerges;
    inputValue: HttpClientInputValue;
  }): void {
    // Apply transforms
    const normalizedProtocol = this._normalizeProtocol(inputValue.protocol, "http");
    const spanData: HttpSpanData = {
      traceId: spanInfo.traceId,
      spanId: spanInfo.spanId,
      kind: SpanKind.CLIENT,
      protocol: normalizedProtocol,
      inputValue,
      outputValue,
    };

    this.transformEngine.applyTransforms(spanData);

    SpanUtils.addSpanAttributes(spanInfo.span, {
      inputValue: spanData.inputValue,
      outputValue: spanData.outputValue,
      outputSchemaMerges,
      transformMetadata: spanData.transformMetadata ? spanData.transformMetadata : undefined,
    });

    // Set span status based on HTTP status
    const status =
      statusCode >= 400
        ? { code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` }
        : { code: SpanStatusCode.OK };

    SpanUtils.endSpan(spanInfo.span, status);
  }

  private _captureHeadersFromRawHeaders(rawHeaders: string[]): Record<string, string> {
    const headers: Record<string, string> = {};
    for (let i = 0; i < rawHeaders.length; i += 2) {
      const key = rawHeaders[i].toLowerCase();
      const value = rawHeaders[i + 1];
      headers[key] = value;
    }
    return headers;
  }

  private _getRequestPatchFn(protocol: HttpProtocol) {
    const self = this;

    return (originalRequest: Function) => {
      return function (this: Request, ...args: any[]) {
        // Handle both URL string and RequestOptions object
        let requestOptions: RequestOptions;
        if (typeof args[0] === "string") {
          // Parse URL string into RequestOptions
          const url = new URL(args[0]);
          requestOptions = {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port ? parseInt(url.port) : undefined,
            path: url.pathname + url.search,
            method: args[1]?.method || "GET",
            headers: args[1]?.headers || {},
          };
        } else {
          requestOptions = args[0] || {};
        }
        const method = requestOptions.method || "GET";
        const requestProtocol = self._normalizeProtocol(
          requestOptions.protocol || undefined,
          protocol,
        );

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              // Build input value object for replay mode
              const headers = normalizeHeaders(requestOptions.headers || {});
              const inputValue: HttpClientInputValue = {
                method,
                path: requestOptions.path || undefined,
                headers,
                protocol: requestProtocol,
                hostname: requestOptions.hostname || requestOptions.host || undefined,
                port: requestOptions.port ? Number(requestOptions.port) : undefined,
                timeout: requestOptions.timeout || undefined,
              };

              // Create span in replay mode
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRequest.apply(this, args),
                {
                  name: requestOptions.path || `${requestProtocol.toUpperCase()} ${method}`,
                  kind: SpanKind.CLIENT,
                  packageName: requestProtocol,
                  packageType: PackageType.HTTP,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  submodule: method,
                  inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.replayHooks.handleOutboundReplayRequest({
                    method,
                    requestOptions,
                    protocol: requestProtocol,
                    args,
                    spanInfo,
                  });
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalRequest.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              const headers = normalizeHeaders(requestOptions.headers || {});

              // Ignore SDK's own drift export calls
              if (
                headers[TUSK_SKIP_HEADER] === "true" ||
                isTuskDriftIngestionUrl(requestOptions.path)
              ) {
                return originalRequest.apply(this, args);
              }

              const inputValue: HttpClientInputValue = {
                method,
                path: requestOptions.path || undefined,
                headers,
                protocol: requestProtocol,
                hostname: requestOptions.hostname || requestOptions.host || undefined,
                port: requestOptions.port ? Number(requestOptions.port) : undefined,
                timeout: requestOptions.timeout || undefined,
              };

              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalRequest.apply(this, args),
                {
                  name: requestOptions.path || `${requestProtocol.toUpperCase()} ${method}`,
                  kind: SpanKind.CLIENT,
                  packageName: requestProtocol,
                  packageType: PackageType.HTTP,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  submodule: method,
                  inputValue,
                  inputSchemaMerges: {
                    headers: {
                      matchImportance: 0,
                    },
                  },
                  isPreAppStart,
                },
                (spanInfo: SpanInfo) => {
                  return self._handleOutboundRequestInSpan(
                    originalRequest,
                    args,
                    spanInfo,
                    inputValue,
                    {
                      headers: {
                        matchImportance: 0,
                      },
                    },
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalRequest.apply(this, args);
        }
      };
    };
  }

  private _getGetPatchFn(protocol: HttpProtocol) {
    const self = this;

    return (originalGet: Function) => {
      return function (this: Request, ...args: any[]) {
        // Handle both URL string and RequestOptions object
        let requestOptions: RequestOptions;
        if (typeof args[0] === "string") {
          // Parse URL string into RequestOptions
          const url = new URL(args[0]);
          requestOptions = {
            protocol: url.protocol,
            hostname: url.hostname,
            port: url.port ? parseInt(url.port) : undefined,
            path: url.pathname + url.search,
            headers: args[1]?.headers || {},
          };
        } else {
          requestOptions = args[0] || {};
        }
        const method = "GET";
        const requestProtocol = self._normalizeProtocol(
          requestOptions.protocol || undefined,
          protocol,
        );

        // Handle replay mode using replay hooks (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            replayModeHandler: () => {
              // Build input value object for replay mode
              const headers = normalizeHeaders(requestOptions.headers || {});
              const inputValue: HttpClientInputValue = {
                method,
                path: requestOptions.path || undefined,
                headers,
                protocol: requestProtocol,
                hostname: requestOptions.hostname || requestOptions.host || undefined,
                port: requestOptions.port ? Number(requestOptions.port) : undefined,
                timeout: requestOptions.timeout || undefined,
              };

              // Create span in replay mode
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.apply(this, args),
                {
                  name: requestOptions.path || `${requestProtocol.toUpperCase()} ${method}`,
                  kind: SpanKind.CLIENT,
                  packageName: requestProtocol,
                  packageType: PackageType.HTTP,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  submodule: method,
                  inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.replayHooks.handleOutboundReplayRequest({
                    method,
                    requestOptions,
                    protocol: requestProtocol,
                    args,
                    spanInfo,
                  });
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalGet.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              const headers = normalizeHeaders(requestOptions.headers || {});

              // Ignore SDK's own drift export calls
              if (
                headers[TUSK_SKIP_HEADER] === "true" ||
                isTuskDriftIngestionUrl(requestOptions.path)
              ) {
                return originalGet.apply(this, args);
              }

              const inputValue: HttpClientInputValue = {
                method,
                path: requestOptions.path || undefined,
                headers,
                protocol: requestProtocol,
                hostname: requestOptions.hostname || requestOptions.host || undefined,
                port: requestOptions.port ? Number(requestOptions.port) : undefined,
                timeout: requestOptions.timeout || undefined,
              };

              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalGet.apply(this, args),
                {
                  name: requestOptions.path || `${requestProtocol.toUpperCase()} ${method}`,
                  kind: SpanKind.CLIENT,
                  packageName: requestProtocol,
                  packageType: PackageType.HTTP,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  submodule: method,
                  inputValue,
                  inputSchemaMerges: {
                    headers: {
                      matchImportance: 0,
                    },
                  },
                  isPreAppStart,
                },
                (spanInfo: SpanInfo) => {
                  return self._handleOutboundRequestInSpan(
                    originalGet,
                    args,
                    spanInfo,
                    inputValue,
                    {
                      headers: {
                        matchImportance: 0,
                      },
                    },
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalGet.apply(this, args);
        }
      };
    };
  }

  private _getServerEmitPatchFn(protocol: HttpProtocol) {
    const self = this;

    return (originalEmit: Function) => {
      return function (this: Server, eventName: string, ...args: any[]) {
        if (eventName === "request") {
          const req = args[0];
          const res = args[1];

          return self._createServerSpan({
            req,
            res,
            originalHandler: () => {
              return originalEmit.apply(this, [eventName, ...args]);
            },
            protocol,
          });
        }

        return originalEmit.apply(this, [eventName, ...args]);
      };
    };
  }

  private _normalizeProtocol(protocol: string | undefined, fallback: HttpProtocol): HttpProtocol {
    if (!protocol) {
      return fallback;
    }

    const normalized = protocol.toLowerCase().replace(/:$/, "");
    if (normalized === "http" || normalized === "https") {
      return normalized;
    }

    return fallback;
  }

  private _wrap(
    target: HttpModuleExports | HttpsModuleExports | Server,
    propertyName: string,
    wrapper: (original: Function) => Function,
  ): void {
    wrap(target, propertyName, wrapper);
  }
}
