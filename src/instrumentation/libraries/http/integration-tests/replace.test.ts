process.env.TUSK_DRIFT_MODE = "RECORD";

import test from "ava";
import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "outbound",
        pathPattern: "/api/data",
        jsonPath: "$.data",
      },
      action: { type: "replace", replaceWith: "[REDACTED]" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-replace",
  env: "test",
  logLevel: "silent",
  transforms,
});
TuskDrift.markAppAsReady();

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);
import { SpanKind } from "@opentelemetry/api";
import http from "http";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

let servers: TestServers;

test.before(async () => {
  servers = await setupTestServers();
});

test.after.always(async () => {
  await cleanupServers(servers);
  clearRegisteredInMemoryAdapters();
});

test("should replace sensitive data in response body", async (t) => {
  const response = await new Promise<{ statusCode: number; data: string }>((resolve, reject) => {
    const req = http.get(
      `http://127.0.0.1:${servers.mainServerPort}/call-service-a-public`,
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          resolve({ statusCode: res.statusCode || 0, data });
        });
      },
    );
    req.on("error", reject);
  });

  t.is(response.statusCode, 200);

  await waitForSpans();

  const allSpans = spanAdapter.getAllSpans();
  const outboundToA = allSpans.find((span) => {
    const inputValue = span.inputValue as any;
    const path = inputValue?.path;
    return path && path.includes("/api/data") && span.kind === SpanKind.CLIENT;
  });

  t.truthy(outboundToA, "Outbound span to service A /api/data not captured");

  const outputValue = outboundToA!.outputValue as any;
  t.truthy(outputValue?.body, "Expected outputValue.body to be present");

  const decodedBody = Buffer.from(outputValue.body, "base64").toString("utf8");
  const parsedBody = JSON.parse(decodedBody);
  t.is(parsedBody.data, "[REDACTED]");

  const hasReplaceAction = outboundToA!.transformMetadata?.actions?.some(
    (action) => action.type === "replace" && action.field === "jsonPath:$.data",
  );
  t.truthy(hasReplaceAction, "Expected replace action in transformMetadata");
});
