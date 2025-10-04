process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "inbound",
        jsonPath: "$.password",
      },
      action: { type: "redact", hashPrefix: "PWD_" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-redact",
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

describe("Redact Transform", () => {
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

  it("should redact password field in request body", async () => {
    const response = await axios.post(
      `http://127.0.0.1:${servers.mainServerPort}/auth/login`,
      { username: "user@example.com", password: "secretPassword123" },
      { proxy: false },
    );

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const loginSpan = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.url || inputValue?.target;
      return url && url.includes("/auth/login") && span.kind === SpanKind.SERVER;
    });

    if (!loginSpan) {
      throw new Error("Login span not captured");
    }

    // Password should be redacted
    const passwordPattern = /^PWD_[0-9a-f]{12}\.\.\.$/;
    const inputValue = loginSpan.inputValue as any;
    if (!passwordPattern.test(inputValue?.body?.password)) {
      throw new Error(
        `Expected password to match pattern ${passwordPattern}, got ${inputValue?.body?.password}`,
      );
    }
    if (inputValue?.body?.username !== "user@example.com") {
      throw new Error(
        `Expected username to be "user@example.com", got ${inputValue?.body?.username}`,
      );
    }

    // Should have transform metadata
    const hasRedactAction = loginSpan.transformMetadata?.actions?.some(
      (action) => action.type === "redact" && action.field === "jsonPath:$.password",
    );
    if (!hasRedactAction) {
      throw new Error(
        `Expected redact action in transformMetadata, got ${JSON.stringify(loginSpan.transformMetadata?.actions)}`,
      );
    }
  });
});
