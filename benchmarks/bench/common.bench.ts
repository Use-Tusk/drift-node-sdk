import test from "ava";
import { Bench, hrtimeNow, Task } from "tinybench";
import { TestServer } from "../server/test-server";
import * as os from "os";

let server: TestServer;
let serverUrl: string;

interface CpuSample {
  timestamp: number;
  user: number;
  system: number;
  loadAverage: number[];
}

interface TaskCpuStats {
  taskName: string;
  samples: CpuSample[];
}

class CpuMonitor {
  private currentTaskSamples: CpuSample[] = [];
  private taskStats: Map<string, CpuSample[]> = new Map();
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

        const sample: CpuSample = {
          timestamp: now,
          user: userPercent,
          system: systemPercent,
          loadAverage: os.loadavg(),
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

  getTaskStats(taskName: string): {
    avgUser: number;
    avgSystem: number;
    avgTotal: number;
    maxUser: number;
    maxSystem: number;
    maxTotal: number;
    avgLoad: number[];
  } | null {
    const samples = this.taskStats.get(taskName);
    if (!samples || samples.length === 0) {
      return null;
    }

    const userValues = samples.map((s) => s.user);
    const systemValues = samples.map((s) => s.system);
    const totalValues = samples.map((s) => s.user + s.system);

    const avgUser = userValues.reduce((a, b) => a + b, 0) / userValues.length;
    const avgSystem = systemValues.reduce((a, b) => a + b, 0) / systemValues.length;
    const avgTotal = totalValues.reduce((a, b) => a + b, 0) / totalValues.length;

    const maxUser = Math.max(...userValues);
    const maxSystem = Math.max(...systemValues);
    const maxTotal = Math.max(...totalValues);

    // Average load across all samples
    const avgLoad = [0, 0, 0];
    for (const sample of samples) {
      avgLoad[0] += sample.loadAverage[0];
      avgLoad[1] += sample.loadAverage[1];
      avgLoad[2] += sample.loadAverage[2];
    }
    avgLoad[0] /= samples.length;
    avgLoad[1] /= samples.length;
    avgLoad[2] /= samples.length;

    return {
      avgUser,
      avgSystem,
      avgTotal,
      maxUser,
      maxSystem,
      maxTotal,
      avgLoad,
    };
  }

  getAllTaskNames(): string[] {
    return Array.from(this.taskStats.keys());
  }
}

function formatNs(ns?: number): string {
  if (ns === undefined) return "undefined";
  if (ns < 1000) return `${ns.toFixed(0)}ns`;
  if (ns < 1_000_000) return `${(ns / 1000).toFixed(2)}μs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)}ms`;
  return `${(ns / 1_000_000_000).toFixed(2)}s`;
}

function printCpuStats(cpuMonitor: CpuMonitor, tasks: Task[]): void {
  console.log("\n" + "=".repeat(80));
  console.log("CPU UTILIZATION PER TASK");
  console.log("=".repeat(80));
  console.log(`CPU Cores: ${os.cpus().length}`);

  for (const task of tasks) {
    if (!task.result) continue;

    const stats = cpuMonitor.getTaskStats(task.name);
    if (!stats) {
      console.log(`\n${task.name}`);
      console.log("-".repeat(80));
      console.log("  No CPU data collected");
      continue;
    }

    console.log(`\n${task.name}`);
    console.log("-".repeat(80));
    console.log(`  Process CPU Usage:`);
    console.log(`    Average User:   ${stats.avgUser.toFixed(2)}%`);
    console.log(`    Average System: ${stats.avgSystem.toFixed(2)}%`);
    console.log(`    Average Total:  ${stats.avgTotal.toFixed(2)}%`);
    console.log(`    Max User:       ${stats.maxUser.toFixed(2)}%`);
    console.log(`    Max System:     ${stats.maxSystem.toFixed(2)}%`);
    console.log(`    Max Total:      ${stats.maxTotal.toFixed(2)}%`);
  }

  console.log("\n" + "=".repeat(80));
}

function printHistogram(tasks: Task[]): void {
  for (const task of tasks) {
    const result = task.result;
    if (!result) continue;
    const values = result.latency.samples;
    if (values.length === 0) continue;

    console.log(`\n${task.name}`);
    console.log("-".repeat(80));

    const sorted = [...values].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;

    // Create 20 buckets
    const buckets = 20;
    const bucketSize = range / buckets;
    const counts = new Array(buckets).fill(0);

    for (const val of values) {
      const bucketIndex = Math.min(Math.floor((val - min) / bucketSize), buckets - 1);
      counts[bucketIndex]++;
    }

    const lines: string[] = [];

    for (let i = 0; i < buckets; i++) {
      const bucketMin = min + i * bucketSize;
      const bucketMax = min + (i + 1) * bucketSize;
      const count = counts[i];
      const label = `${formatNs(bucketMin).padStart(10)} - ${formatNs(bucketMax).padEnd(10)}`;
      const countLabel = count.toString().padStart(6);
      lines.push(`${label} │ ${countLabel}`);
    }

    console.log(lines.join("\n"));
  }
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

    const cpuMonitor = new CpuMonitor();

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
          cpuMonitor.endTask();
        }

        // Start tracking this task if we haven't already
        if (lastTaskName !== currentTaskName) {
          cpuMonitor.startTask(currentTaskName);
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

    cpuMonitor.start(100);
    await bench.run();

    // End tracking for the last task
    cpuMonitor.endTask();
    cpuMonitor.stop();

    console.table(bench.table());
    printCpuStats(cpuMonitor, bench.tasks);
    printHistogram(bench.tasks);
    t.pass();
  });
}

export default main;
