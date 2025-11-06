import { TaskResourceStats } from "./result-utils";

interface ResourceMonitorOptions {
  intervalMs?: number;
  enableMemoryTracking?: boolean;
}

interface TaskStats {
  memory: {
    rssSum: number;
    rssMax: number;
  };
  startCpuUsage: NodeJS.CpuUsage;
  startTime: number;
  count: number;
}

export class ResourceMonitor {
  private taskStats: Map<string, TaskStats> = new Map();
  private intervalId: NodeJS.Timeout | null = null;
  private currentTaskName: string | null = null;
  private currentTaskStats: TaskStats | null = null;
  private isRunning: boolean = false;
  private options: Required<ResourceMonitorOptions>;

  constructor(options: ResourceMonitorOptions = {}) {
    this.options = {
      intervalMs: options.intervalMs ?? 100,
      enableMemoryTracking: options.enableMemoryTracking ?? true,
    };
  }

  start(): void {
    this.isRunning = true;

    if (this.options.enableMemoryTracking) {
      this.intervalId = setInterval(() => {
        this.collectMemorySample();
      }, this.options.intervalMs);
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  startTask(taskName: string): void {
    this.currentTaskName = taskName;
    const taskStats = {
      memory: {
        rssSum: 0,
        rssMax: 0,
      },
      startCpuUsage: process.cpuUsage(),
      startTime: Date.now(),
      count: 0,
    };
    this.taskStats.set(taskName, taskStats);
    this.currentTaskStats = taskStats;
  }

  endTask(): void {
    this.currentTaskName = null;
    this.currentTaskStats = null;
  }

  private collectMemorySample(): void {
    if (!this.isRunning || !this.currentTaskStats) return;

    const memoryUsage = process.memoryUsage();
    this.currentTaskStats.memory.rssSum += memoryUsage.rss;
    this.currentTaskStats.memory.rssMax = Math.max(
      this.currentTaskStats.memory.rssMax,
      memoryUsage.rss,
    );
    this.currentTaskStats.count++;
  }

  getTaskStats(taskName: string): TaskResourceStats | null {
    const stats = this.taskStats.get(taskName);
    if (!stats) {
      return null;
    }

    // Calculate total elapsed time from start to end
    const totalElapsedMs = Date.now() - stats.startTime;
    const totalElapsedMicroseconds = totalElapsedMs * 1000;

    // Get total CPU usage directly from start to now - no sampling needed!
    const totalCpuUsage = process.cpuUsage(stats.startCpuUsage);

    // Calculate CPU percentages using the direct measurement
    const userPercent =
      totalElapsedMicroseconds > 0 ? (totalCpuUsage.user / totalElapsedMicroseconds) * 100 : 0;
    const systemPercent =
      totalElapsedMicroseconds > 0 ? (totalCpuUsage.system / totalElapsedMicroseconds) * 100 : 0;
    const totalPercent = userPercent + systemPercent;

    return {
      cpu: {
        userPercent,
        systemPercent,
        totalPercent,
      },
      memory: {
        rss: stats.count > 0 ? {
          avg: stats.memory.rssSum / stats.count,
          max: stats.memory.rssMax,
        } : {
          avg: 0,
          max: 0,
        },
      },
    };
  }

  getAllTaskNames(): string[] {
    return Array.from(this.taskStats.keys());
  }
}
