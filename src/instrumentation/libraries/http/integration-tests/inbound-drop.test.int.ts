process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "inbound",
        pathPattern: "/admin/.*",
        fullBody: "",
      },
      action: { type: "drop" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-inbound-drop",
  env: "test",
  logLevel: "silent",
  transforms,
});
TuskDrift.markAppAsReady();

import axios from "axios";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";

describe("Inbound Drop Transform", () => {
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

  it("should not create any span when inbound request is dropped", async () => {
    const response = await axios.get(`http://127.0.0.1:${servers.mainServerPort}/admin/users`, {
      proxy: false,
    });

    if (response.status !== 200) {
      throw new Error(`Expected status 200, got ${response.status}`);
    }
    if (!Array.isArray(response.data.users) || response.data.users.length !== 1) {
      throw new Error("Expected users array with 1 element");
    }

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();

    // Should NOT have any server span for /admin/users
    const adminSpans = allSpans.filter((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.url || inputValue?.target;
      return url && url.includes("/admin/users");
    });

    if (adminSpans.length !== 0) {
      throw new Error(`Expected 0 admin spans, got ${adminSpans.length}`);
    }
  });
});
