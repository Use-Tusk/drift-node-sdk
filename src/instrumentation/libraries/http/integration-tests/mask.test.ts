process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "outbound",
        headerName: "X-API-Key",
      },
      action: { type: "mask", maskChar: "*" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-mask",
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

const http = require("http");


  let servers: TestServers;

test.before(async () => {
    servers = await setupTestServers();
  });

test.after.always(async () => {
    await cleanupServers(servers);
    clearRegisteredInMemoryAdapters();
  });

test("should mask API key in outbound request headers", async (t) => {
    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${servers.mainServerPort}/call-service-b`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0 });
        });
      });
      req.on("error", reject);
    });

    t.is(response.statusCode, 200);

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const outboundToB = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const path = inputValue?.path;
      return path && path.includes("/api/public") && span.kind === SpanKind.CLIENT;
    });

    t.truthy(outboundToB, "Outbound span to service B not captured");

    const inputValue = outboundToB!.inputValue as any;
    // API key should be masked
    const apiKey = inputValue?.headers?.["X-API-Key"] || inputValue?.headers?.["x-api-key"];

    t.truthy(apiKey, "API key not found in headers");
    t.truthy(/^\*+$/.test(apiKey), `Expected API key to be masked with asterisks, got ${apiKey}`);
    t.truthy(apiKey.length > 0, "Expected masked API key to have length > 0");
  });
