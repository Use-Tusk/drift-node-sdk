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
  apiKey: "test-api-key-multiple-transforms",
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

describe("Multiple Transforms", () => {
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

  it("should apply multiple transforms to the same request", async () => {
    const response = await axios.post(
      `http://127.0.0.1:${servers.mainServerPort}/auth/login`,
      {
        username: "admin@example.com",
        password: "superSecret456",
        apiKey: "secret-key-789",
      },
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

    // Other fields should remain unchanged
    if (inputValue?.body?.username !== "admin@example.com") {
      throw new Error(
        `Expected username to be "admin@example.com", got ${inputValue?.body?.username}`,
      );
    }
    if (inputValue?.body?.apiKey !== "secret-key-789") {
      throw new Error(`Expected apiKey to be "secret-key-789", got ${inputValue?.body?.apiKey}`);
    }
  });
});
