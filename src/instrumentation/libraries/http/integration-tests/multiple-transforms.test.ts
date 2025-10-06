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

import { SpanKind } from "@opentelemetry/api";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { setupTestServers, cleanupServers, waitForSpans, TestServers } from "./test-utils";
import test from 'ava';
 

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

// Import http at runtime to ensure TuskDrift patches are applied first
const http = require("http");


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

    const response = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const options = {
        hostname: "127.0.0.1",
        port: servers.mainServerPort,
        path: "/auth/login",
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
          resolve({ statusCode: res.statusCode || 0 });
        });
      });

      req.on("error", reject);
      req.write(postData);
      req.end();
    });

    t.is(response.statusCode, 200);

    await waitForSpans();

    const allSpans = spanAdapter.getAllSpans();
    const loginSpan = allSpans.find((span) => {
      const inputValue = span.inputValue as any;
      const url = inputValue?.url || inputValue?.target;
      return url && url.includes("/auth/login") && span.kind === SpanKind.SERVER;
    });

    t.truthy(loginSpan, "Login span not captured");

    // Password should be redacted
    const passwordPattern = /^PWD_[0-9a-f]{12}\.\.\.$/;
    const inputValue = loginSpan!.inputValue as any;

    // Body is base64 encoded, decode and parse it
    const decodedBody = Buffer.from(inputValue.body, 'base64').toString('utf-8');
    const parsedBody = JSON.parse(decodedBody);

    t.truthy(
      passwordPattern.test(parsedBody.password),
      `Expected password to match pattern ${passwordPattern}, got ${parsedBody.password}`,
    );

    // Other fields should remain unchanged
    t.is(
      parsedBody.username,
      "admin@example.com",
      `Expected username to be "admin@example.com", got ${parsedBody.username}`,
    );
    t.is(
      parsedBody.apiKey,
      "secret-key-789",
      `Expected apiKey to be "secret-key-789", got ${parsedBody.apiKey}`,
    );
  });
