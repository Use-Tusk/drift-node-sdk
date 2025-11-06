import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

// Use process.cwd() as the base directory for the benchmarks
const CURRENT_DIR = path.join(process.cwd(), "benchmarks", "bench");

export interface CpuStatsSummary {
  userPercent: number;
  systemPercent: number;
  totalPercent: number;
}

export interface SimpleMemoryStats {
  rss: { avg: number; max: number };
}

export interface TaskResourceStats {
  cpu: CpuStatsSummary;
  memory: SimpleMemoryStats;
}

export interface HistogramBucket {
  minNs: number;
  maxNs: number;
  count: number;
}

export interface MetricSummary {
  unit: "ns" | "ops/s";
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  standardDeviation: number | null;
  standardError: number | null;
  marginOfError: number | null;
  relativeMarginOfError: number | null;
  tail?: {
    percentile: number;
    value: number | null;
  } | null;
}

export interface TaskBenchmarkResult {
  name: string;
  samples: number;
  latency: MetricSummary;
  throughput: MetricSummary;
  resource?: TaskResourceStats | null;
  histogram?: HistogramBucket[] | null;
}

export interface BenchmarkRunResult {
  id: string;
  label: string;
  timestamp: string;
  durationMs: number;
  options: {
    time: number;
    warmupTime: number;
    warmupIterations: number;
    iterations: number;
  };
  system: {
    nodeVersion: string;
    platform: NodeJS.Platform;
    arch: string;
    cpuCount: number;
    totalMemory: number;
    freeMemory: number;
    loadAverage: number[];
  };
  tasks: TaskBenchmarkResult[];
}

export function resolveResultPath(label: string): string {
  const explicitPath = process.env.BENCHMARK_RESULT_PATH;
  if (explicitPath && explicitPath.trim().length > 0) {
    return explicitPath;
  }

  const resultDir = process.env.BENCHMARK_RESULT_DIR ?? path.join(CURRENT_DIR, "..", "results");
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9-_]+/g, "-") || "benchmark";
  const fileName = `${sanitizedLabel}.json`;
  return path.join(resultDir, fileName);
}

// Helper functions
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

export function buildLatencyHistogram(samples: number[]): HistogramBucket[] | null {
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

export function buildMetricSummary(
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

export function createTaskBenchmarkResult(
  task: any, // Task from tinybench
  resourceMonitor: any, // ResourceMonitor
): TaskBenchmarkResult | null {
  if (!task.result) {
    return null;
  }

  const { latency, throughput } = task.result;

  // Check if latency and throughput exist
  if (!latency || !throughput) {
    console.warn(`Task ${task.name} missing latency or throughput results`);
    return null;
  }

  const resourceStats = resourceMonitor.getTaskStats(task.name) ?? null;

  return {
    name: task.name,
    samples: latency.samples?.length ?? 0,
    latency: buildMetricSummary("ns", latency, toNanoseconds, {
      percentile: 99,
      value: latency.p99,
    }),
    throughput: buildMetricSummary("ops/s", throughput),
    resource: resourceStats,
    histogram: buildLatencyHistogram(latency.samples ?? []),
  };
}

export function createBenchmarkRunResult(
  bench: any, // Bench from tinybench
  resourceMonitor: any, // ResourceMonitor
  durationMs: number,
  label: string,
): BenchmarkRunResult {
  const tasks = bench.tasks
    .map((task: any) => createTaskBenchmarkResult(task, resourceMonitor))
    .filter((taskResult: any): taskResult is TaskBenchmarkResult => taskResult !== null);

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

export function persistBenchmarkResult(result: BenchmarkRunResult): string {
  const outputPath = resolveResultPath(result.label);
  const directory = path.dirname(outputPath);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
  return outputPath;
}

export function loadBenchmarkResult(filePath: string): BenchmarkRunResult {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as BenchmarkRunResult;
}

export function createTaskLookup(run: BenchmarkRunResult): Map<string, TaskBenchmarkResult> {
  const lookup = new Map<string, TaskBenchmarkResult>();
  for (const task of run.tasks) {
    lookup.set(task.name, task);
  }
  return lookup;
}
