import type { Context, Span } from "@opentelemetry/api";
import { ExportResultCode } from "@opentelemetry/core";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { TuskDriftMode } from "../TuskDrift";
import { logger } from "../utils/logger";
import { TdSpanExporter } from "./TdSpanExporter";

export interface DriftBatchSpanProcessorConfig {
  maxQueueSize: number;
  maxExportBatchSize: number;
  scheduledDelayMillis: number;
}

export interface DriftBatchProcessorHealthSnapshot {
  queueSize: number;
  maxQueueSize: number;
  queueFillRatio: number;
  droppedSpanCount: number;
  exportFailureCount: number;
  lastExportLatencyMs: number | null;
}

export class DriftBatchSpanProcessor implements SpanProcessor {
  private readonly exporter: TdSpanExporter;
  private readonly config: DriftBatchSpanProcessorConfig;
  private readonly mode: TuskDriftMode;
  private readonly queue: ReadableSpan[] = [];

  private interval: NodeJS.Timeout;
  private flushPromise: Promise<void> | null = null;
  private flushRequested = false;
  private stopped = false;

  private droppedSpanCount = 0;
  private exportFailureCount = 0;
  private lastExportLatencyMs: number | null = null;

  constructor({
    exporter,
    config,
    mode,
  }: {
    exporter: TdSpanExporter;
    config: DriftBatchSpanProcessorConfig;
    mode: TuskDriftMode;
  }) {
    this.exporter = exporter;
    this.config = config;
    this.mode = mode;
    this.interval = setInterval(() => {
      this.flushOneBatchSafely();
    }, this.config.scheduledDelayMillis);
    this.interval.unref?.();
  }

  onStart(_span: Span, _parentContext: Context): void {}

  onEnd(span: ReadableSpan): void {
    if (this.stopped || this.mode !== TuskDriftMode.RECORD) {
      return;
    }

    if (this.queue.length >= this.config.maxQueueSize) {
      this.droppedSpanCount += 1;
      if (this.droppedSpanCount <= 5 || this.droppedSpanCount % 100 === 0) {
        logger.warn(
          `DriftBatchSpanProcessor queue full (${this.config.maxQueueSize}), dropping span. droppedSpans=${this.droppedSpanCount}`,
        );
      }
      return;
    }

    this.queue.push(span);
    if (this.queue.length >= this.config.maxExportBatchSize) {
      this.requestFlushSoon();
    }
  }

  forceFlush(): Promise<void> {
    return this.drainQueue();
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    clearInterval(this.interval);
    await this.drainQueue();
    await this.exporter.shutdown();
  }

  getHealthSnapshot(): DriftBatchProcessorHealthSnapshot {
    return {
      queueSize: this.queue.length,
      maxQueueSize: this.config.maxQueueSize,
      queueFillRatio:
        this.config.maxQueueSize > 0 ? this.queue.length / this.config.maxQueueSize : 0,
      droppedSpanCount: this.droppedSpanCount,
      exportFailureCount: this.exportFailureCount,
      lastExportLatencyMs: this.lastExportLatencyMs,
    };
  }

  private requestFlushSoon(): void {
    if (this.flushRequested) {
      return;
    }
    this.flushRequested = true;
    queueMicrotask(() => {
      this.flushRequested = false;
      this.flushOneBatchSafely();
    });
  }

  private flushOneBatchSafely(): void {
    void this.flushOneBatch().catch((error) => {
      logger.error(
        `DriftBatchSpanProcessor flush failed: ${error instanceof Error ? error.message : "unknown error"}`,
        error,
      );
    });
  }

  private async drainQueue(): Promise<void> {
    while (this.queue.length > 0 || this.flushPromise) {
      await this.flushOneBatch();
      if (this.flushPromise) {
        await this.flushPromise;
      }
    }
  }

  private async flushOneBatch(): Promise<void> {
    if (this.flushPromise || this.queue.length === 0) {
      return this.flushPromise ?? Promise.resolve();
    }

    const batch = this.queue.splice(0, this.config.maxExportBatchSize);
    const startedAtMs = Date.now();

    this.flushPromise = new Promise<void>((resolve) => {
      try {
        this.exporter.export(batch, (result) => {
          this.lastExportLatencyMs = Date.now() - startedAtMs;

          if (result.code === ExportResultCode.FAILED) {
            this.exportFailureCount += 1;
            logger.warn(
              `DriftBatchSpanProcessor export failed for batch of ${batch.length} span(s): ${result.error instanceof Error ? result.error.message : "unknown error"}`,
            );
          }

          resolve();
        });
      } catch (error) {
        this.lastExportLatencyMs = Date.now() - startedAtMs;
        this.exportFailureCount += 1;
        logger.warn(
          `DriftBatchSpanProcessor export threw synchronously for batch of ${batch.length} span(s): ${error instanceof Error ? error.message : "unknown error"}`,
        );
        resolve();
      }
    }).finally(() => {
      this.flushPromise = null;
      if (!this.stopped && this.queue.length >= this.config.maxExportBatchSize) {
        this.requestFlushSoon();
      }
    });

    return this.flushPromise;
  }
}
