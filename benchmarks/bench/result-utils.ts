import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface MemorySample {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
  sharedArrayBuffers: number;
}

export type MemoryMetric = keyof MemorySample;

export interface CpuStatsSummary {
  avgUser: number;
  avgSystem: number;
  avgTotal: number;
  maxUser: number;
  maxSystem: number;
  maxTotal: number;
}

export type MemoryStats = Record<MemoryMetric, { avg: number; max: number }>;

export interface TaskResourceStats {
  cpu: CpuStatsSummary;
  memory: MemoryStats;
  avgLoad: number[];
  sampleCount: number;
}

export interface HistogramBucket {
  minNs: number;
  maxNs: number;
  count: number;
}

export interface TailMetric {
  percentile: number;
  value: number | null;
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
  tail?: TailMetric | null;
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

  const resultDir =
    process.env.BENCHMARK_RESULT_DIR ?? path.join(CURRENT_DIR, "..", "results");
  const sanitizedLabel = label.replace(/[^a-zA-Z0-9-_]+/g, "-") || "benchmark";
  const fileName = `${sanitizedLabel}.json`;
  return path.join(resultDir, fileName);
}

export function loadBenchmarkResult(filePath: string): BenchmarkRunResult {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw) as BenchmarkRunResult;
}

export function createTaskLookup(
  run: BenchmarkRunResult,
): Map<string, TaskBenchmarkResult> {
  const lookup = new Map<string, TaskBenchmarkResult>();
  for (const task of run.tasks) {
    lookup.set(task.name, task);
  }
  return lookup;
}
