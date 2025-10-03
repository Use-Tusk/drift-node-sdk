import * as http from "http";
import { AddressInfo } from "net";
import { SpanUtilsErrorTesting, ErrorType } from "../../../test-utils/spanUtilsErrorTesting";
import { FetchInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";

// Helper types for server configuration
interface ServerConfig {
  statusCode?: number;
  contentType?: string;
  responseBody?: string | object;
  handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

interface FetchConfig {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | object;
}

// Helper function to create a test server and make a fetch request
// This function uses the global fetch (which will be the instrumented version) to test resilience
async function createServerAndMakeFetchRequest(
  serverConfig: ServerConfig,
  fetchConfig: FetchConfig = {},
): Promise<{ responseData: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const {
      statusCode = 200,
      contentType = "text/plain",
      responseBody = "Hello World",
      handler,
    } = serverConfig;

    const { path = "/", method = "GET", headers = {}, body } = fetchConfig;

    const server = http.createServer((req, res) => {
      if (handler) {
        handler(req, res);
      } else {
        res.writeHead(statusCode, { "Content-Type": contentType });
        if (typeof responseBody === "object") {
          res.end(JSON.stringify(responseBody));
        } else {
          res.end(responseBody);
        }
      }
    });

    server.listen(0, async () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://localhost:${port}${path}`;

      try {
        const fetchOptions: RequestInit = {
          method,
          headers,
        };

        if (body) {
          if (typeof body === "object") {
            fetchOptions.body = JSON.stringify(body);
          } else {
            fetchOptions.body = body;
          }
        }

        // Use the instrumented fetch (globalThis.fetch) to test error resilience
        const response = await globalThis.fetch(url, fetchOptions);
        const responseData = await response.text();

        server.close();
        resolve({
          responseData,
          statusCode: response.status,
        });
      } catch (error) {
        server.close();
        reject(error);
      }
    });
  });
}

describe("Fetch Instrumentation Error Resilience", () => {
  let fetchInstrumentation: FetchInstrumentation;
  let originalFetch: typeof globalThis.fetch;

  beforeAll(() => {
    // Store original fetch before any patches - do this once for all tests
    originalFetch = globalThis.fetch;
  });

  beforeEach(() => {
    // Ensure we start with clean fetch
    globalThis.fetch = originalFetch;

    fetchInstrumentation = new FetchInstrumentation({
      mode: TuskDriftMode.RECORD,
    });

    // Initialize instrumentation which patches global fetch
    fetchInstrumentation.init();

    // Manually fix the originalFetch reference to point to the true original
    (fetchInstrumentation as any).originalFetch = originalFetch;
  });

  afterEach(() => {
    SpanUtilsErrorTesting.teardownErrorResilienceTest();
    // Restore original fetch
    globalThis.fetch = originalFetch;
  });

  describe("Fetch Request Error Resilience", () => {
    it("should complete fetch requests when SpanUtils.createSpan throws", async () => {
      SpanUtilsErrorTesting.mockCreateSpanWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span create span network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.addSpanAttributes throws", async () => {
      SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span attributes network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.setStatus throws", async () => {
      SpanUtilsErrorTesting.mockSetStatusWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set status network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.endSpan throws", async () => {
      SpanUtilsErrorTesting.mockEndSpanWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span end span network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.getCurrentSpanInfo throws", async () => {
      SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current span info network error",
        shouldReturnNull: true,
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.getCurrentTraceId throws", async () => {
      SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current trace id network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });

    it("should complete fetch requests when SpanUtils.setCurrentReplayTraceId throws", async () => {
      SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set current replay trace id network error",
      });

      const { responseData, statusCode } = await createServerAndMakeFetchRequest(
        {
          contentType: "application/json",
          responseBody: { status: "success" },
        },
        {
          path: "/api/test",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: { test: "data" },
        },
      );

      expect(statusCode).toBe(200);
      const parsedData = JSON.parse(responseData);
      expect(parsedData.status).toBe("success");
    });
  });
});
