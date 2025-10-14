/**
 * All Benchmarks - SDK Disabled
 *
 * Baseline performance measurements without SDK instrumentation
 *
 * Usage: npm test benchmarks/bench/sdk-disabled.bench.ts
 */

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
});

test.serial("SDK Disabled", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 100 });

  bench.add("High Throughput: GET /api/simple", async () => {
    const response = await fetch(`${serverUrl}/api/simple`);
    await response.json();
  });

  bench.add("High CPU: POST /api/compute-hash", async () => {
    const response = await fetch(`${serverUrl}/api/compute-hash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: "sensitive-data-to-hash", iterations: 1000 }),
    });
    await response.json();
  });

  bench.add("Large Payload: GET /api/medium (100KB)", async () => {
    const response = await fetch(`${serverUrl}/api/medium`);
    await response.json();
  });

  bench.add("Large Payload: GET /api/large (1MB)", async () => {
    const response = await fetch(`${serverUrl}/api/large`);
    await response.json();
  });

  const payloadSize = 1024 * 1024;
  const postPayload = { data: "x".repeat(payloadSize), timestamp: Date.now() };

  bench.add("Large Payload: POST /api/large-post (1MB)", async () => {
    const response = await fetch(`${serverUrl}/api/large-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(postPayload),
    });
    await response.json();
  });

  const transformEndpoints = [
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
  bench.add("Transforms: sensitive endpoints", async () => {
    const endpoint = transformEndpoints[endpointIndex % transformEndpoints.length];
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
