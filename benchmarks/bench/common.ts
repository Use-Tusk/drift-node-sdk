import test from "ava";
import { Bench, hrtimeNow } from "tinybench";
import { TestServer } from "../server/test-server";
import { createBenchmarkRunResult, persistBenchmarkResult } from "./result-utils";
import { ResourceMonitor } from "./resource-monitor";

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

function main() {
  test.serial("SDK Active", async (t) => {
    t.timeout(600_000);

    // Enable/disable memory tracking via environment variable for performance testing
    const enableMemoryTracking = process.env.BENCHMARK_ENABLE_MEMORY !== "false";
    const resourceMonitor = new ResourceMonitor({
      intervalMs: 100,
      enableMemoryTracking,
    });

    const bench = new Bench({
      time: 10000,
      warmupTime: 1000,
      warmupIterations: 100,
      now: hrtimeNow,
    });

    // Hook into bench events to track CPU per task
    // Track which task is currently running
    let lastTaskName: string | null = null;

    bench.addEventListener("cycle", (e) => {
      // Cycle event fires after each task completes a benchmark cycle
      if (e.task) {
        const currentTaskName = e.task.name;

        if (lastTaskName && lastTaskName !== currentTaskName) {
          resourceMonitor.endTask();
        }

        if (lastTaskName !== currentTaskName) {
          resourceMonitor.startTask(currentTaskName);
          lastTaskName = currentTaskName;
        }
      }
    });

    bench.add("High Throughput: GET /api/simple", async () => {
      const response = await fetch(`${serverUrl}/api/simple`);
      await response.json();
    });

    bench.add("High Throughput: POST /api/simple-post", async () => {
      const response = await fetch(`${serverUrl}/api/simple-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: "test-data", timestamp: Date.now() }),
      });
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

    bench.add("High IO, Low CPU: POST /api/io-bound", async () => {
      const response = await fetch(`${serverUrl}/api/io-bound`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobs: 5, delayMs: 5 }),
      });
      await response.json();
    });

    bench.add("Large Payload: GET /api/small (100KB)", async () => {
      const response = await fetch(`${serverUrl}/api/small`);
      await response.json();
    });

    const smallPayloadSize = 100 * 1024;
    const smallPostPayload = { data: "x".repeat(smallPayloadSize), timestamp: Date.now() };

    bench.add("Large Payload: POST /api/small-post (100KB)", async () => {
      const response = await fetch(`${serverUrl}/api/small-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(smallPostPayload),
      });
      await response.json();
    });

    bench.add("Large Payload: GET /api/medium (1MB)", async () => {
      const response = await fetch(`${serverUrl}/api/medium`);
      await response.json();
    });

    const mediumPayloadSize = 1024 * 1024;
    const mediumPostPayload = { data: "x".repeat(mediumPayloadSize), timestamp: Date.now() };

    bench.add("Large Payload: POST /api/medium-post (1MB)", async () => {
      const response = await fetch(`${serverUrl}/api/medium-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mediumPostPayload),
      });
      await response.json();
    });

    bench.add("Large Payload: GET /api/large (2MB)", async () => {
      const response = await fetch(`${serverUrl}/api/large`);
      await response.json();
    });

    const largePayloadSize = 2 * 1024 * 1024;
    const largePostPayload = { data: "x".repeat(largePayloadSize), timestamp: Date.now() };

    bench.add("Large Payload: POST /api/large-post (2MB)", async () => {
      const response = await fetch(`${serverUrl}/api/large-post`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(largePostPayload),
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
    bench.add("Transform endpoints", async () => {
      const endpoint = transformEndpoints[endpointIndex % transformEndpoints.length];
      endpointIndex++;

      const response = await fetch(`${serverUrl}${endpoint.path}`, {
        method: endpoint.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(endpoint.body),
      });
      await response.json();
    });

    resourceMonitor.start();
    const runStartedAt = Date.now();
    await bench.run();
    const benchmarkDurationMs = Date.now() - runStartedAt;

    // End tracking for the last task
    resourceMonitor.endTask();
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

    // Report CPU utilization summary
    console.log("\n=== CPU Utilization Summary ===");
    for (const task of benchmarkResult.tasks) {
      if (task.resource?.cpu) {
        const cpu = task.resource.cpu;
        console.log(`${task.name}:`);
        console.log(`  User: ${cpu.userPercent.toFixed(1)}%`);
        console.log(`  System: ${cpu.systemPercent.toFixed(1)}%`);
        console.log(`  Total: ${cpu.totalPercent.toFixed(1)}%`);
      }
    }
    console.log("===============================\n");

    t.pass();
  });
}

export default main;
