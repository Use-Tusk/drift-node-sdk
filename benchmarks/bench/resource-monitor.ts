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

interface CompletedTaskStats {
  resourceStats: TaskResourceStats;
  endTime: number;
}

export class ResourceMonitor {
  private taskStats: Map<string, TaskStats> = new Map();
  private completedTaskStats: Map<string, CompletedTaskStats> = new Map();
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
    const startCpuUsage = process.cpuUsage();
    const startTime = Date.now();
    const taskStats = {
      memory: {
        rssSum: 0,
        rssMax: 0,
      },
      startCpuUsage,
      startTime,
      count: 0,
    };
    this.taskStats.set(taskName, taskStats);
    this.currentTaskStats = taskStats;
  }

  endTask(): void {
    if (this.currentTaskName && this.currentTaskStats) {
      const endTime = Date.now();
      const totalElapsedMs = endTime - this.currentTaskStats.startTime;
      const totalElapsedMicroseconds = totalElapsedMs * 1000;

      const totalCpuUsage = process.cpuUsage(this.currentTaskStats.startCpuUsage);

      const userPercent =
        totalElapsedMicroseconds > 0 ? (totalCpuUsage.user / totalElapsedMicroseconds) * 100 : 0;
      const systemPercent =
        totalElapsedMicroseconds > 0 ? (totalCpuUsage.system / totalElapsedMicroseconds) * 100 : 0;
      const totalPercent = userPercent + systemPercent;

      const resourceStats: TaskResourceStats = {
        cpu: {
          userPercent,
          systemPercent,
          totalPercent,
        },
        memory: {
          rss:
            this.currentTaskStats.count > 0
              ? {
                  avg: this.currentTaskStats.memory.rssSum / this.currentTaskStats.count,
                  max: this.currentTaskStats.memory.rssMax,
                }
              : {
                  avg: 0,
                  max: 0,
                },
        },
      };

      this.completedTaskStats.set(this.currentTaskName, {
        resourceStats,
        endTime,
      });
    }

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
    const completedStats = this.completedTaskStats.get(taskName);
    return completedStats ? completedStats.resourceStats : null;
  }

  getAllTaskNames(): string[] {
    return Array.from(this.completedTaskStats.keys());
  }
}
