import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import type { SpanExportAdapter } from "../TdSpanExporter";
import { CleanSpanData } from "../../types";
import { SpanExportServiceClient } from "@use-tusk/drift-schemas/backend/span_export_service.client";
import { ExportSpansRequest } from "@use-tusk/drift-schemas/backend/span_export_service";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { Span, PackageType, SpanKind as DriftSpanKind } from "@use-tusk/drift-schemas/core/span";
import { SpanKind as OtelSpanKind } from "@opentelemetry/api";
import { toStruct } from "../../utils/protobufUtils";
import { logger } from "../../utils/logger";

export interface ApiSpanAdapterConfig {
  apiKey: string;
  tuskBackendBaseUrl: string;
  observableServiceId: string;
  environment?: string;
  sdkVersion: string;
  sdkInstanceId: string;
}

const DRIFT_API_PATH = "/api/drift";

/**
 * Exports spans to Tusk backend API via protobuf
 */
export class ApiSpanAdapter implements SpanExportAdapter {
  readonly name = "api";
  private spanExportClient: SpanExportServiceClient;
  private observableServiceId: string;
  private environment?: string;
  private sdkVersion: string;
  private sdkInstanceId: string;

  constructor(config: ApiSpanAdapterConfig) {
    this.observableServiceId = config.observableServiceId;
    this.environment = config.environment;
    this.sdkVersion = config.sdkVersion;
    this.sdkInstanceId = config.sdkInstanceId;

    const transport = new TwirpFetchTransport({
      baseUrl: `${config.tuskBackendBaseUrl}${DRIFT_API_PATH}`,
      meta: {
        "x-api-key": config.apiKey,
        "x-td-skip-instrumentation": "true",
      },
    });
    this.spanExportClient = new SpanExportServiceClient(transport);

    logger.debug("ApiSpanAdapter initialized");
  }

  async exportSpans(spans: CleanSpanData[]): Promise<ExportResult> {
    try {
      // Transform spans to protobuf format
      const protoSpans: Span[] = spans.map((span) => this.transformSpanToProtobuf(span));

      const request: ExportSpansRequest = {
        observableServiceId: this.observableServiceId,
        environment: this.environment || "",
        sdkVersion: this.sdkVersion,
        sdkInstanceId: this.sdkInstanceId,
        spans: protoSpans,
      };

      const response = await this.spanExportClient.exportSpans(request);

      if (!response.response.success) {
        throw new Error(`Remote export failed: ${response.response.message}`);
      }

      logger.debug(`Successfully exported ${spans.length} spans to remote endpoint`);
      return { code: ExportResultCode.SUCCESS };
    } catch (error) {
      logger.error(`Failed to export spans to remote:`, error);
      return {
        code: ExportResultCode.FAILED,
        error: error instanceof Error ? error : new Error("API export failed"),
      };
    }
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
      packageType: cleanSpan.packageType || PackageType.UNSPECIFIED,
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
}
