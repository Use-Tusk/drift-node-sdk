process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "outbound",
        host: "127\\.0\\.0\\.1",
        pathPattern: "/api/sensitive",
        fullBody: "",
      },
      action: { type: "drop" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-outbound-drop",
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

test("should drop outbound span data but keep span present when calling dropped service", async (t) => {
  const postData = JSON.stringify({ userId: 123 });

  const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: servers.mainServerPort,
      path: "/call-service-a-sensitive",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
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
    req.write(postData);
    req.end();
  });

  t.is(response.statusCode, 200);
  t.is(response.data.upstream.status, "success");

  await waitForSpans();

  const allSpans = spanAdapter.getAllSpans();

  const outboundSpans = allSpans.filter(
    (span) => span.kind === SpanKind.CLIENT && span.instrumentationName === "HttpInstrumentation",
  );

  t.truthy(outboundSpans.length > 0, "Outbound spans not captured in test environment");

  // Since the span is dropped, we can't identify it by path (which is dropped)
  // Instead, look for a span with empty inputValue and transformMetadata indicating drop
  const droppedSpan = outboundSpans.find((span) => {
    const hasEmptyInput = JSON.stringify(span.inputValue) === "{}";
    const hasDropAction = span.transformMetadata?.actions?.some((action) => action.type === "drop");
    return hasEmptyInput && hasDropAction;
  });

  t.truthy(droppedSpan, "Could not find dropped outbound span");

  // Span should exist but with empty input/output values
  t.is(
    JSON.stringify(droppedSpan!.inputValue),
    "{}",
    `Expected empty inputValue, got ${JSON.stringify(droppedSpan!.inputValue)}`,
  );
  t.is(
    JSON.stringify(droppedSpan!.outputValue),
    "{}",
    `Expected empty outputValue, got ${JSON.stringify(droppedSpan!.outputValue)}`,
  );

  // Should have transformMetadata indicating it was dropped
  t.truthy(droppedSpan!.transformMetadata, "Expected transformMetadata to be defined");
  const hasDropAction = droppedSpan!.transformMetadata?.actions?.some(
    (action) => action.type === "drop" && action.field === "entire_span",
  );
  t.truthy(
    hasDropAction,
    `Expected drop action in transformMetadata, got ${JSON.stringify(droppedSpan!.transformMetadata?.actions)}`,
  );
});
