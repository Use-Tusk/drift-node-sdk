#!/usr/bin/env node

import {
  BenchmarkRunResult,
  MetricSummary,
  TaskBenchmarkResult,
  createTaskLookup,
  loadBenchmarkResult,
  resolveResultPath,
} from "./bench/result-utils";

interface ImpactResult {
  label: string;
  throughputDeltaPct: number | null;
  tailLatencyDeltaPct: number | null;
  baselineThroughput: number | null;
  variantThroughput: number | null;
  baselineTail: number | null;
  variantTail: number | null;
}

interface MemoryOverheadSummary {
  avgRssDelta: number | null;
  maxRssDelta: number | null;
  avgHeapUsedDelta: number | null;
  maxHeapUsedDelta: number | null;
  samples: number;
}

const CPU_HEAVY_TASK = "High CPU: POST /api/compute-hash";
const IO_HEAVY_TASK = "High IO, Low CPU: POST /api/io-bound";
const TRANSFORM_TASK = "Transform endpoints";

function percentageChange(baseline: number | null, variant: number | null): number | null {
  if (baseline === null || variant === null) {
    return null;
  }
  if (baseline === 0) {
    return null;
  }
  return ((variant - baseline) / baseline) * 100;
}

function getTailLatency(summary: MetricSummary): number | null {
  if (summary.tail && summary.tail.value !== null) {
    return summary.tail.value;
  }
  return summary.max ?? null;
}

