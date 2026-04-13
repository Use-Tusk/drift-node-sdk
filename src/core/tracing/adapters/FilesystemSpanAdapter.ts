import * as fs from "fs";
import * as fsp from "fs/promises";
import * as path from "path";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { SpanExportAdapter } from "../TdSpanExporter";
import { CleanSpanData } from "../../types";
import { mapOtToPb } from "../../utils/protobufUtils";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import { logger } from "../../utils/logger";

export interface FilesystemSpanAdapterConfig {
  baseDirectory: string;
}

/**
 * Exports spans to local JSONL files organized by trace ID
 */
export class FilesystemSpanAdapter implements SpanExportAdapter {
  readonly name = "filesystem";
  private baseDirectory: string;
  private traceFileMap: Map<string, string> = new Map();

  constructor(config: FilesystemSpanAdapterConfig) {
    this.baseDirectory = config.baseDirectory;

    // Initialize file system
    if (!fs.existsSync(this.baseDirectory)) {
      fs.mkdirSync(this.baseDirectory, { recursive: true });
    }
  }

  async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {
    try {
      // Group spans by trace file so we do one write per file instead of one per span.
      const linesByFile = new Map<string, string[]>();

      for (const span of spans) {
        const traceId = span.traceId;

        let filePath = this.traceFileMap.get(traceId);
        if (!filePath) {
          const isoTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
          filePath = path.join(this.baseDirectory, `${isoTimestamp}_trace_${traceId}.jsonl`);
          this.traceFileMap.set(traceId, filePath);
        }

        let lines = linesByFile.get(filePath);
        if (!lines) {
          lines = [];
          linesByFile.set(filePath, lines);
        }
        lines.push(JSON.stringify({ ...span, kind: mapOtToPb(span.kind as OtSpanKind) }));
      }

      await Promise.all(
        Array.from(linesByFile.entries()).map(([filePath, lines]) =>
          fsp.appendFile(filePath, lines.join("\n") + "\n", "utf8"),
        ),
      );

      logger.debug(
        `Exported ${spans.length} span(s) to trace-specific files in ${this.baseDirectory}`,
      );

      return { code: ExportResultCode.SUCCESS };
    } catch (error) {
      logger.error(`Failed to export spans to local files:`, error);
      return {
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error("Filesystem export failed"),
      };
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for filesystem exporter
    return Promise.resolve();
  }
}
