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
  cpuUserDeltaPct: number | null;
  cpuSystemDeltaPct: number | null;
  cpuTotalDeltaPct: number | null;
  baselineCpuTotal: number | null;
  variantCpuTotal: number | null;
}

interface MemoryOverheadSummary {
  avgRssDelta: number | null;
  maxRssDelta: number | null;
  avgHeapUsedDelta: number | null;
  maxHeapUsedDelta: number | null;
  samples: number;
}

const CPU_HEAVY_TASK_BASE = "High CPU: POST /api/compute-hash";
const IO_HEAVY_TASK_BASE = "High IO, Low CPU: POST /api/io-bound";
const TRANSFORM_TASK_BASE = "Transform endpoints";

function findTaskByBaseName(tasks: Map<string, TaskBenchmarkResult>, baseName: string): TaskBenchmarkResult | undefined {
  for (const [taskName, taskResult] of tasks.entries()) {
    if (taskName.startsWith(baseName + " (")) {
      return taskResult;
    }
  }
  return undefined;
}

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

function formatCpuPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)}%`;
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

  const baselineCpuUser = baseline.resource?.cpu?.userPercent ?? null;
  const variantCpuUser = variant.resource?.cpu?.userPercent ?? null;
  const baselineCpuSystem = baseline.resource?.cpu?.systemPercent ?? null;
  const variantCpuSystem = variant.resource?.cpu?.systemPercent ?? null;
  const baselineCpuTotal = baseline.resource?.cpu?.totalPercent ?? null;
  const variantCpuTotal = variant.resource?.cpu?.totalPercent ?? null;

  return {
    label,
    throughputDeltaPct: percentageChange(baselineThroughput, variantThroughput),
    tailLatencyDeltaPct: percentageChange(baselineTail, variantTail),
    baselineThroughput,
    variantThroughput,
    baselineTail,
    variantTail,
    cpuUserDeltaPct: percentageChange(baselineCpuUser, variantCpuUser),
    cpuSystemDeltaPct: percentageChange(baselineCpuSystem, variantCpuSystem),
    cpuTotalDeltaPct: percentageChange(baselineCpuTotal, variantCpuTotal),
    baselineCpuTotal,
    variantCpuTotal,
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
  let count = 0;

  for (const [name, baselineTask] of Array.from(baselineTasks.entries())) {
    const variantTaskName = Array.from(variantTasks.keys()).find(vName =>
      vName.replace(/ \([^)]+\)$/, '') === name.replace(/ \([^)]+\)$/, '')
    );
    const variantTask = variantTaskName ? variantTasks.get(variantTaskName) : undefined;

    if (!baselineTask?.resource || !variantTask?.resource) {
      continue;
    }

    const baselineMem = baselineTask.resource.memory;
    const variantMem = variantTask.resource.memory;

    const avgRssDelta = variantMem.rss.avg - baselineMem.rss.avg;
    const maxRssDelta = variantMem.rss.max - baselineMem.rss.max;
    rssSum += avgRssDelta;
    rssMaxDelta = rssMaxDelta === null ? maxRssDelta : Math.max(rssMaxDelta, maxRssDelta);

    count++;
  }

  return {
    avgRssDelta: count ? rssSum / count : null,
    maxRssDelta: rssMaxDelta,
    avgHeapUsedDelta: null,
    maxHeapUsedDelta: null,
    samples: count,
  };
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


  console.log("\n## Benchmark Impact Summary\n");

  const cpuImpact = computeImpact(
    CPU_HEAVY_TASK_BASE,
    findTaskByBaseName(baselineTasks, CPU_HEAVY_TASK_BASE),
    findTaskByBaseName(activeTasks, CPU_HEAVY_TASK_BASE),
  );

  const ioImpact = computeImpact(
    IO_HEAVY_TASK_BASE,
    findTaskByBaseName(baselineTasks, IO_HEAVY_TASK_BASE),
    findTaskByBaseName(activeTasks, IO_HEAVY_TASK_BASE),
  );

  const transformImpact = transformTasks ? computeImpact(
    TRANSFORM_TASK_BASE,
    findTaskByBaseName(activeTasks, TRANSFORM_TASK_BASE),
    findTaskByBaseName(transformTasks, TRANSFORM_TASK_BASE),
  ) : null;

  // Print performance impact table
  console.log("| Workload | Throughput Δ | Tail Latency Δ | User CPU Δ |");
  console.log("|----------|-------------|---------------|-------------|");

  if (cpuImpact) {
    console.log(`| **CPU-bound** | ${formatPercentage(cpuImpact.throughputDeltaPct)} | ${formatPercentage(cpuImpact.tailLatencyDeltaPct)} | ${formatPercentage(cpuImpact.cpuUserDeltaPct)} |`);
  } else {
    console.log("| **CPU-bound** | N/A | N/A | N/A |");
  }

  if (ioImpact) {
    console.log(`| **IO-bound** | ${formatPercentage(ioImpact.throughputDeltaPct)} | ${formatPercentage(ioImpact.tailLatencyDeltaPct)} | ${formatPercentage(ioImpact.cpuUserDeltaPct)} |`);
  } else {
    console.log("| **IO-bound** | N/A | N/A | N/A |");
  }

  if (transformImpact) {
    console.log(`| **Transform endpoints** | ${formatPercentage(transformImpact.throughputDeltaPct)} | ${formatPercentage(transformImpact.tailLatencyDeltaPct)} | ${formatPercentage(transformImpact.cpuUserDeltaPct)} |`);
  } else {
    console.log("| **Transform endpoints** | N/A | N/A | N/A |");
  }

  // Print memory overhead table
  const activeMemory = computeMemoryOverhead(baseline, active);
  const transformMemory = transforms ? computeMemoryOverhead(baseline, transforms) : null;

  console.log("\n## Memory Overhead vs Baseline\n");
  console.log("| Configuration | Avg RSS Δ | Max RSS Δ |");
  console.log("|--------------|-----------|-----------|");

  if (activeMemory && activeMemory.samples > 0) {
    console.log(`| **SDK Active** | ${formatBytes(activeMemory.avgRssDelta)} | ${formatBytes(activeMemory.maxRssDelta)} |`);
  } else {
    console.log("| **SDK Active** | N/A | N/A |");
  }

  if (transformMemory && transformMemory.samples > 0) {
    console.log(`| **SDK Active w/ Transforms** | ${formatBytes(transformMemory.avgRssDelta)} | ${formatBytes(transformMemory.maxRssDelta)} |`);
  } else {
    console.log("| **SDK Active w/ Transforms** | N/A | N/A |");
  }

  console.log("\nSummary complete.\n");
}

main();
