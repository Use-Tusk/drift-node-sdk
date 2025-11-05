import test from "ava";
import { Bench, hrtimeNow, Task } from "tinybench";
import { TestServer } from "../server/test-server";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import {
  BenchmarkRunResult,
  CpuStatsSummary,
  HistogramBucket,
  MemoryMetric,
  MemorySample,
  MemoryStats,
  MetricSummary,
  TaskBenchmarkResult,
  TaskResourceStats,
  resolveResultPath,
} from "./result-utils";

let server: TestServer;
let serverUrl: string;

interface ResourceSample {
  timestamp: number;
  cpu: {
    user: number;
    system: number;
  };
  loadAverage: number[];
  memory: MemorySample;
}

class ResourceMonitor {
  private currentTaskSamples: ResourceSample[] = [];
  private taskStats: Map<string, ResourceSample[]> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private lastCpuUsage: NodeJS.CpuUsage | null = null;
  private lastTimestamp: number = 0;
  private currentTaskName: string | null = null;
  private isRunning: boolean = false;

  start(intervalMs: number = 100): void {
    this.isRunning = true;
    this.lastCpuUsage = process.cpuUsage();
    this.lastTimestamp = Date.now();

    this.intervalId = setInterval(() => {
      if (!this.isRunning) return;

      const now = Date.now();
      const currentCpuUsage = process.cpuUsage();
      const elapsedTime = (now - this.lastTimestamp) * 1000; // Convert to microseconds

      if (this.lastCpuUsage && elapsedTime > 0) {
        const userDiff = currentCpuUsage.user - this.lastCpuUsage.user;
        const systemDiff = currentCpuUsage.system - this.lastCpuUsage.system;

        // Calculate CPU percentage (user + system time / elapsed time * 100)
        const userPercent = (userDiff / elapsedTime) * 100;
        const systemPercent = (systemDiff / elapsedTime) * 100;

        const memoryUsage = process.memoryUsage() as NodeJS.MemoryUsage & {
          sharedArrayBuffers?: number;
        };

        const sample: ResourceSample = {
          timestamp: now,
          cpu: {
            user: userPercent,
            system: systemPercent,
          },
          loadAverage: os.loadavg(),
          memory: {
            rss: memoryUsage.rss,
            heapTotal: memoryUsage.heapTotal,
            heapUsed: memoryUsage.heapUsed,
            external: memoryUsage.external ?? 0,
            arrayBuffers: memoryUsage.arrayBuffers ?? 0,
            sharedArrayBuffers: memoryUsage.sharedArrayBuffers ?? 0,
          },
        };

        if (this.currentTaskName) {
          this.currentTaskSamples.push(sample);
        }
      }

      this.lastCpuUsage = currentCpuUsage;
      this.lastTimestamp = now;
    }, intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  startTask(taskName: string): void {
    // Save previous task samples
    if (this.currentTaskName && this.currentTaskSamples.length > 0) {
      const existing = this.taskStats.get(this.currentTaskName) || [];
      this.taskStats.set(this.currentTaskName, [...existing, ...this.currentTaskSamples]);
    }

    // Start new task
    this.currentTaskName = taskName;
    this.currentTaskSamples = [];
  }

  endTask(): void {
    // Save current task samples
    if (this.currentTaskName && this.currentTaskSamples.length > 0) {
      const existing = this.taskStats.get(this.currentTaskName) || [];
      this.taskStats.set(this.currentTaskName, [...existing, ...this.currentTaskSamples]);
    }

    this.currentTaskName = null;
    this.currentTaskSamples = [];
  }

  getTaskStats(taskName: string): TaskResourceStats | null {
    const samples = this.taskStats.get(taskName);
    if (!samples || samples.length === 0) {
      return null;
    }

    const userValues = samples.map((s) => s.cpu.user);
    const systemValues = samples.map((s) => s.cpu.system);
    const totalValues = samples.map((s) => s.cpu.user + s.cpu.system);

    const avgUser = userValues.reduce((a, b) => a + b, 0) / userValues.length;
    const avgSystem = systemValues.reduce((a, b) => a + b, 0) / systemValues.length;
    const avgTotal = totalValues.reduce((a, b) => a + b, 0) / totalValues.length;

    const maxUser = Math.max(...userValues);
    const maxSystem = Math.max(...systemValues);
    const maxTotal = Math.max(...totalValues);

    const avgLoad = [0, 0, 0];
    for (const sample of samples) {
      avgLoad[0] += sample.loadAverage[0];
      avgLoad[1] += sample.loadAverage[1];
      avgLoad[2] += sample.loadAverage[2];
    }
    avgLoad[0] /= samples.length;
    avgLoad[1] /= samples.length;
    avgLoad[2] /= samples.length;

    const memoryMetrics: MemoryMetric[] = [
      "rss",
      "heapTotal",
      "heapUsed",
      "external",
      "arrayBuffers",
      "sharedArrayBuffers",
    ];

    const memoryStats = memoryMetrics.reduce((acc, metric) => {
      const values = samples.map((sample) => sample.memory[metric]);
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      const max = Math.max(...values);
      acc[metric] = { avg, max };
      return acc;
    }, {} as MemoryStats);

    return {
      cpu: {
        avgUser,
        avgSystem,
        avgTotal,
        maxUser,
        maxSystem,
        maxTotal,
      },
      memory: memoryStats,
      avgLoad,
      sampleCount: samples.length,
    };
  }

  getAllTaskNames(): string[] {
    return Array.from(this.taskStats.keys());
  }
}

function toNanoseconds(value: number | undefined | null): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  return value * 1_000_000_000;
}

function safeNumber(value: number | undefined | null): number | null {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }
  return value;
}

