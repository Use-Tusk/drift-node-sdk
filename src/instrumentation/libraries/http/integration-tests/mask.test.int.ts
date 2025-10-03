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

import axios from "axios";
import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

describe("Mask Transform", () => {
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

  it("should mask API key in outbound request headers", async () => {
    const response = await axios.get(`http://127.0.0.1:${servers.mainServerPort}/call-service-b`, {
      proxy: false,
    });

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const outboundToB = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const path = inputValue?.path;
      return path && path.includes("/api/public") && span.kind === SpanKind.CLIENT;
    });

    if (!outboundToB) {
      throw new Error("Outbound span to service B not captured");
    }

    const inputValue = outboundToB.inputValue as any;
    // API key should be masked
    const apiKey = inputValue?.headers?.["X-API-Key"] || inputValue?.headers?.["x-api-key"];

    if (!apiKey) {
      throw new Error("API key not found in headers");
    }

    if (!/^\*+$/.test(apiKey)) {
      throw new Error(`Expected API key to be masked with asterisks, got ${apiKey}`);
    }
    if (apiKey.length === 0) {
      throw new Error("Expected masked API key to have length > 0");
    }
  });
});
