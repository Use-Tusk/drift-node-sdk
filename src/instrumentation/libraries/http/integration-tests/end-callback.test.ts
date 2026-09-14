process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key-end-callback",
  env: "test",
  logLevel: "silent",
});
TuskDrift.markAppAsReady();

import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { waitForSpans } from "./test-utils";
import test from "ava";
import type { Server, RequestOptions } from "http";
import { AddressInfo } from "net";

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

// Require http after TuskDrift.initialize() so the require-in-the-middle hook patches it,
// matching how the SDK is used in an application.
const http: typeof import("http") = require("http");

let server: Server;
let port: number;

function decodeBody(value: unknown): string {
  return Buffer.from(String(value), "base64").toString("utf8");
}

function makeRequest(
  options: RequestOptions,
  body?: string,
  endWithCallback = false,
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode || 0, data }));
    });
    req.on("error", reject);
    if (body) {
      req.write(body);
    }
    if (endWithCallback) {
      // Node's documented signature: request.end([data[, encoding]][, callback])
      req.end(() => {});
    } else {
      req.end();
    }
  });
}

test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/upstream") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ upstreamReceived: body }));
      });
      return;
    }

    if (req.url === "/call-upstream") {
      // Outbound request made inside the inbound span, ended with a callback-only end().
      const postData = JSON.stringify({ hello: "world" });
      try {
        makeRequest(
          {
            hostname: "127.0.0.1",
            port,
            path: "/upstream",
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(postData),
            },
          },
          postData,
          true,
        ).then(
          (upstream) => {
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ upstream: JSON.parse(upstream.data) }));
          },
          (error: Error) => {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: error.message }));
          },
        );
      } catch (error) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: (error as Error).message }));
      }
      return;
    }

    // Inbound handler that writes the body, then ends with a callback-only end().
    res.setHeader("content-type", "application/json");
    res.write(JSON.stringify({ path: req.url }));
    res.end(() => {});
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.after.always(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err?: Error) => (err ? reject(err) : resolve())),
  );
  clearRegisteredInMemoryAdapters();
});

test("inbound: response body is recorded when the handler calls res.end(callback)", async (t) => {
  const response = await makeRequest({
    hostname: "127.0.0.1",
    port,
    path: "/inbound",
    method: "GET",
  });

  t.is(response.statusCode, 200);
  t.deepEqual(JSON.parse(response.data), { path: "/inbound" });

  await waitForSpans();

  const serverSpan = spanAdapter
    .getAllSpans()
    .find(
      (span) => span.kind === SpanKind.SERVER && (span.inputValue as any)?.target === "/inbound",
    );
  t.truthy(serverSpan, "Expected a SERVER span for /inbound");

  const outputValue = serverSpan!.outputValue as any;
  t.truthy(outputValue.body, "Expected the recorded server span to carry the response body");
  t.deepEqual(JSON.parse(decodeBody(outputValue.body)), { path: "/inbound" });
});

test("outbound: req.end(callback) inside a trace does not throw and the request body is recorded", async (t) => {
  const response = await makeRequest({
    hostname: "127.0.0.1",
    port,
    path: "/call-upstream",
    method: "GET",
  });

  t.is(response.statusCode, 200, `Unexpected response: ${response.data}`);
  t.deepEqual(JSON.parse(response.data), {
    upstream: { upstreamReceived: JSON.stringify({ hello: "world" }) },
  });

  await waitForSpans();

  const clientSpan = spanAdapter
    .getAllSpans()
    .find(
      (span) => span.kind === SpanKind.CLIENT && (span.inputValue as any)?.path === "/upstream",
    );
  t.truthy(clientSpan, "Expected a CLIENT span for /upstream");

  const inputValue = clientSpan!.inputValue as any;
  t.truthy(inputValue.body, "Expected the recorded client span to carry the request body");
  t.deepEqual(JSON.parse(decodeBody(inputValue.body)), { hello: "world" });
});