function buildLatencyHistogram(samples: number[]): HistogramBucket[] | null {
  if (samples.length === 0) {
    return null;
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  if (min === max) {
    return [
      {
        minNs: toNanoseconds(min) ?? 0,
        maxNs: toNanoseconds(max) ?? 0,
        count: samples.length,
      },
    ];
  }

  const bucketCount = 20;
  const range = max - min;
  const bucketSize = range / bucketCount;
  const counts = new Array<number>(bucketCount).fill(0);

  for (const sample of samples) {
    let bucketIndex = Math.floor((sample - min) / bucketSize);
    if (!Number.isFinite(bucketIndex) || bucketIndex < 0) {
      bucketIndex = 0;
    }
    if (bucketIndex >= bucketCount) {
      bucketIndex = bucketCount - 1;
    }
    counts[bucketIndex]!++;
  }

  return counts.map((count, index) => {
    const bucketMin = min + index * bucketSize;
    const isLast = index === bucketCount - 1;
    const bucketMax = isLast ? max : min + (index + 1) * bucketSize;
    return {
      minNs: toNanoseconds(bucketMin) ?? 0,
      maxNs: toNanoseconds(bucketMax) ?? 0,
      count,
    };
  });
}

function buildMetricSummary(
  unit: MetricSummary["unit"],
  stats: {
    mean: number;
    p50?: number;
    min: number;
    max: number;
    sd: number;
    sem: number;
    moe: number;
    rme: number;
  },
  transform?: (value: number | undefined) => number | null,
  tail?: { percentile: number; value?: number },
): MetricSummary {
  const convert = transform ?? ((value?: number) => safeNumber(value ?? null));
  const summary: MetricSummary = {
    unit,
    mean: convert(stats.mean),
    median: convert(stats.p50),
    min: convert(stats.min),
    max: convert(stats.max),
    standardDeviation: convert(stats.sd),
    standardError: convert(stats.sem),
    marginOfError: convert(stats.moe),
    relativeMarginOfError: safeNumber(stats.rme),
  };

  if (tail) {
    summary.tail = {
      percentile: tail.percentile,
      value: convert(tail.value),
    };
  }

  return summary;
}

function createTaskBenchmarkResult(
  task: Task,
  resourceMonitor: ResourceMonitor,
): TaskBenchmarkResult | null {
  if (!task.result) {
    return null;
  }

  const { latency, throughput } = task.result;
  const resourceStats = resourceMonitor.getTaskStats(task.name) ?? null;

  return {
    name: task.name,
    samples: latency.samples.length,
    latency: buildMetricSummary("ns", latency, toNanoseconds, {
      percentile: 99,
      value: latency.p99,
    }),
    throughput: buildMetricSummary("ops/s", throughput),
    resource: resourceStats,
    histogram: buildLatencyHistogram(latency.samples),
  };
}

function createBenchmarkRunResult(
  bench: Bench,
  resourceMonitor: ResourceMonitor,
  durationMs: number,
  label: string,
): BenchmarkRunResult {
  const tasks = bench.tasks
    .map((task) => createTaskBenchmarkResult(task, resourceMonitor))
    .filter((taskResult): taskResult is TaskBenchmarkResult => taskResult !== null);

  return {
    id: randomUUID(),
    label,
    timestamp: new Date().toISOString(),
    durationMs,
    options: {
      time: bench.opts.time,
      warmupTime: bench.opts.warmupTime,
      warmupIterations: bench.opts.warmupIterations,
      iterations: bench.opts.iterations,
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      loadAverage: os.loadavg(),
    },
    tasks,
  };
}

export function resolveResultPath(label: string): string {
  const explicitPath = process.env.BENCHMARK_RESULT_PATH;
  if (explicitPath && explicitPath.trim().length > 0) {
    return explicitPath;
  }

  const resultDir = process.env.BENCHMARK_RESULT_DIR ?? path.join(__dirname, "..", "results");
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9-_]+/g, "-") || "benchmark";
  const fileName = `${sanitizedLabel}.json`;
  return path.join(resultDir, fileName);
}

function persistBenchmarkResult(result: BenchmarkRunResult): string {
  const outputPath = resolveResultPath(result.label);
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  return outputPath;
}

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

    const resourceMonitor = new ResourceMonitor();

    const bench = new Bench({
      time: 10000,
      warmupTime: 1000,
      warmupIterations: 100,
      now: hrtimeNow,
    });

    // Hook into bench events to track CPU per task
    // Track which task is currently running
    let lastTaskName: string | null = null;

    bench.addEventListener("cycle", (e: any) => {
      // Cycle event fires after each task completes a benchmark cycle
      if (e.task) {
        const currentTaskName = e.task.name;

        // If this is a different task than last time, we've moved to the next task
        if (lastTaskName && lastTaskName !== currentTaskName) {
          resourceMonitor.endTask();
        }

        // Start tracking this task if we haven't already
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

    resourceMonitor.start(100);
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
    t.pass();
  });
}

export default main;
