import { EventEmitter } from "events";
import { IncomingMessage } from "http";
import { TdHttpMockSocket, TdHttpMockSocketOptions } from "./TdHttpMockSocket";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { getDecodedType, httpBodyEncoder, normalizeHeaders } from "../utils";
import { HttpClientInputValue, HttpClientOutputValue } from "../types";
import { TuskDriftCore } from "../../../../core/TuskDrift";
import { createMockInputValue } from "../../../../core/utils";
import { findMockResponseAsync } from "../../../core/utils/mockResponseUtils";
import { SpanKind } from "@opentelemetry/api";

// Lazy-loaded to avoid loading http module at import time
let ClientRequest: any;
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { EncodingType } from "../../../../core/tracing/JsonSchemaHelper";
import { logger } from "../../../../core/utils/logger";

export interface TdMockClientRequestOptions extends TdHttpMockSocketOptions {
  method?: string;
  path?: string;
  headers?: Record<string, any>;
  timeout?: number;
  auth?: string;
  agent?: any;
  protocol?: "http" | "https";
  hostname?: string;
  port?: number;
}

/**
 * Mock ClientRequest implementation for Tusk Drift HTTP replay
 */
export class TdMockClientRequest extends EventEmitter {
  private readonly INSTRUMENTATION_NAME = "HttpInstrumentation";
  public options: TdMockClientRequestOptions;
  public socket: TdHttpMockSocket;
  public connection: TdHttpMockSocket;
  public response: IncomingMessage;
  public res?: IncomingMessage;
  public path?: string;
  public method?: string;
  public finished: boolean = false;
  private tuskDrift: TuskDriftCore;
  private spanInfo?: SpanInfo;
  private stackTrace?: string;

  private requestBodyBuffers: Buffer[] = [];
  private playbackStarted: boolean = false;
  private readyToStartPlaybackOnSocketEvent: boolean = false;
  private headers: Record<string, any> = {};

  constructor(
    options: TdMockClientRequestOptions,
    spanInfo?: SpanInfo,
    callback?: (res: IncomingMessage) => void,
    stackTrace?: string,
  ) {
    super();
    TdMockClientRequest._setupPrototype();
    this.tuskDrift = TuskDriftCore.getInstance();

    this.spanInfo = spanInfo;
    this.stackTrace = stackTrace;

    if (!options || Object.keys(options).length === 0) {
      throw new Error(
        "Making a request with empty `options` is not supported in TdMockClientRequest",
      );
    }

    this.options = {
      ...options,
      headers: normalizeHeaders(options.headers || {}),
    };

    // Set up callback
    if (callback) {
      this.once("response", callback);
    }

    // Create mock socket
    this.socket = new TdHttpMockSocket({
      protocol: options.protocol || "http",
      family: options.family || 4,
      port: options.port || 80,
      hostname: options.hostname || "localhost",
    });

    // Set timeout if specified
    const timeout = options.timeout || options.agent?.options?.timeout;
    if (timeout) {
      this.socket.setTimeout(timeout);
    }

    // Create response object
    this.response = new IncomingMessage(this.socket as any);
    this.connection = this.socket;

    this.attachRequest();

    // Connect socket asynchronously
    process.nextTick(async () => {
      await this.connectSocket();
    });
  }

  private attachRequest(): void {
    const { options } = this;

    // Set headers
    for (const [name, value] of Object.entries(options.headers || {})) {
      // Convert array values to string (take first value if array)
      // const headerValue = Array.isArray(value) ? value[0] : value;
      this.setHeader(name.toLowerCase(), value);
    }

    // Set auth header if provided
    if (options.auth && !options.headers?.authorization) {
      this.setHeader("authorization", `Basic ${Buffer.from(options.auth).toString("base64")}`);
    }

    // Set request properties
    this.path = options.path || "/";
    this.method = options.method || "GET";

    // Handle 100-continue
    if (options.headers?.expect === "100-continue") {
      setImmediate(() => {
        this.emit("continue");
      });
    }
  }

  private async connectSocket(): Promise<void> {
    if (this.isDestroyed()) {
      return;
    }

    this.connection = this.socket;

    // Propagate events
    this.propagateEvents(["error", "timeout"], this.socket, this);

    this.socket.on("close", () => {
      this.socketOnClose();
    });

    this.socket.connecting = false;
    this.emit("socket", this.socket);
    this.socket.emit("connect");

    if (this.socket.authorized) {
      this.socket.emit("secureConnect");
    }

    if (this.readyToStartPlaybackOnSocketEvent) {
      await this.maybeStartPlayback();
    }
  }

  private propagateEvents(events: string[], source: EventEmitter, target: EventEmitter): void {
    for (const event of events) {
      source.on(event, (...args) => target.emit(event, ...args));
    }
  }

