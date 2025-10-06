import { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { TuskDriftMode } from "../TuskDrift";
import { SpanTransformer } from "./SpanTransformer";
import { FilesystemSpanAdapter } from "./adapters/FilesystemSpanAdapter";
import { ApiSpanAdapter } from "./adapters/ApiSpanAdapter";
import { logger } from "../utils/logger";
import { CleanSpanData } from "../types";

export interface TdTraceExporterConfig {
  baseDirectory: string;
  mode: TuskDriftMode;
  observableServiceId?: string;
  useRemoteExport: boolean;
  apiKey?: string;
  tuskBackendBaseUrl: string;
  environment: string;
  sdkVersion: string;
  sdkInstanceId: string;
}

/** A SpanExportAdapter defines the actual thing that exports to api/file/etc.
 * */
export interface SpanExportAdapter {
  name: string;
  exportSpans(spans: CleanSpanData[]): Promise<ExportResult>;
  shutdown(): Promise<void>;
}

export class TdSpanExporter implements SpanExporter {
  private mode: TuskDriftMode;
  private adapters: SpanExportAdapter[] = [];

  constructor(config: TdTraceExporterConfig) {
    this.mode = config.mode;

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
   * Set the mode for determining which adapters to run
   */
  setMode(mode: TuskDriftMode): void {
    this.mode = mode;
  }

  /**
   * Export spans using all configured adapters
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    logger.debug(`TdSpanExporter.export() called with ${spans.length} span(s)`);

    // Transform spans to CleanSpanData
    const cleanSpans = spans.map((span) => SpanTransformer.transformSpanToCleanJSON(span));

    if (this.adapters.length === 0) {
      logger.debug("No adapters configured");
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Filter adapters based on mode
    const activeAdapters = this.getActiveAdapters();

    if (activeAdapters.length === 0) {
      logger.debug(`No active adapters for mode: ${this.mode}`);
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Export to all active adapters
    Promise.all(activeAdapters.map((adapter) => adapter.exportSpans(cleanSpans)))
      .then(() => resultCallback({ code: ExportResultCode.SUCCESS }))
      .catch((error) => resultCallback({ code: ExportResultCode.FAILED, error }));
  }

  private getActiveAdapters(): SpanExportAdapter[] {
    if (this.mode !== TuskDriftMode.RECORD) {
      // In non-RECORD mode, only run in-memory and callback adapters
      return this.adapters.filter(
        (adapter) => adapter.name === "in-memory" || adapter.name === "callback",
      );
    }

    // In RECORD mode, run all adapters
    return this.adapters;
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