function formatPercentage(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function formatLatency(ns: number | null): string {
  if (ns === null || Number.isNaN(ns)) {
    return "n/a";
  }
  if (ns < 1_000) return `${ns.toFixed(0)} ns`;
  if (ns < 1_000_000) return `${(ns / 1_000).toFixed(2)} μs`;
  if (ns < 1_000_000_000) return `${(ns / 1_000_000).toFixed(2)} ms`;
  return `${(ns / 1_000_000_000).toFixed(2)} s`;
}

function formatThroughput(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || Number.isNaN(bytes)) {
    return "n/a";
  }
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function computeImpact(
  label: string,
  baseline: TaskBenchmarkResult | undefined,
  variant: TaskBenchmarkResult | undefined,
): ImpactResult | null {
  if (!baseline || !variant) {
    return null;
  }

  const baselineThroughput = baseline.throughput.mean ?? null;
  const variantThroughput = variant.throughput.mean ?? null;
  const baselineTail = getTailLatency(baseline.latency);
  const variantTail = getTailLatency(variant.latency);

  return {
    label,
    throughputDeltaPct: percentageChange(baselineThroughput, variantThroughput),
    tailLatencyDeltaPct: percentageChange(baselineTail, variantTail),
    baselineThroughput,
    variantThroughput,
    baselineTail,
    variantTail,
  };
}

function computeMemoryOverhead(
  baseline: BenchmarkRunResult,
  variant: BenchmarkRunResult,
): MemoryOverheadSummary {
  const baselineTasks = createTaskLookup(baseline);
  const variantTasks = createTaskLookup(variant);

  let rssSum = 0;
  let rssMaxDelta: number | null = null;
  let heapSum = 0;
  let heapMaxDelta: number | null = null;
  let count = 0;

  for (const [name, baselineTask] of baselineTasks.entries()) {
    const variantTask = variantTasks.get(name);
    if (!baselineTask?.resource || !variantTask?.resource) {
      continue;
    }

    const baselineMem = baselineTask.resource.memory;
    const variantMem = variantTask.resource.memory;

    const avgRssDelta = variantMem.rss.avg - baselineMem.rss.avg;
    const maxRssDelta = variantMem.rss.max - baselineMem.rss.max;
    rssSum += avgRssDelta;
    rssMaxDelta = rssMaxDelta === null ? maxRssDelta : Math.max(rssMaxDelta, maxRssDelta);

    const avgHeapDelta = variantMem.heapUsed.avg - baselineMem.heapUsed.avg;
    const maxHeapDelta = variantMem.heapUsed.max - baselineMem.heapUsed.max;
    heapSum += avgHeapDelta;
    heapMaxDelta = heapMaxDelta === null ? maxHeapDelta : Math.max(heapMaxDelta, maxHeapDelta);

    count++;
  }

  return {
    avgRssDelta: count ? rssSum / count : null,
    maxRssDelta: rssMaxDelta,
    avgHeapUsedDelta: count ? heapSum / count : null,
    maxHeapUsedDelta: heapMaxDelta,
    samples: count,
  };
}

function printImpact(result: ImpactResult | null): void {
  if (!result) {
    console.log("  Data unavailable.\n");
    return;
  }

  console.log(`  Throughput Δ: ${formatPercentage(result.throughputDeltaPct)} (baseline ${formatThroughput(result.baselineThroughput)}, variant ${formatThroughput(result.variantThroughput)})`);
  console.log(
    `  Tail latency Δ: ${formatPercentage(result.tailLatencyDeltaPct)} (baseline ${formatLatency(result.baselineTail)}, variant ${formatLatency(result.variantTail)})\n`,
  );
}

function printMemorySummary(label: string, summary: MemoryOverheadSummary | null): void {
  if (!summary) {
    console.log(`  ${label}: data unavailable`);
    return;
  }

  if (summary.samples === 0) {
    console.log(`  ${label}: no overlapping resource samples`);
    return;
  }

  console.log(
    `  ${label}: Avg RSS Δ ${formatBytes(summary.avgRssDelta)}, Max RSS Δ ${formatBytes(summary.maxRssDelta)}, Avg HeapUsed Δ ${formatBytes(summary.avgHeapUsedDelta)}, Max HeapUsed Δ ${formatBytes(summary.maxHeapUsedDelta)}`,
  );
}

function main(): void {
  const baselinePath = resolveResultPath("sdk-disabled");
  const activePath = resolveResultPath("sdk-active");
  const transformsPath = resolveResultPath("sdk-active-with-transforms");

  const baseline = loadBenchmarkResult(baselinePath);
  const active = loadBenchmarkResult(activePath);

  let transforms: BenchmarkRunResult | null = null;
  try {
    transforms = loadBenchmarkResult(transformsPath);
  } catch (error) {
    transforms = null;
  }

  const baselineTasks = createTaskLookup(baseline);
  const activeTasks = createTaskLookup(active);
  const transformTasks = transforms ? createTaskLookup(transforms) : null;

  console.log("\n=== Benchmark Impact Summary ===\n");

  console.log("CPU-bound workload (High CPU)");
  printImpact(
    computeImpact(
      CPU_HEAVY_TASK,
      baselineTasks.get(CPU_HEAVY_TASK),
      activeTasks.get(CPU_HEAVY_TASK),
    ),
  );

  console.log("IO-bound workload (High IO, Low CPU)");
  printImpact(
    computeImpact(
      IO_HEAVY_TASK,
      baselineTasks.get(IO_HEAVY_TASK),
      activeTasks.get(IO_HEAVY_TASK),
    ),
  );

  if (transformTasks) {
    console.log("Transforms workload impact");
    printImpact(
      computeImpact(
        TRANSFORM_TASK,
        activeTasks.get(TRANSFORM_TASK),
        transformTasks.get(TRANSFORM_TASK),
      ),
    );
  } else {
    console.log("Transforms workload impact");
    console.log("  Provide a transforms benchmark file to compute this comparison.\n");
  }

  console.log("Memory overhead vs baseline");
  const activeMemory = computeMemoryOverhead(baseline, active);
  printMemorySummary("SDK Active", activeMemory);
  if (transforms) {
    const transformMemory = computeMemoryOverhead(baseline, transforms);
    printMemorySummary("SDK Active w/ Transforms", transformMemory);
  }

  console.log("\nSummary complete.\n");
}

main();