  private socketOnClose(): void {
    if (!(this.res || this.socket._hadError)) {
      this.socket._hadError = true;
      const err = new Error("socket hang up") as any;
      err.code = "ECONNRESET";
      this.emit("error", err);
    }
    this.emit("close");
  }

  private async maybeStartPlayback(): Promise<void> {
    if (this.socket.connecting) {
      this.readyToStartPlaybackOnSocketEvent = true;
      return;
    }

    if (!(this.isDestroyed() || this.playbackStarted)) {
      await this.startPlayback();
    }
  }

  private isDestroyed(): boolean {
    return (this as any).destroyed || this.socket.destroyed;
  }

  public write(chunk?: any, encoding?: any, callback?: any): boolean {
    if (this.finished) {
      const err = new Error("write after end") as any;
      err.code = "ERR_STREAM_WRITE_AFTER_END";
      process.nextTick(() => this.emit("error", err));
      return true;
    }

    if (this.socket?.destroyed) {
      return false;
    }

    if (!chunk) {
      return true;
    }

    if (!Buffer.isBuffer(chunk)) {
      chunk = Buffer.from(chunk, encoding);
    }

    this.requestBodyBuffers.push(chunk);

    // Handle callback
    const cb = typeof encoding === "function" ? encoding : callback;
    if (typeof cb === "function") {
      cb();
    }

    setImmediate(() => {
      this.emit("drain");
    });

    return false;
  }

  public end(chunk?: any, encoding?: any, callback?: any): this {
    // Prevent multiple calls to end()
    if (this.finished) {
      return this;
    }

    let cb = callback;
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = null;
    } else if (typeof encoding === "function") {
      cb = encoding;
      encoding = null;
    }

    if (typeof cb === "function") {
      this.once("finish", cb);
    }

    if (chunk) {
      this.write(chunk, encoding);
    }

    this.finished = true;

    process.nextTick(async () => {
      await this.maybeStartPlayback();
    });

