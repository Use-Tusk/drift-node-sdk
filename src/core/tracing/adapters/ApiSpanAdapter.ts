import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { SpanExportAdapter } from "../TdSpanExporter";
import { CleanSpanData } from "../../types";
import {
  ExportSpansRequest,
  ExportSpansResponse,
} from "@use-tusk/drift-schemas/backend/span_export_service";
import { Span, PackageType, SpanKind as DriftSpanKind } from "@use-tusk/drift-schemas/core/span";
import { SpanKind as OtelSpanKind } from "@opentelemetry/api";
import { toStruct } from "../../utils/protobufUtils";
import { logger } from "../../utils/logger";
import { buildExportSpansRequestBytes } from "../../rustCoreBinding";
import {
  CircuitBreaker,
  CircuitState,
  NonRetryableError,
  withRetries,
} from "./resilience";

export interface ApiSpanAdapterConfig {
  apiKey: string;
  tuskBackendBaseUrl: string;
  observableServiceId: string;
  environment?: string;
  sdkVersion: string;
  sdkInstanceId: string;
  exportTimeoutMillis: number;
}

const DRIFT_API_PATH = "/api/drift";

export interface ApiSpanAdapterHealthSnapshot {
  failureCount: number;
  timeoutCount: number;
  circuitState: CircuitState;
  lastExportLatencyMs: number | null;
}

/**
 * Exports spans to Tusk backend API via protobuf
 */
export class ApiSpanAdapter implements SpanExportAdapter {
  readonly name = "api";
  private apiKey: string;
  private tuskBackendBaseUrl: string;
  private observableServiceId: string;
  private environment?: string;
  private sdkVersion: string;
  private sdkInstanceId: string;
  private exportTimeoutMillis: number;
  private circuitBreaker: CircuitBreaker;
  private failureCount = 0;
  private timeoutCount = 0;
  private lastExportLatencyMs: number | null = null;

  constructor(config: ApiSpanAdapterConfig) {
    this.apiKey = config.apiKey;
    this.tuskBackendBaseUrl = config.tuskBackendBaseUrl;
    this.observableServiceId = config.observableServiceId;
    this.environment = config.environment;
    this.sdkVersion = config.sdkVersion;
    this.sdkInstanceId = config.sdkInstanceId;
    this.exportTimeoutMillis = config.exportTimeoutMillis;
    this.circuitBreaker = new CircuitBreaker({
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    });

    logger.debug("ApiSpanAdapter initialized");
  }

  async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {
    if (!this.circuitBreaker.allowRequest()) {
      const error = new Error("Remote export circuit breaker is open");
      logger.warn(error.message);
      return {
        code: ExportResultCode.FAILED,
        error,
      };
    }

    const startedAtMs = Date.now();

    try {
      const requestBytes = this.buildRequestBytes(spans);
      await withRetries(
        () => this.postExportRequest(requestBytes),
        {
          maxAttempts: 3,
          initialDelayMs: 500,
          maxDelayMs: 4000,
        },
      );

      this.circuitBreaker.recordSuccess();
      this.lastExportLatencyMs = Date.now() - startedAtMs;
      logger.debug(`Successfully exported ${spans.length} spans to remote endpoint`);
      return { code: ExportResultCode.SUCCESS };
    } catch (error) {
      this.failureCount += 1;
      this.lastExportLatencyMs = Date.now() - startedAtMs;
      this.circuitBreaker.recordFailure();
      logger.error(`Failed to export spans to remote:`, error);
      return {
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error("API export failed"),
      };
    }
  }

  getHealthSnapshot(): ApiSpanAdapterHealthSnapshot {
    return {
      failureCount: this.failureCount,
      timeoutCount: this.timeoutCount,
      circuitState: this.circuitBreaker.getState(),
      lastExportLatencyMs: this.lastExportLatencyMs,
    };
  }

