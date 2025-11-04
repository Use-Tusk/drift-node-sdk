import { SpanInfo } from "../../../core/tracing/SpanUtils";
import { TdMockClientRequest, TdMockClientRequestOptions } from "./mocks/TdMockClientRequest";
import type { RequestOptions } from "http";
import { logger } from "../../../core/utils/logger";

/**
 * HTTP Replay Hooks - Clean separation of replay logic from instrumentation
 */
export class HttpReplayHooks {
  /**
   * Extract trace ID from request headers
   */
  extractTraceIdFromHeaders(req: any): string | null {
    const traceIdHeader = req.headers["x-td-trace-id"] || req.headers["X-TD-TRACE-ID"];
    return traceIdHeader ? String(traceIdHeader) : null;
  }

  extractEnvVarsFromHeaders(req: any): Record<string, string | undefined> | undefined {
    const envVarsHeader = req.headers["x-td-env-vars"] || req.headers["X-TD-ENV-VARS"];
    return envVarsHeader ? JSON.parse(String(envVarsHeader)) : undefined;
  }

  /**
   * Handle outbound HTTP requests in replay mode
   * Uses TdMockClientRequest for simplified mocking approach
   */
  handleOutboundReplayRequest({
    method,
    requestOptions,
    protocol,
    args,
    spanInfo,
    stackTrace,
  }: {
    method: string;
    requestOptions: RequestOptions;
    protocol: "http" | "https";
    args: any[];
    spanInfo?: SpanInfo;
    stackTrace?: string;
  }): TdMockClientRequest | undefined {
    logger.debug(
      `[HttpReplayHooks] Handling outbound ${protocol.toUpperCase()} ${method} request in replay mode`,
    );

    // Extract callback from args if present
    let callback: ((res: any) => void) | undefined;
    if (args.length > 1 && typeof args[1] === "function") {
      callback = args[1];
    } else if (args.length > 2 && typeof args[2] === "function") {
      callback = args[2];
    }

    logger.debug("[HttpReplayHooks] Creating TdMockClientRequest for replay");

    // Prepare options for mock client request
    const mockOptions: TdMockClientRequestOptions = {
      path: requestOptions.path || undefined,
      headers: requestOptions.headers || {},
      timeout: requestOptions.timeout || undefined,
      auth: requestOptions.auth || undefined,
      agent: requestOptions.agent || undefined,
      protocol,
      hostname: requestOptions.hostname || requestOptions.host || undefined,
      port: requestOptions.port ? Number(requestOptions.port) : undefined,
      method,
    };

    // Create and return the mock client request
    const mockRequest = new TdMockClientRequest(mockOptions, spanInfo, callback, stackTrace);

    // For GET/HEAD requests, automatically call .end() to match native http.get() behavior
    // Native http.get() and https.get() are convenience methods that automatically call .end()
    if (method === "GET" || method === "HEAD") {
      // Schedule .end() call after constructor completes
      process.nextTick(() => {
        mockRequest.end();
      });
    }

    return mockRequest;
  }
}
