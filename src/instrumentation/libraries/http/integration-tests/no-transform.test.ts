process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

const transforms: TransformConfigs = {
  http: [],
};

TuskDrift.initialize({
  apiKey: "test-api-key-no-transform",
  env: "test",
  logLevel: "silent",
  transforms,
});
TuskDrift.markAppAsReady();

import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";
import test from 'ava';
 

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

// Import http at runtime to ensure TuskDrift patches are applied first
const http = require("http");


  let servers: TestServers;

test.before(async () => {
    servers = await setupTestServers();
  });

test.after.always(async () => {
    await cleanupServers(servers);
    clearRegisteredInMemoryAdapters();
  });

test("should not transform requests that don't match any rules", async (t) => {
    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const options = {
        hostname: "127.0.0.1",
        port: servers.mainServerPort,
        path: "/call-service-b",
        method: "GET",
        headers: { "X-Custom-Header": "some-value" },
      };

      const req = http.request(options, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0 });
        });
      });

      req.on("error", reject);
      req.end();
    });

    t.is(response.statusCode, 200);

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const mainServerSpan = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.url || inputValue?.target;
      return url && url.includes("/call-service-b") && span.kind === SpanKind.SERVER;
    });

    t.truthy(mainServerSpan, "Main server span not captured");

    // Should not have any transform metadata for this span
    t.is(
      mainServerSpan!.transformMetadata,
      undefined,
      `Expected transformMetadata to be undefined, got ${JSON.stringify(mainServerSpan!.transformMetadata)}`,
    );
  });
