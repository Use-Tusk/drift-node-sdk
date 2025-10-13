process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";

const transforms: TransformConfigs = {
  fetch: [
    {
      matcher: {
        jsonPath: "$.password",
      },
      action: { type: "redact", hashPrefix: "PWD_" },
    },
    {
      matcher: {
        jsonPath: "$.apiKey",
      },
      action: { type: "mask", maskChar: "*" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-fetch-multiple-transforms",
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

test("should apply multiple transforms to the same request", async (t) => {
  const postData = JSON.stringify({
    username: "admin@example.com",
    password: "superSecret456",
    apiKey: "secret-key-789",
  });

  const response = await new Promise<{ statusCode: number; data: any }>((resolve, reject) => {
    const options = {
      hostname: "127.0.0.1",
      port: servers.mainServerPort,
      path: "/echo",
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

  await waitForSpans();

  const allSpans = spanAdapter.getAllSpans();
  const fetchSpan = allSpans.find((span) => {
    const inputValue = span.inputValue as any;
    const url = inputValue?.url;
    return url && url.includes("/echo-internal") && span.kind === SpanKind.CLIENT;
  });

  t.truthy(fetchSpan, "Fetch span not captured");

  // Body is base64 encoded, decode and parse it
  const inputValue = fetchSpan!.inputValue as any;
  const decodedBody = Buffer.from(inputValue.body, "base64").toString("utf-8");
  const parsedBody = JSON.parse(decodedBody);

  // Password should be redacted
  const passwordPattern = /^PWD_[0-9a-f]{12}\.\.\.$/;
  t.truthy(
    passwordPattern.test(parsedBody.password),
    `Expected password to match pattern ${passwordPattern}, got ${parsedBody.password}`,
  );

  // API key should be masked
  const maskPattern = /^\*+$/;
  t.truthy(
    maskPattern.test(parsedBody.apiKey),
    `Expected apiKey to be masked with asterisks, got ${parsedBody.apiKey}`,
  );

  // Username should remain unchanged
  t.is(
    parsedBody.username,
    "admin@example.com",
    `Expected username to be "admin@example.com", got ${parsedBody.username}`,
  );

  // Should have both transform actions in metadata
  const actions = fetchSpan!.transformMetadata?.actions || [];
  t.is(actions.length, 2, `Expected 2 transform actions, got ${actions.length}`);

  const hasRedactAction = actions.some(
    (action) => action.type === "redact" && action.field === "jsonPath:$.password",
  );
  const hasMaskAction = actions.some(
    (action) => action.type === "mask" && action.field === "jsonPath:$.apiKey",
  );

  t.truthy(hasRedactAction, "Expected redact action for password");
  t.truthy(hasMaskAction, "Expected mask action for apiKey");
});
