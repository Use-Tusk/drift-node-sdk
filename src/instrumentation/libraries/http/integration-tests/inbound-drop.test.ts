process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "inbound",
        pathPattern: "/admin/.*",
        fullBody: true,
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

test("should not create any span when inbound request is dropped", async (t) => {
  const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${servers.mainServerPort}/admin/users`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({ statusCode: res.statusCode || 0, data: JSON.parse(data) });
      });
    });
    req.on("error", reject);
  });

  t.is(response.statusCode, 200);
  t.truthy(Array.isArray(response.data.users), "Expected users array");
  t.is(response.data.users.length, 1, "Expected users array with 1 element");

  await waitForSpans();

  const allSpans = spanAdapter.getAllSpans();

  // Should NOT have any server span for /admin/users
  const adminSpans = allSpans.filter((span) => {
    const inputValue = span.inputValue as any;
    const url = inputValue?.url || inputValue?.target;
    return url && url.includes("/admin/users");
  });

  t.is(adminSpans.length, 0, `Expected 0 admin spans, got ${adminSpans.length}`);
});
