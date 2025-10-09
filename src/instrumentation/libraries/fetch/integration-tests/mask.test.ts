process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";

const transforms: TransformConfigs = {
  fetch: [
    {
      matcher: {
        headerName: "Authorization",
      },
      action: { type: "mask", maskChar: "*" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-fetch-mask",
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
import test from "ava";
import http from "http";

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

let servers: TestServers;

test.before(async () => {
  servers = await setupTestServers();
});

test.after.always(async () => {
  await cleanupServers(servers);
  clearRegisteredInMemoryAdapters();
});

test("should mask Authorization header in request", async (t) => {
  const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: servers.mainServerPort,
      path: "/echo",
      method: "POST",
      headers: {
        "Authorization": "Bearer secret-token-123",
        "Content-Type": "application/json",
        "Content-Length": "2",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode || 0, data: JSON.parse(data) });
      });
    });

    req.on("error", reject);
    req.write("{}");
    req.end();
  });

  t.is(response.statusCode, 200);

  await waitForSpans();

  const allSpans = spanAdapter.getAllSpans();
  const fetchSpan = allSpans.find((span) => {
    const inputValue = span.inputValue as any;
    const url = inputValue?.url;
    return url && url.includes("/echo-internal") && span.kind === SpanKind.CLIENT;
  });

  t.truthy(fetchSpan, "Fetch span not captured");

  // Check that Authorization header is masked
  const inputValue = fetchSpan!.inputValue as any;
  const authHeader = inputValue.headers?.authorization;

  t.truthy(authHeader, "Authorization header not found");

  // Should be all asterisks
  const maskPattern = /^\*+$/;
  t.truthy(
    maskPattern.test(authHeader),
    `Expected Authorization header to be masked with asterisks, got ${authHeader}`,
  );

  // Length should match original
  t.is(authHeader.length, "Bearer secret-token-123".length, "Masked length should match original");

  // Should have transform metadata
  const actions = fetchSpan!.transformMetadata?.actions || [];
  t.is(actions.length, 1, `Expected 1 transform action, got ${actions.length}`);

  const hasMaskAction = actions.some(
    (action) => action.type === "mask" && action.field === "header:Authorization",
  );
  t.truthy(hasMaskAction, "Expected mask action for Authorization header");
});
