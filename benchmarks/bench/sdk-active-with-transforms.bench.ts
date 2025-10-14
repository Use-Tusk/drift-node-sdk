/**
 * Transforms Benchmark - SDK Active with Transform Rules
 *
 * Performance measurements with SDK instrumentation and active transform rules
 *
 * Usage: npm test benchmarks/bench/sdk-active-with-transforms.bench.ts
 */

process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift, TuskDriftCore } from "../../src/core/TuskDrift";
import { FilesystemSpanAdapter } from "../../src/core/tracing/adapters/FilesystemSpanAdapter";
import * as path from "path";
import * as fs from "fs";

const BENCHMARK_TRACE_DIR = path.join(__dirname, "..", ".benchmark-traces");

// Clean up any existing benchmark traces
if (fs.existsSync(BENCHMARK_TRACE_DIR)) {
  fs.rmSync(BENCHMARK_TRACE_DIR, { recursive: true, force: true });
}

const adapter = new FilesystemSpanAdapter({
  baseDirectory: BENCHMARK_TRACE_DIR,
});

TuskDrift.initialize({
  apiKey: "benchmark-test-key",
  env: "benchmark",
  logLevel: "silent",
  transforms: {
    http: [
      {
        matcher: {
          direction: "inbound" as const,
          method: ["POST"],
          pathPattern: "/api/auth/login",
          jsonPath: "$.password",
        },
        action: { type: "redact" as const },
      },
      {
        matcher: {
          direction: "inbound" as const,
          method: ["POST"],
          pathPattern: "/api/users",
          jsonPath: "$.ssn",
        },
        action: { type: "mask" as const },
      },
      {
        matcher: {
          direction: "inbound" as const,
          method: ["POST"],
          pathPattern: "/api/users",
          jsonPath: "$.creditCard",
        },
        action: { type: "redact" as const },
      },
    ],
  },
});

TuskDriftCore.getInstance().spanExporter?.clearAdapters();
TuskDriftCore.getInstance().spanExporter?.addAdapter(adapter);

TuskDrift.markAppAsReady();

import test from "ava";
import { Bench } from "tinybench";
import { TestServer } from "../server/test-server";

let server: TestServer;
let serverUrl: string;

test.before(async () => {
  server = new TestServer();
  const info = await server.start();
  serverUrl = info.url;
  console.log(`\nTest server started at ${serverUrl}`);
});

test.after.always(async () => {
  if (server) {
    await server.stop();
    console.log("Test server stopped\n");
  }

  if (fs.existsSync(BENCHMARK_TRACE_DIR)) {
    fs.rmSync(BENCHMARK_TRACE_DIR, { recursive: true, force: true });
  }
});

test.serial("SDK Active with Transforms", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 20 });

  const endpoints = [
    {
      path: "/api/auth/login",
      method: "POST" as const,
      body: { email: "user@example.com", password: "super-secret-password-123" },
    },
    {
      path: "/api/users",
      method: "POST" as const,
      body: {
        username: "testuser",
        email: "test@example.com",
        ssn: "123-45-6789",
        creditCard: "4111-1111-1111-1111",
      },
    },
  ];

  let endpointIndex = 0;
  bench.add("Transforms: sensitive endpoints (with rules)", async () => {
    const endpoint = endpoints[endpointIndex % endpoints.length];
    endpointIndex++;

    const response = await fetch(`${serverUrl}${endpoint.path}`, {
      method: endpoint.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(endpoint.body),
    });
    await response.json();
  });

  await bench.run();
  console.table(bench.table());
  t.pass();
});
