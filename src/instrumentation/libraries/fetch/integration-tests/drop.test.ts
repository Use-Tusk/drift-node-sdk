process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";

const transforms: TransformConfigs = {
  fetch: [
    {
      matcher: {
        direction: "outbound",
        pathPattern: "/api/sensitive",
        fullBody: true,
      },
      action: { type: "drop" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-fetch-drop",
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

test("should drop fetch span data but keep span present when calling dropped endpoint", async (t) => {
  const postData = JSON.stringify({ userId: 123 });

  const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: servers.mainServerPort,
      path: "/call-sensitive",
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

  const fetchSpans = allSpans.filter(
    (span) => span.kind === SpanKind.CLIENT && span.instrumentationName === "FetchInstrumentation",
  );

  t.truthy(fetchSpans.length > 0, "Fetch spans not captured in test environment");

  // Find dropped span by checking for drop action in transform metadata
  const droppedSpan = fetchSpans.find((span) => {
    const hasDropAction = span.transformMetadata?.actions?.some((action) => action.type === "drop");
    return hasDropAction;
  });

  t.truthy(droppedSpan, "Could not find dropped fetch span");

  // Span should exist but with empty/cleared input/output values
  const inputValue = droppedSpan!.inputValue as any;
  t.is(inputValue.url, "", "Expected url to be empty string");
  t.is(inputValue.method, "", "Expected method to be empty string");
  t.deepEqual(inputValue.headers, {}, "Expected headers to be empty object");
  t.is(inputValue.body, undefined, "Expected body to be undefined");

  const outputValue = droppedSpan!.outputValue as any;
  t.is(outputValue.status, 0, "Expected status to be 0");
  t.is(outputValue.statusText, "", "Expected statusText to be empty string");
  t.deepEqual(outputValue.headers, {}, "Expected headers to be empty object");
  t.is(outputValue.body, undefined, "Expected body to be undefined");

  // Should have transformMetadata indicating it was dropped
  t.truthy(droppedSpan!.transformMetadata, "Expected transformMetadata to be defined");
  const hasDropAction = droppedSpan!.transformMetadata.actions?.some(
    (action) => action.type === "drop" && action.field === "entire_span",
  );
  t.truthy(
    hasDropAction,
    `Expected drop action in transformMetadata, got ${JSON.stringify(droppedSpan!.transformMetadata.actions)}`,
  );
});
