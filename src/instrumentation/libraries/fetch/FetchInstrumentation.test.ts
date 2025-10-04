import * as http from "http";
import { AddressInfo } from "net";
import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
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

    server.listen(0, "127.0.0.1", async () => {
      const port = (server.address() as AddressInfo).port;
      const url = `http://127.0.0.1:${port}${path}`;

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

async function withLocalServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void | Promise<void>,
  testFn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).catch((error) => {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address() as AddressInfo;

  try {
    await testFn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

describe("Fetch Instrumentation", () => {
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
      enabled: true,
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

  describe("basic fetch behavior", () => {
    it("should perform GET requests successfully", async () => {
      await withLocalServer(
        async (req, res) => {
          expect(req.method).toBe("GET");
          expect(req.url).toBe("/test-fetch");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "ok" }));
        },
        async (baseUrl) => {
          const response = await globalThis.fetch(`${baseUrl}/test-fetch`);
          expect(response.status).toBe(200);
          const data = await response.json();
          expect(data).toEqual({ message: "ok" });
        },
      );
    });

    it("should send POST bodies and receive JSON responses", async () => {
      const payload = { title: "Test Post", body: "Payload", userId: 42 };

      await withLocalServer(
        async (req, res) => {
          expect(req.method).toBe("POST");
          const body = await readJsonBody(req);
          expect(body).toEqual(payload);
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              received: true,
              contentLength: JSON.stringify(body).length,
            }),
          );
        },
        async (baseUrl) => {
          const response = await globalThis.fetch(`${baseUrl}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          expect(response.status).toBe(201);
          const data = await response.json();
          expect(data.received).toBe(true);
          expect(data.contentLength).toBe(JSON.stringify(payload).length);
        },
      );
    });

    it("should forward custom request headers", async () => {
      await withLocalServer(
        async (req, res) => {
          expect(req.headers["x-custom-header"]).toBe("test-value");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        },
        async (baseUrl) => {
          const response = await globalThis.fetch(`${baseUrl}/headers`, {
            headers: {
              "X-Custom-Header": "test-value",
            },
          });

          expect(response.ok).toBe(true);
          const data = await response.json();
          expect(data.ok).toBe(true);
        },
      );
    });

    it("should handle JSON responses correctly", async () => {
      const items = [
        { id: 1, name: "Item 1" },
        { id: 2, name: "Item 2" },
        { id: 3, name: "Item 3" },
      ];

      await withLocalServer(
        async (_req, res) => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(items));
        },
        async (baseUrl) => {
          const response = await globalThis.fetch(`${baseUrl}/items`);
          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toContain("application/json");
          const data = await response.json();
          expect(data).toEqual(items);
        },
      );
    });

    it("should support URL objects as fetch input", async () => {
      await withLocalServer(
        async (req, res) => {
          expect(req.url).toBe("/query?limit=5");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ query: req.url }));
        },
        async (baseUrl) => {
          const url = new URL("/query", baseUrl);
          url.searchParams.set("limit", "5");

          const response = await globalThis.fetch(url);
          expect(response.ok).toBe(true);
          const data = await response.json();
          expect(data.query).toBe("/query?limit=5");
        },
      );
    });
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
