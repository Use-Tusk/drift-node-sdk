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

import axios from "axios";
import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

describe("No Transform Applied", () => {
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

  it("should not transform requests that don't match any rules", async () => {
    const response = await axios.get(`http://127.0.0.1:${servers.mainServerPort}/call-service-b`, {
      proxy: false,
      headers: { "X-Custom-Header": "some-value" },
    });

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const mainServerSpan = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.url || inputValue?.target;
      return url && url.includes("/call-service-b") && span.kind === SpanKind.SERVER;
    });

    if (!mainServerSpan) {
      throw new Error("Main server span not captured");
    }

    // Should not have any transform metadata for this span
    if (mainServerSpan.transformMetadata !== undefined) {
      throw new Error(
        `Expected transformMetadata to be undefined, got ${JSON.stringify(mainServerSpan.transformMetadata)}`,
      );
    }
  });
});
