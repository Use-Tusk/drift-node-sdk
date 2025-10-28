import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanInfo, SpanUtils } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { getDecodedType, httpBodyEncoder } from "../http/utils";
import { captureStackTrace, isTuskDriftIngestionUrl, TUSK_SKIP_HEADER } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleReplayMode, handleRecordMode } from "../../core/utils/modeUtils";
import { FetchInputValue, FetchOutputValue, FetchInstrumentationConfig } from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { EncodingType } from "../../../core/tracing/JsonSchemaHelper";
import { logger } from "../../../core/utils/logger";
import { FetchSpanData, FetchTransformEngine } from "./FetchTransformEngine";

/**
 * Fetch API instrumentation for capturing requests made via fetch()
 * This covers libraries like @octokit/rest, axios (when using fetch adapter), etc.
 */
export class FetchInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "FetchInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private originalFetch?: typeof globalThis.fetch;
  private transformEngine: FetchTransformEngine;

  constructor(config: FetchInstrumentationConfig = {}) {
    super("fetch", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
    this.transformEngine = new FetchTransformEngine(config.transforms);
  }

  init(): TdInstrumentationNodeModule[] {
    // Fetch is a global, not a module, so we patch it directly
    // Fetch doesn't need to be reuired'd like other node modules hence we just directly patch it
    this.patchGlobalFetch();
    return [];
  }

  private patchGlobalFetch(): void {
    // Unlike other instrumentations that patch modules when they're required (lazy patching),
    // fetch instrumentation patches the global fetch function immediately during init() since
    // fetch is a global API, not a module. This means we need to explicitly check if the
    // instrumentation is enabled before patching, otherwise we'd always patch globalThis.fetch
    // even when the user has disabled fetch instrumentation.
    if (this.mode === TuskDriftMode.DISABLED || !this._config.enabled) {
      return;
    }

    if (typeof globalThis.fetch !== "function") {
      logger.debug("fetch not available in this environment");
      return;
    }

    this.originalFetch = globalThis.fetch;
    const self = this;

    globalThis.fetch = function (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> {
      const stackTrace = captureStackTrace(["FetchInstrumentation"]);
      return self._handleFetchRequest(input, init, stackTrace);
    } as typeof globalThis.fetch;

    logger.debug("Global fetch patching complete");
  }

  private async _handleFetchRequest(
    input: string | URL | Request,
    init?: RequestInit,
    stackTrace?: string,
  ): Promise<Response> {
    // Parse request details
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = init?.method || "GET";
    const headers = init?.headers || {};

    let normalizedHeaders = {};
    let encodedBody: any = init?.body;
    try {
      normalizedHeaders = this._normalizeHeaders(headers);
      encodedBody = init?.body ? ((await this._encodeRequestBody(init?.body)) as any) : init?.body;
    } catch (error) {
      logger.error(`FetchInstrumentation error normalizing headers:`, error);
    }

    // Ignore SDK's own drift export calls
    const shouldSkip =
      (normalizedHeaders as any)[TUSK_SKIP_HEADER] === "true" || isTuskDriftIngestionUrl(url);

    if (shouldSkip) {
      return this.originalFetch!(input, init);
    }

    const inputValue: FetchInputValue = {
      url,
      method,
      headers: normalizedHeaders,
      body: encodedBody,
    };

    // Handle replay mode (only if app is ready)
    if (this.mode === TuskDriftMode.REPLAY) {
      return handleReplayMode({
        replayModeHandler: () => {
          // Create span in replay mode
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => this.originalFetch!(input, init),
            {
              name: url,
              kind: SpanKind.CLIENT,
              packageName: "fetch",
              packageType: PackageType.HTTP,
              instrumentationName: this.INSTRUMENTATION_NAME,
              submodule: inputValue.method,
              inputValue,
              isPreAppStart: false,
            },
            (spanInfo) => {
              return this._handleReplayFetch(inputValue, spanInfo, stackTrace);
            },
          );
        },
      });
    } else if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => this.originalFetch!(input, init),
        recordModeHandler: ({ isPreAppStart }) =>
          this._handleRecordFetch(input, inputValue, isPreAppStart, init),
        spanKind: SpanKind.CLIENT,
      });
    } else {
      // Should never happen since we're only patching record and replay modes
      return this.originalFetch!(input, init);
    }
  }

  private _handleRecordFetch(
    input: string | URL | Request,
    inputValue: FetchInputValue,
    isPreAppStart: boolean,
    init?: RequestInit,
  ): Promise<Response> {
    return SpanUtils.createAndExecuteSpan(
      this.mode,
      () => this.originalFetch!(input, init),
      {
        name: inputValue.url,
        kind: SpanKind.CLIENT,
        packageName: "fetch",
        packageType: PackageType.HTTP,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submodule: inputValue.method,
        inputValue,
        inputSchemaMerges: {
          ...(inputValue.body && {
            body: {
              encoding: EncodingType.BASE64,
              decodedType: getDecodedType(inputValue.headers["content-type"] || ""),
            },
          }),
          ...(inputValue.headers && {
            headers: {
              matchImportance: 0,
            },
          }),
        },
        isPreAppStart,
      },
      (spanInfo) => {
        return this.originalFetch!(input, init)
          .then(async (response) => {
            // Clone response to read body without consuming it
            try {
              const responseClone = response.clone();
              const encodedBody = await this._encodeResponseBody(responseClone);

              const outputValue = {
                status: response.status,
                statusText: response.statusText,
                headers: this._responseHeadersToObject(response.headers),
                body: encodedBody,
                bodySize: encodedBody?.length || 0,
              } as FetchOutputValue;

              // Apply transforms to span data before adding attributes
              const spanData: FetchSpanData = {
                traceId: spanInfo.traceId,
                spanId: spanInfo.spanId,
                kind: SpanKind.CLIENT,
                inputValue,
                outputValue,
              };
              this.transformEngine.applyTransforms(spanData);

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
                ...(spanData.transformMetadata && {
                  transformMetadata: spanData.transformMetadata,
                }),
              });

              const status =
                response.status >= 400
                  ? { code: SpanStatusCode.ERROR, message: `HTTP ${response.status}` }
                  : { code: SpanStatusCode.OK };

              SpanUtils.endSpan(spanInfo.span, status);
            } catch (error) {
              logger.error(`FetchInstrumentation error processing response body:`, error);
            }
            return response;
          })
          .catch((error) => {
            try {
              SpanUtils.endSpan(spanInfo.span, {
                code: SpanStatusCode.ERROR,
                message: error.message,
              });
            } catch (error) {
              logger.error(`FetchInstrumentation error ending span:`, error);
            }
            throw error;
          });
      },
    );
  }

  private async _handleReplayFetch(
    inputValue: FetchInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ): Promise<Response> {
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: inputValue.url,
        packageName: "fetch",
        packageType: PackageType.HTTP,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: inputValue.method,
        inputValue,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
      inputValueSchemaMerges: {
        ...(inputValue.body && {
          body: {
            encoding: EncodingType.BASE64,
            decodedType: getDecodedType(inputValue.headers["content-type"] || ""),
          },
        }),
        ...(inputValue.headers && {
          headers: {
            matchImportance: 0,
          },
        }),
      },
    });

    if (!mockData) {
      logger.warn(
        `[FetchInstrumentation] No mock data found for fetch request with input value: ${JSON.stringify(inputValue)}`,
      );
      // Return a no-op response (200 OK with empty body)
      const mockResponse = new Response(null, {
        status: 200,
        statusText: "OK",
      });

      return Promise.resolve(mockResponse);
    }

    const { result } = mockData;
    const responseBody = this._constructFetchResponseBody(result);

    const mockResponse = new Response(responseBody, {
      status: result.status,
      statusText: result.statusText,
      headers: new Headers(result.headers),
    });

    return Promise.resolve(mockResponse);
  }

  private _normalizeHeaders(headers: any): Record<string, string> {
    if (headers instanceof Headers) {
      const result: Record<string, string> = {};
      headers.forEach((value, key) => {
        result[key.toLowerCase()] = value;
      });
      return result;
    } else if (Array.isArray(headers)) {
      const result: Record<string, string> = {};
      headers.forEach(([key, value]) => {
        result[key.toLowerCase()] = value;
      });
      return result;
    } else if (typeof headers === "object" && headers !== null) {
      const result: Record<string, string> = {};
      Object.entries(headers).forEach(([key, value]) => {
        if (typeof value === "string") {
          result[key.toLowerCase()] = value;
        }
      });
      return result;
    }
    return {};
  }

  private async _encodeRequestBody(body: any): Promise<string | undefined> {
    try {
      let bodyBuffer: Buffer;

      if (body === null) {
        return undefined;
      }

      if (typeof body === "string") {
        // String body - convert to buffer
        bodyBuffer = Buffer.from(body, "utf8");
      } else if (body instanceof ArrayBuffer) {
        // ArrayBuffer - convert directly
        bodyBuffer = Buffer.from(body);
      } else if (
        body instanceof Uint8Array ||
        body instanceof Int8Array ||
        body instanceof Uint16Array ||
        body instanceof Int16Array ||
        body instanceof Uint32Array ||
        body instanceof Int32Array ||
        body instanceof Float32Array ||
        body instanceof Float64Array ||
        body instanceof DataView
      ) {
        // TypedArray or DataView - convert to buffer
        bodyBuffer = Buffer.from(body.buffer, body.byteOffset, body.byteLength);
      } else if (body instanceof URLSearchParams) {
        // URLSearchParams - convert to string first
        bodyBuffer = Buffer.from(body.toString(), "utf8");
      } else if (body instanceof FormData) {
        // FormData - this is tricky, we need to serialize it
        // For now, let's skip encoding FormData as it's complex
        logger.warn("FormData encoding not yet supported, skipping body encoding");
        return undefined;
      } else if (body instanceof Blob) {
        // Blob - read as array buffer
        const arrayBuffer = await body.arrayBuffer();
        bodyBuffer = Buffer.from(arrayBuffer);
      } else if (body && typeof body === "object" && Symbol.asyncIterator in body) {
        // AsyncIterable<Uint8Array>
        const chunks: Uint8Array[] = [];
        for await (const chunk of body as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
        bodyBuffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      } else if (body && typeof body === "object" && Symbol.iterator in body) {
        // Iterable<Uint8Array>
        const chunks: Uint8Array[] = [];
        for (const chunk of body as Iterable<Uint8Array>) {
          chunks.push(chunk);
        }
        bodyBuffer = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
      } else {
        // Unknown type
        logger.warn("Unknown body type, cannot encode:", typeof body, body);
        return undefined;
      }

      return await httpBodyEncoder({ bodyBuffer });
    } catch (error) {
      logger.warn("Failed to encode request body:", error);
      return undefined;
    }
  }

  /**
   * Encode response body using existing httpBodyEncoder
   */
  private async _encodeResponseBody(response: Response): Promise<string | undefined> {
    try {
      if (!response.body) {
        return undefined;
      }
      const arrayBuffer = await response.arrayBuffer();
      const bodyBuffer = Buffer.from(arrayBuffer);

      return await httpBodyEncoder({ bodyBuffer });
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Construct response body for replay mode
   */
  private _constructFetchResponseBody(result: FetchOutputValue): Buffer<ArrayBuffer> | null {
    if (result.body) {
      return Buffer.from(result.body, "base64");
    }
    return null;
  }

  private _responseHeadersToObject(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
      result[key.toLowerCase()] = value;
    });
    return result;
  }
}
