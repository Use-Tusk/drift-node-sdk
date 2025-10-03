import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { CleanSpanData } from "../../types";
import { SpanKind } from "@opentelemetry/api";
import type { TdSpanExporter } from "../TdSpanExporter";
import type { SpanExportAdapter } from "../TdSpanExporter";
import { TuskDriftCore } from "../../TuskDrift";

/**
 * Stores spans in memory - useful for testing. See helpers below.
 */
export class InMemorySpanAdapter implements SpanExportAdapter {
  readonly name = "in-memory";
  private spans: CleanSpanData[] = [];

  collectSpan(span: CleanSpanData): void {
    this.spans.push(span);
  }

  getAllSpans(): CleanSpanData[] {
    return [...this.spans];
  }

  getSpansByInstrumentation(instrumentationName: string): CleanSpanData[] {
    return this.spans.filter((span) => span.instrumentationName.includes(instrumentationName));
  }

  getSpansByKind(kind: SpanKind): CleanSpanData[] {
    return this.spans.filter((span) => span.kind === kind);
  }

  clear(): void {
    this.spans = [];
  }

  async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {
    for (const span of spans) {
      this.collectSpan(span);
    }
    return { code: ExportResultCode.SUCCESS };
  }

  async shutdown(): Promise<void> {
    this.clear();
    return Promise.resolve();
  }
}

const registeredAdapters: InMemorySpanAdapter[] = [];

function getSpanExporter(): TdSpanExporter | undefined {
  const tuskDrift = TuskDriftCore.getInstance() as unknown as { spanExporter?: TdSpanExporter };
  return tuskDrift.spanExporter;
}

/** Clears *all* other adapters and registers the in memory adapter. Probably
 * only useful for testing. */
export function registerInMemoryAdapter(adapter: InMemorySpanAdapter): void {
  const spanExporter = getSpanExporter();

  clearRegisteredInMemoryAdapters();

  registeredAdapters.push(adapter);
  spanExporter?.addAdapter(adapter);
}

export function unregisterInMemoryAdapter(adapter: InMemorySpanAdapter): void {
  const spanExporter = getSpanExporter();
  const index = registeredAdapters.indexOf(adapter);

  if (index === -1) {
    return;
  }

  registeredAdapters.splice(index, 1);
  spanExporter?.removeAdapter(adapter);
}

export function clearRegisteredInMemoryAdapters(): void {
  const spanExporter = getSpanExporter();

  if (spanExporter) {
    for (const adapter of registeredAdapters) {
      spanExporter.removeAdapter(adapter);
    }
  }

  registeredAdapters.length = 0;
}

export function getRegisteredInMemoryAdapterCount(): number {
  return registeredAdapters.length;
}
