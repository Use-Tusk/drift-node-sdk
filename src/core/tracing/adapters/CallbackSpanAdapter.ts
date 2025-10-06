import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { SpanExportAdapter } from "../TdSpanExporter";
import { CleanSpanData } from "../../types";
import { logger } from "../../utils/logger";

export type SpanExportCallback = (spans: CleanSpanData[]) => void | Promise<void>;

/**
 * Exports spans via a callback function - useful for custom span processing
 */
export class CallbackSpanAdapter implements SpanExportAdapter {
  readonly name = "callback";
  private callback: SpanExportCallback;

  constructor(callback: SpanExportCallback) {
    this.callback = callback;
  }

  async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {
    try {
      await this.callback(spans);
      return { code: ExportResultCode.SUCCESS };
    } catch (error) {
      logger.error("Error in callback span export:", error);
      return {
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error("Callback export failed"),
      };
    }
  }

  async shutdown(): Promise<void> {
    return Promise.resolve();
  }
}