    return this;
  }

  public flushHeaders(): void {
    process.nextTick(async () => {
      await this.maybeStartPlayback();
    });
  }

  private async startPlayback(): Promise<void> {
    this.playbackStarted = true;

    try {
      // For background requests (no traceId), skip mock fetching and return 200 OK immediately
      if (!this.spanInfo) {
        logger.debug(
          `[TdMockClientRequest] Background request detected (no spanInfo), returning 200 OK without mock lookup`,
        );

        const emptyResponse: HttpClientOutputValue = {
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
          httpVersion: "1.1",
          httpVersionMajor: 1,
          httpVersionMinor: 1,
          complete: true,
          readable: false,
        };

        this.emit("finish");

        // Play the empty response
        process.nextTick(() => {
          this.playResponse(emptyResponse);
        });
        return;
      }

      // Build input value for matching
      const rawInputValue: HttpClientInputValue = {
        method: this.method || "GET",
        path: this.path,
        headers: this.headers,
        protocol: this.options.protocol || "http",
        hostname: this.options.hostname,
        port: this.options.port || undefined,
        timeout: this.options.timeout || undefined,
      };

      if (this.requestBodyBuffers.length > 0) {
        const bodyBuffer = Buffer.concat(
          this.requestBodyBuffers.map((chunk) =>
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          ),
        );

        const encodedBody = await httpBodyEncoder({
          bodyBuffer,
        });

        rawInputValue.body = encodedBody;
        rawInputValue.bodySize = bodyBuffer.length;
      }

      const inputValue = createMockInputValue(rawInputValue);
      const mockData = await findMockResponseAsync({
        mockRequestData: {
          traceId: this.spanInfo.traceId,
          spanId: this.spanInfo.spanId,
          name:
            rawInputValue.path || `${rawInputValue.protocol.toUpperCase()} ${rawInputValue.method}`,
          packageName: rawInputValue.protocol,
          packageType: PackageType.HTTP,
          instrumentationName: this.INSTRUMENTATION_NAME,
          submoduleName: rawInputValue.method,
          inputValue,
          kind: SpanKind.CLIENT,
          stackTrace: this.stackTrace,
        },
        tuskDrift: this.tuskDrift,
        inputValueSchemaMerges: {
          body: {
            encoding: EncodingType.BASE64,
            decodedType: getDecodedType(
              (rawInputValue.headers["content-type"] as string | string[]) || "",
            ),
          },
          headers: {
            matchImportance: 0,
          },
        },
      });
      if (!mockData) {
        logger.warn(`[TdMockClientRequest] No mock data found for ${this.method} ${this.path}`);
        throw new Error(
          `[TdMockClientRequest] No matching mock found for ${this.method} ${this.path}`,
        );
      }

      this.emit("finish");

      // Play the response
      process.nextTick(() => {
        // This type is used in _handleOutboundRequestInSpan when storing output value while recording
        this.playResponse(mockData.result as HttpClientOutputValue);
      });
    } catch (error) {
      logger.error("[TdMockClientRequest] Error during playback:", error);
      this.emit("error", error);
    }
  }

  private playResponse(mockDataResult: HttpClientOutputValue): void {
    logger.debug(`[TdMockClientRequest] Playing HTTP mock response:`, mockDataResult);
    try {
      // Check if this is an error response that should emit an error event
      if (mockDataResult.errorName) {
        logger.debug(`[TdMockClientRequest] Detected error response, emitting error event`);

        // Create the appropriate error object
        const error = new Error(mockDataResult.errorMessage);

        // For connection errors, emit error immediately
        process.nextTick(() => {
          this.emit("error", error);
        });
        return;
      }

      // Set up response properties
      this.response.statusCode = mockDataResult.statusCode || 200;
      this.response.statusMessage = mockDataResult.statusMessage || "OK";

      // Set headers - normalize to lowercase for consistent handling
      const headers = normalizeHeaders(mockDataResult.headers || {});
      const filteredHeaders = { ...headers };

      // Remove compression headers since we provide uncompressed data
      const compressionHeaders = Object.keys(filteredHeaders).filter((key) =>
        key.toLowerCase().includes("content-encoding"),
      );
      compressionHeaders.forEach((header) => {
        delete filteredHeaders[header];
      });

      this.response.headers = filteredHeaders;
      this.response.rawHeaders = [];

      // Convert headers to rawHeaders format
      for (const [key, value] of Object.entries(filteredHeaders)) {
        this.response.rawHeaders.push(key, String(value));
      }

      // Set HTTP version properties
      this.response.httpVersion = mockDataResult.httpVersion || "1.1";
      this.response.httpVersionMajor = mockDataResult.httpVersionMajor || 1;
      this.response.httpVersionMinor = mockDataResult.httpVersionMinor || 1;
      this.response.complete = false;
      this.response.readable = true;

      // Set up response methods
      (this.response as any).getHeader = (name: string) => {
        return this.response.headers?.[name.toLowerCase()];
      };

      (this.response as any).getHeaders = () => {
        return this.response.headers || {};
      };

      (this.response as any).hasHeader = (name: string) => {
        return Boolean(this.response.headers?.[name.toLowerCase()]);
      };

      this.res = this.response;
      (this.response as any).req = this;

      // Emit response event
      this.emit("response", this.response);

      // Handle response body
      process.nextTick(async () => {
        await this.emitResponseBody(mockDataResult);
      });
    } catch (error) {
      logger.error("[TdMockClientRequest] Error playing response:", error);
      this.emit("error", error);
    }
  }

  private async emitResponseBody(outputValue: HttpClientOutputValue): Promise<void> {
    if (!outputValue.body) {
      // No body data
      this.response.push(null);
      this.response.complete = true;
      this.response.readable = false;
      return;
    }

    try {
      const bodyBuffer = Buffer.from(outputValue.body, "base64");

      // Push data to response stream
      this.response.push(bodyBuffer);
    } catch (error) {
      logger.error("[TdMockClientRequest] Error processing response body:", error);
      this.response.push(null);
    }

    // Signal end of response
    this.response.push(null);
    this.response.complete = true;
    this.response.readable = false;
  }

  public setHeader(name: string, value: any): void {
    this.headers[name.toLowerCase()] = value;
  }

  public getHeader(name: string): any {
    return this.headers[name.toLowerCase()];
  }

  public removeHeader(name: string): void {
    delete this.headers[name.toLowerCase()];
  }

  public getHeaders(): Record<string, any> {
    return { ...this.headers };
  }

  public abort(): void {
    logger.debug("[TdMockClientRequest] Request aborted");
    this.emit("abort");
    this.socket.destroy();
  }

  public setTimeout(timeout: number, callback?: () => void): this {
    if (callback) {
      this.once("timeout", callback);
    }
    return this;
  }

  public destroy(error?: Error): this {
    logger.debug("[TdMockClientRequest] Request destroyed", error);
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
    this.socket.destroy();
    return this;
  }

  // Set up prototype chain to extend ClientRequest
  private static _setupPrototype() {
    if (!ClientRequest) {
      ClientRequest = require("http").ClientRequest;
      Object.setPrototypeOf(TdMockClientRequest.prototype, ClientRequest.prototype);
    }
  }

  // Call this before creating instances
  static initialize() {
    TdMockClientRequest._setupPrototype();
  }
}
