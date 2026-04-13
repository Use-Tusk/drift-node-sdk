import { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { TuskDriftMode } from "../TuskDrift";
import { SpanTransformer } from "./SpanTransformer";
import { FilesystemSpanAdapter } from "./adapters/FilesystemSpanAdapter";
import { ApiSpanAdapter, ApiSpanAdapterHealthSnapshot } from "./adapters/ApiSpanAdapter";
import { logger } from "../utils/logger";
import { CleanSpanData, TD_INSTRUMENTATION_LIBRARY_NAME, TdSpanAttributes } from "../types";
import { TraceBlockingManager } from "./TraceBlockingManager";
import { SpanStatusCode } from "@opentelemetry/api";
import { SpanKind } from "@opentelemetry/api";

export interface TdTraceExporterConfig {
  baseDirectory: string;
  mode: TuskDriftMode;
  observableServiceId?: string;
  useRemoteExport: boolean;
  apiKey?: string;
  tuskBackendBaseUrl: string;
  environment?: string;
  sdkVersion: string;
  sdkInstanceId: string;
  exportTimeoutMillis: number;
}

/** A SpanExportAdapter defines the actual thing that exports to api/file/etc.
 * */
export interface SpanExportAdapter {
  name: string;
  exportSpans(spans: CleanSpanData[]): Promise<ExportResult>;
  shutdown(): Promise<void>;
}

export interface TdExporterHealthSnapshot {
  failureCount: number;
  timeoutCount: number;
  circuitOpen: boolean;
  lastExportLatencyMs: number | null;
}

export class TdSpanExporter implements SpanExporter {
  private mode: TuskDriftMode;
  private environment?: string;
  private adapters: SpanExportAdapter[] = [];

  constructor(config: TdTraceExporterConfig) {
    this.mode = config.mode;
    this.environment = config.environment;

    this.setupDefaultAdapters(config);

    logger.debug(`TdSpanExporter initialized with ${this.adapters.length} adapter(s)`);
  }

  private setupDefaultAdapters(config: TdTraceExporterConfig): void {
    if (config.useRemoteExport && config.apiKey && config.observableServiceId) {
      logger.debug("TdSpanExporter using API adapter");
      this.addAdapter(
        new ApiSpanAdapter({
          apiKey: config.apiKey,
          tuskBackendBaseUrl: config.tuskBackendBaseUrl,
          observableServiceId: config.observableServiceId,
          environment: config.environment,
          sdkVersion: config.sdkVersion,
          sdkInstanceId: config.sdkInstanceId,
          exportTimeoutMillis: config.exportTimeoutMillis,
        }),
      );
    } else {
      logger.debug("TdSpanExporter falling back to filesystem adapter");
      this.addAdapter(
        new FilesystemSpanAdapter({
          baseDirectory: config.baseDirectory,
        }),
      );
    }
  }

  getAdapters() {
    return this.adapters;
  }

  getHealthSnapshot(): TdExporterHealthSnapshot {
    const apiAdapterSnapshots = this.adapters
      .filter((adapter): adapter is ApiSpanAdapter => adapter instanceof ApiSpanAdapter)
      .map((adapter) => adapter.getHealthSnapshot());

    if (apiAdapterSnapshots.length === 0) {
      return {
        failureCount: 0,
        timeoutCount: 0,
        circuitOpen: false,
        lastExportLatencyMs: null,
      };
    }

    const aggregated = apiAdapterSnapshots.reduce<
      Omit<TdExporterHealthSnapshot, "lastExportLatencyMs">
    >(
      (accumulator, snapshot: ApiSpanAdapterHealthSnapshot) => ({
        failureCount: accumulator.failureCount + snapshot.failureCount,
        timeoutCount: accumulator.timeoutCount + snapshot.timeoutCount,
        circuitOpen: accumulator.circuitOpen || snapshot.circuitState === "open",
      }),
      {
        failureCount: 0,
        timeoutCount: 0,
        circuitOpen: false,
      },
    );
    const observedLatencies = apiAdapterSnapshots
      .map((snapshot) => snapshot.lastExportLatencyMs)
      .filter((latency): latency is number => latency !== null);

    return {
      ...aggregated,
      lastExportLatencyMs: observedLatencies.length > 0 ? Math.max(...observedLatencies) : null,
    };
  }

  /**
   * Add a custom export adapter
   */
  addAdapter(adapter: SpanExportAdapter): void {
    this.adapters.push(adapter);
    logger.debug(`Added ${adapter.name} adapter. Total adapters: ${this.adapters.length}`);
  }

  /**
   * Remove a specific adapter
   */
  removeAdapter(adapter: SpanExportAdapter): void {
    const index = this.adapters.indexOf(adapter);
    if (index > -1) {
      this.adapters.splice(index, 1);
      logger.debug(`Removed ${adapter.name} adapter. Total adapters: ${this.adapters.length}`);
    }
  }

  /**
   * Clear all adapters
   */
  clearAdapters(): void {
    this.adapters = [];
    logger.debug("All adapters cleared");
  }

  /**
   * Export spans using all configured adapters
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    this._exportAsync(spans).then(
      () => resultCallback({ code: ExportResultCode.SUCCESS }),
      (error) => resultCallback({ code: ExportResultCode.FAILED, error }),
    );
  }

  private async _exportAsync(spans: ReadableSpan[]): Promise<void> {
    if (this.mode !== TuskDriftMode.RECORD) {
      return;
    }

    logger.debug(`TdSpanExporter.export() called with ${spans.length} span(s)`);

    const traceBlockingManager = TraceBlockingManager.getInstance();

    const filteredSpansBasedOnLibraryName: ReadableSpan[] = spans.filter((span) => {
      // Only keep spans created from this SDK
      // This is set in getTracer in TuskDrift.ts
      if (span.instrumentationLibrary.name === TD_INSTRUMENTATION_LIBRARY_NAME) {
        return true;
      }
      return false;
    });

    logger.debug(
      `After filtering based on library name: ${filteredSpansBasedOnLibraryName.length} span(s) remaining`,
    );

    const MAX_SPAN_SIZE_MB = 1;
    const MAX_SPAN_SIZE_BYTES = MAX_SPAN_SIZE_MB * 1024 * 1024;

    const filteredBlockedSpans: ReadableSpan[] = filteredSpansBasedOnLibraryName.filter((span) => {
      const traceId = span.spanContext().traceId;

      // Early exit: if this trace is already blocked, skip this span
      if (traceBlockingManager.isTraceBlocked(traceId)) {
        logger.debug(
          `Skipping span '${span.name}' (${span.spanContext().spanId}) - trace ${traceId} is blocked`,
        );
        return false;
      }

      if (span.kind === SpanKind.SERVER && span.status.code === SpanStatusCode.ERROR) {
        traceBlockingManager.blockTrace(traceId);
        logger.debug(`Blocking trace ${traceId} - server span has error status`);
        return false;
      }

      const inputValueString = (span.attributes[TdSpanAttributes.INPUT_VALUE] as string) || "";
      const outputValueString = (span.attributes[TdSpanAttributes.OUTPUT_VALUE] as string) || "";

      // Calculate approximate size (input + output are the main contributors)
      // Add a small buffer for other attributes and metadata
      const inputSize = Buffer.byteLength(inputValueString, "utf8");
      const outputSize = Buffer.byteLength(outputValueString, "utf8");
      const estimatedTotalSize = inputSize + outputSize + 50000; // 50KB buffer for other data

      const estimatedSizeMB = estimatedTotalSize / (1024 * 1024);

      if (estimatedTotalSize > MAX_SPAN_SIZE_BYTES) {
        // Block this trace to prevent future spans from being created
        traceBlockingManager.blockTrace(traceId);

        logger.warn(
          `Blocking trace ${traceId} - span '${span.name}' (${span.spanContext().spanId}) has estimated size ${estimatedSizeMB.toFixed(2)} MB exceeding limit of ${MAX_SPAN_SIZE_MB} MB. Future spans for this trace will be prevented.`,
        );
        return false;
      }
      return true;
    });

    logger.debug(
      `Filtered ${filteredSpansBasedOnLibraryName.length - filteredBlockedSpans.length} blocked/oversized span(s), ${filteredBlockedSpans.length} remaining`,
    );

    // Yield the event loop between chunks to avoid blocking pool callbacks, timers, and I/O.
    const TRANSFORM_CHUNK_SIZE = 20;
    const cleanSpans: CleanSpanData[] = [];
    for (let i = 0; i < filteredBlockedSpans.length; i += TRANSFORM_CHUNK_SIZE) {
      const end = Math.min(i + TRANSFORM_CHUNK_SIZE, filteredBlockedSpans.length);
      for (let j = i; j < end; j++) {
        cleanSpans.push(
          SpanTransformer.transformSpanToCleanJSON(filteredBlockedSpans[j], this.environment),
        );
      }
      if (end < filteredBlockedSpans.length) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    if (this.adapters.length === 0) {
      return;
    }

    await Promise.all(this.adapters.map((adapter) => adapter.exportSpans(cleanSpans)));
  }

  /**
   * Shutdown all adapters
   */
  async shutdown(): Promise<void> {
    await Promise.all(this.adapters.map((adapter) => adapter.shutdown()));
  }

  /**
   * Force flush any pending spans
   */
  async forceFlush(): Promise<void> {
    // Most adapters write immediately, so nothing to flush
    return Promise.resolve();
  }
}