  private transformSpanToProtobuf(cleanSpan: CleanSpanData): Span {
    return {
      traceId: cleanSpan.traceId,
      spanId: cleanSpan.spanId,
      parentSpanId: cleanSpan.parentSpanId,
      name: cleanSpan.name,
      packageName: cleanSpan.packageName,
      instrumentationName: cleanSpan.instrumentationName,
      submoduleName: cleanSpan.submoduleName,
      packageType: cleanSpan.packageType ?? PackageType.UNSPECIFIED,
      environment: this.environment,
      inputValue: toStruct(cleanSpan.inputValue),
      outputValue: toStruct(cleanSpan.outputValue),
      inputSchema: cleanSpan.inputSchema,
      outputSchema: cleanSpan.outputSchema,
      inputSchemaHash: cleanSpan.inputSchemaHash || "",
      outputSchemaHash: cleanSpan.outputSchemaHash || "",
      inputValueHash: cleanSpan.inputValueHash || "",
      outputValueHash: cleanSpan.outputValueHash || "",
      kind: this.mapSpanKind(cleanSpan.kind),
      status: cleanSpan.status,
      isPreAppStart: cleanSpan.isPreAppStart,
      timestamp: { seconds: BigInt(cleanSpan.timestamp.seconds), nanos: cleanSpan.timestamp.nanos },
      duration: { seconds: BigInt(cleanSpan.duration.seconds), nanos: cleanSpan.duration.nanos },
      isRootSpan: cleanSpan.isRootSpan,
      metadata: toStruct(cleanSpan.metadata),
    };
  }

  private mapSpanKind(kind: OtelSpanKind): DriftSpanKind {
    switch (kind) {
      case OtelSpanKind.CLIENT:
        return DriftSpanKind.CLIENT;
      case OtelSpanKind.SERVER:
        return DriftSpanKind.SERVER;
      case OtelSpanKind.PRODUCER:
        return DriftSpanKind.PRODUCER;
      case OtelSpanKind.CONSUMER:
        return DriftSpanKind.CONSUMER;
      case OtelSpanKind.INTERNAL:
        return DriftSpanKind.INTERNAL;
      default:
        return DriftSpanKind.UNSPECIFIED;
    }
  }

  async shutdown(): Promise<void> {
    // No cleanup needed for API exporter
    return Promise.resolve();
  }

  private buildRequestBytes(spans: CleanSpanData[]): Uint8Array {
    const rustRequestBytes = buildExportSpansRequestBytes(
      this.observableServiceId,
      this.environment || "",
      this.sdkVersion,
      this.sdkInstanceId,
      spans.map((span) => span.protoSpanBytes).filter((value): value is Buffer => Buffer.isBuffer(value)),
    );
    const allSpansHavePrebuiltBytes =
      spans.length > 0 && spans.every((span) => Buffer.isBuffer(span.protoSpanBytes));

    if (allSpansHavePrebuiltBytes && rustRequestBytes) {
      return new Uint8Array(rustRequestBytes);
    }

    const protoSpans: Span[] = spans.map((span) => this.transformSpanToProtobuf(span));
    const request: ExportSpansRequest = {
      observableServiceId: this.observableServiceId,
      environment: this.environment || "",
      sdkVersion: this.sdkVersion,
      sdkInstanceId: this.sdkInstanceId,
      spans: protoSpans,
    };
    return ExportSpansRequest.toBinary(request);
  }

  private async postExportRequest(requestBytes: Uint8Array): Promise<void> {
    const controller = new AbortController();
    const timeoutError = new Error("Remote export timed out");
    const timeout = setTimeout(() => {
      controller.abort(timeoutError);
    }, this.exportTimeoutMillis);

    try {
      const response = await fetch(
        `${this.tuskBackendBaseUrl}${DRIFT_API_PATH}/tusk.drift.backend.v1.SpanExportService/ExportSpans`,
        {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "x-td-skip-instrumentation": "true",
            "Content-Type": "application/protobuf",
            Accept: "application/protobuf",
          },
          body: Buffer.from(requestBytes),
          signal: controller.signal,
        },
      );

      if (response.status >= 500) {
        throw new Error(`Remote export failed with status ${response.status}`);
      }

      if (response.status !== 200) {
        throw new NonRetryableError(`Remote export failed with status ${response.status}`);
      }

      const responseBytes = new Uint8Array(await response.arrayBuffer());
      const parsed = ExportSpansResponse.fromBinary(responseBytes);
      if (!parsed.success) {
        throw new Error(`Remote export failed: ${parsed.message}`);
      }
    } catch (error) {
      if (error === timeoutError || (error instanceof Error && error.name === "AbortError")) {
        this.timeoutCount += 1;
        throw error;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
