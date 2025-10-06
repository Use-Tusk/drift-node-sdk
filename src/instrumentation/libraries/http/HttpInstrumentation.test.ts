import test from "ava";
import * as http from "http";
import { AddressInfo } from "net";
import { SpanUtilsErrorTesting, ErrorType } from "../../../test-utils/spanUtilsErrorTesting";
import { HttpInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";

// Helper types for server configuration
interface ServerConfig {
  statusCode?: number;
  contentType?: string;
  responseBody?: string | object;
  handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void;
}

interface RequestConfig {
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string | object;
}

// Helper function to create a test server and make a request
async function createServerAndMakeRequest(
  serverConfig: ServerConfig,
  requestConfig: RequestConfig = {},
): Promise<{ responseData: string; statusCode: number }> {
  return new Promise((resolve, reject) => {
    const {
      statusCode = 200,
      contentType = "text/plain",
      responseBody = "Hello World",
      handler,
    } = serverConfig;

    const { path = "/", method = "GET", headers = {}, body } = requestConfig;

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

    server.listen(0, () => {
      const port = (server.address() as AddressInfo).port;

      const req = http.request(
        {
          hostname: "localhost",
          port: port,
          path: path,
          method: method,
          headers: headers,
        },
        (res) => {
          let responseData = "";
          res.on("data", (chunk) => {
            responseData += chunk;
          });

          res.on("end", () => {
            server.close();
            resolve({
              responseData,
              statusCode: res.statusCode || 0,
            });
          });
        },
      );

      req.on("error", (error) => {
        server.close();
        reject(error);
      });

      if (body) {
        if (typeof body === "object") {
          req.write(JSON.stringify(body));
        } else {
          req.write(body);
        }
      }

      req.end();
    });
  });
}

let httpInstrumentation: HttpInstrumentation;

test.beforeEach(() => {
  httpInstrumentation = new HttpInstrumentation({
    mode: TuskDriftMode.RECORD,
  });

  const modules = httpInstrumentation.init();

  const http = require("http");
  const https = require("https");

  modules.forEach((module) => {
    if (module.name === "http" && module.patch) {
      module.patch(http);
    } else if (module.name === "https" && module.patch) {
      module.patch(https);
    }
  });
});

test.afterEach(() => {
  SpanUtilsErrorTesting.teardownErrorResilienceTest();
});

// Client Request Error Resilience
test("should complete HTTP requests when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.setStatus throws", async (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});

test("should complete HTTP requests when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const { responseData, statusCode } = await createServerAndMakeRequest(
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

  t.is(statusCode, 200);
  const parsedData = JSON.parse(responseData);
  t.is(parsedData.status, "success");
});
