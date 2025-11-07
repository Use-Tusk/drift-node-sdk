import test from "ava";
import { Bench, hrtimeNow } from "tinybench";
import { TestServer } from "../server/test-server";
import { createBenchmarkRunResult, persistBenchmarkResult } from "./result-utils";
import { ResourceMonitor } from "./resource-monitor";

let server: TestServer;
let serverUrl: string;

function main(testName: string = "SDK Active") {
  test.before(async () => {
    server = new TestServer();
    const info = await server.start();
    serverUrl = info.url;
  });

  test.after.always(async () => {
    if (server) {
      await server.stop();
    }
  });

  test.serial(testName, async (t) => {
    t.timeout(600_000);

    const enableMemoryTracking = process.env.BENCHMARK_ENABLE_MEMORY !== "false";
    const resourceMonitor = new ResourceMonitor({
      intervalMs: 100,
      enableMemoryTracking,
    });

    const bench = new Bench({
      time: 10000,
      warmup: false,
      now: hrtimeNow,
    });

    let currentTaskName: string | null = null;

    /*
    bench.add(`High Throughput: GET /api/simple (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/simple`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    bench.add(`High Throughput: POST /api/simple-post (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/simple-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data", timestamp: Date.now() }),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });
    */

    bench.add(
      `High CPU: POST /api/compute-hash (${testName})`,
      async () => {
        const response = await fetch(`${serverUrl}/api/compute-hash`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: "sensitive-data-to-hash", iterations: 1000 }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        await response.json();
      },
      {
        beforeAll: () => {
          const taskName = `High CPU: POST /api/compute-hash (${testName})`;
          console.log("Task starting:", taskName);
          resourceMonitor.startTask(taskName);
          currentTaskName = taskName;
        },
        afterAll: () => {
          console.log("Task ending:", currentTaskName);
          resourceMonitor.endTask();
          currentTaskName = null;
        },
      },
    );

    bench.add(
      `High IO, Low CPU: POST /api/io-bound (${testName})`,
      async () => {
        const response = await fetch(`${serverUrl}/api/io-bound`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobs: 5, delayMs: 5 }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        await response.json();
      },
      {
        beforeAll: () => {
          const taskName = `High IO, Low CPU: POST /api/io-bound (${testName})`;
          console.log("Task starting:", taskName);
          resourceMonitor.startTask(taskName);
          currentTaskName = taskName;
        },
        afterAll: () => {
          console.log("Task ending:", currentTaskName);
          resourceMonitor.endTask();
          currentTaskName = null;
        },
      },
    );

    /*
    bench.add(`Large Payload: GET /api/small (100KB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/small`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    const smallPayloadSize = 100 * 1024;
    const smallPostPayload = { data: "x".repeat(smallPayloadSize), timestamp: Date.now() };

    bench.add(`Large Payload: POST /api/small-post (100KB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/small-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smallPostPayload),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    bench.add(`Large Payload: GET /api/medium (1MB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/medium`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    const mediumPayloadSize = 1024 * 1024;
    const mediumPostPayload = { data: "x".repeat(mediumPayloadSize), timestamp: Date.now() };

    bench.add(`Large Payload: POST /api/medium-post (1MB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/medium-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mediumPostPayload),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    bench.add(`Large Payload: GET /api/large (2MB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/large`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });

    const largePayloadSize = 2 * 1024 * 1024;
    const largePostPayload = { data: "x".repeat(largePayloadSize), timestamp: Date.now() };

    bench.add(`Large Payload: POST /api/large-post (2MB) (${testName})`, async () => {
      const response = await fetch(`${serverUrl}/api/large-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(largePostPayload),
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      await response.json();
    });
    */

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
    bench.add(
      `Transform endpoints (${testName})`,
      async () => {
        const endpoint = transformEndpoints[endpointIndex % transformEndpoints.length];
        endpointIndex++;

        const response = await fetch(`${serverUrl}${endpoint.path}`, {
          method: endpoint.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(endpoint.body),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        await response.json();
      },
      {
        beforeAll: () => {
          const taskName = `Transform endpoints (${testName})`;
          console.log("Task starting:", taskName);
          resourceMonitor.startTask(taskName);
          currentTaskName = taskName;
        },
        afterAll: () => {
          console.log("Task ending:", currentTaskName);
          resourceMonitor.endTask();
          currentTaskName = null;
        },
      },
    );

    resourceMonitor.start();
    const runStartedAt = Date.now();
    await bench.run();
    const benchmarkDurationMs = Date.now() - runStartedAt;

    resourceMonitor.stop();

    const label = process.env.BENCHMARK_RESULT_LABEL ?? "benchmark";
    const benchmarkResult = createBenchmarkRunResult(
      bench,
      resourceMonitor,
      benchmarkDurationMs,
      label,
    );
    const outputPath = persistBenchmarkResult(benchmarkResult);
    console.log(`Benchmark results saved to ${outputPath}`);

    t.pass();
  });
}

export default main;
