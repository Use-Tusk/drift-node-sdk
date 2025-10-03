process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

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

import axios from "axios";
import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

describe("Replace Transform", () => {
  let spanAdapter: InMemorySpanAdapter;
  let servers: TestServers;

  beforeAll(async () => {
    servers = await setupTestServers();
    spanAdapter = new InMemorySpanAdapter();
    registerInMemoryAdapter(spanAdapter);
  });

  afterAll(async () => {
    await cleanupServers(servers);
    clearRegisteredInMemoryAdapters();
  });

  it("should replace sensitive data in response body", async () => {
    const response = await axios.get(
      `http://127.0.0.1:${servers.mainServerPort}/call-service-a-public`,
      {
        proxy: false,
      },
    );

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const outboundToA = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const path = inputValue?.path;
      return path && path.includes("/api/data") && span.kind === SpanKind.CLIENT;
    });

    if (!outboundToA) {
      throw new Error("Outbound span to service A /api/data not captured");
    }

    // Response body should have replaced value (it's base64 encoded)
    const outputValue = outboundToA.outputValue as any;
    if (!outputValue?.body) {
      throw new Error("Expected outputValue.body to be present");
    }

    const decodedBody = Buffer.from(outputValue.body, "base64").toString("utf8");
    const parsedBody = JSON.parse(decodedBody);
    if (parsedBody.data !== "[REDACTED]") {
      throw new Error(`Expected data to be "[REDACTED]", got ${parsedBody.data}`);
    }

    // Should have transform metadata
    const hasReplaceAction = outboundToA.transformMetadata?.actions?.some(
      (action) => action.type === "replace" && action.field === "jsonPath:$.data",
    );
    if (!hasReplaceAction) {
      throw new Error(
        `Expected replace action in transformMetadata, got ${JSON.stringify(outboundToA.transformMetadata?.actions)}`,
      );
    }
  });
});
