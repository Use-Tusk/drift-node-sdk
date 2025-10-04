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

import axios from "axios";
import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

describe("Outbound Drop Transform", () => {
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

  it("should drop outbound span data but keep span present when calling dropped service", async () => {
    const response = await axios.post(
      `http://127.0.0.1:${servers.mainServerPort}/call-service-a-sensitive`,
      { userId: 123 },
      { proxy: false },
    );

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }
    if (response.data.upstream.status !== "success") {
      throw new Error(`Expected upstream status "success", got ${response.data.upstream.status}`);
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();

    const outboundSpans = allSpans.filter(
      (span) => span.kind === SpanKind.CLIENT && span.instrumentationName === "HttpInstrumentation",
    );

    if (outboundSpans.length === 0) {
      throw new Error("Outbound spans not captured in test environment");
    }

    const droppedSpan = outboundSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.path || inputValue?.url;
      return url && url.includes("/api/sensitive");
    });

    if (!droppedSpan) {
      throw new Error("Could not find outbound span to /api/sensitive");
    }

    // Span should exist but with empty input/output values
    if (JSON.stringify(droppedSpan.inputValue) !== "{}") {
      throw new Error(`Expected empty inputValue, got ${JSON.stringify(droppedSpan.inputValue)}`);
    }
    if (JSON.stringify(droppedSpan.outputValue) !== "{}") {
      throw new Error(`Expected empty outputValue, got ${JSON.stringify(droppedSpan.outputValue)}`);
    }

    // Should have transformMetadata indicating it was dropped
    if (!droppedSpan.transformMetadata) {
      throw new Error("Expected transformMetadata to be defined");
    }
    const hasDropAction = droppedSpan.transformMetadata.actions?.some(
      (action) => action.type === "drop" && action.field === "entire_span",
    );
    if (!hasDropAction) {
      throw new Error(
        `Expected drop action in transformMetadata, got ${JSON.stringify(droppedSpan.transformMetadata.actions)}`,
      );
    }
  });
});
