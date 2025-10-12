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

test.serial("High Throughput", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 100 });

  bench.add("fetch /api/simple", async () => {
    const response = await fetch(`${serverUrl}/api/simple`);
    await response.json();
  });

  await bench.run();
  console.log("\n=== High Throughput ===");
  console.table(bench.table());
  t.pass();
});

test.serial("High CPU", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 20 });

  const requestBody = { data: "sensitive-data-to-hash", iterations: 1000 };

  bench.add("POST /api/compute-hash", async () => {
    const response = await fetch(`${serverUrl}/api/compute-hash`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });
    await response.json();
  });

  await bench.run();
  console.log("\n=== High CPU ===");
  console.table(bench.table());
  t.pass();
});

test.serial("Large Payload - Medium (100KB)", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 10 });

  bench.add("GET /api/medium (100KB)", async () => {
    const response = await fetch(`${serverUrl}/api/medium`);
    await response.json();
  });

  await bench.run();
  console.log("\n=== Large Payload - Medium (100KB) ===");
  console.table(bench.table());
  t.pass();
});

test.serial("Large Payload - Large (1MB)", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 10 });

  bench.add("GET /api/large (1MB)", async () => {
    const response = await fetch(`${serverUrl}/api/large`);
    await response.json();
  });

  await bench.run();
  console.log("\n=== Large Payload - Large (1MB) ===");
  console.table(bench.table());
  t.pass();
});

test.serial("Large Payload - POST (1MB)", async (t) => {
  const bench = new Bench({ time: 10000, warmupTime: 1000, warmupIterations: 5 });

  const payloadSize = 1024 * 1024;
  const payload = { data: "x".repeat(payloadSize), timestamp: Date.now() };

  bench.add("POST /api/large-post (1MB)", async () => {
    const response = await fetch(`${serverUrl}/api/large-post`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await response.json();
  });

  await bench.run();
  console.log("\n=== Large Payload - POST (1MB) ===");
  console.table(bench.table());
  t.pass();
});

test.serial("Tail Latency", async (t) => {
  const bench = new Bench({ time: 15000, warmupTime: 1000, warmupIterations: 50 });

  const endpoints = [
    { path: "/api/simple", weight: 0.6, method: "GET" as const },
    { path: "/api/medium", weight: 0.25, method: "GET" as const },
    { path: "/api/slow", weight: 0.1, method: "GET" as const },
    {
      path: "/api/compute-hash",
      weight: 0.05,
      method: "POST" as const,
      body: { data: "test", iterations: 500 },
    },
  ];

  function selectEndpoint() {
    const random = Math.random();
    let cumulative = 0;
    for (const endpoint of endpoints) {
      cumulative += endpoint.weight;
      if (random <= cumulative) return endpoint;
    }
    return endpoints[endpoints.length - 1];
  }

  bench.add("mixed workload", async () => {
    const endpoint = selectEndpoint();
    const url = `${serverUrl}${endpoint.path}`;

    if (endpoint.method === "POST") {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint.body),
      });
      await response.json();
    } else {
      const response = await fetch(url);
      await response.json();
    }
  });

  await bench.run();
  console.log("\n=== Tail Latency ===");
  console.table(bench.table());
  t.pass();
});

test.serial("Transforms", async (t) => {
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
  bench.add("transform-triggering endpoints", async () => {
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
  console.log("\n=== Transforms ===");
  console.table(bench.table());
  t.pass();
});
