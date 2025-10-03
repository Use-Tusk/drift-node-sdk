import * as fs from "fs";
import * as path from "path";
import { SpanExporter, ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { ExportResult, ExportResultCode } from "@opentelemetry/core";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import { JsonSchemaHelper, JsonSchema, JsonSchemaType } from "./JsonSchemaHelper";
import { TuskDriftMode } from "../TuskDrift";
import { CleanSpanData, MetadataObject, TdSpanAttributes } from "../types";
import { PackageType, StatusCode } from "@use-tusk/drift-schemas/core/span";
import { SpanExportServiceClient } from "@use-tusk/drift-schemas/backend/span_export_service.client";
import { ExportSpansRequest } from "@use-tusk/drift-schemas/backend/span_export_service";
import { TwirpFetchTransport } from "@protobuf-ts/twirp-transport";
import { Span } from "@use-tusk/drift-schemas/core/span";
import { logger, OriginalGlobalUtils, mapOtToPb, toStruct } from "../utils";

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

const DRIFT_API_PATH = "/api/drift";

/**
 * If useRemoteExport is true, TdTraceExporter exports spans to a remote endpoint via protobuf.
 * If useRemoteExport is false, TdTraceExporter stores spans organized by trace ID in separate files.
 *  - Each trace gets its own JSONL file: `{baseDirectory}/{timestamp}_trace_{traceId}.jsonl`.
 */
export class TdSpanExporter implements SpanExporter {
  private baseDirectory: string;
  private mode: TuskDriftMode;
  private traceFileMap: Map<string, string> = new Map();

  // Remote export properties
  private useRemoteExport: boolean;
  private spanExportClient: SpanExportServiceClient;
  private observableServiceId?: string;
  private tuskBackendBaseUrl: string;
  private apiKey?: string;
  private environment: string;
  private sdkVersion: string;
  private sdkInstanceId: string;

  constructor(config: TdTraceExporterConfig) {
    this.baseDirectory = config.baseDirectory;
    this.mode = config.mode;
    this.useRemoteExport = config.useRemoteExport;
    this.observableServiceId = config.observableServiceId;
    this.apiKey = config.apiKey;
    this.tuskBackendBaseUrl = config.tuskBackendBaseUrl;
    this.environment = config.environment;
    this.sdkVersion = config.sdkVersion;
    this.sdkInstanceId = config.sdkInstanceId;

    // Initialize file system for local development
    if (!fs.existsSync(this.baseDirectory)) {
      fs.mkdirSync(this.baseDirectory, { recursive: true });
    }

    // Initialize protobuf client for remote export
    if (this.useRemoteExport && this.apiKey) {
      const transport = new TwirpFetchTransport({
        baseUrl: `${this.tuskBackendBaseUrl}${DRIFT_API_PATH}`,
        meta: {
          "x-api-key": this.apiKey,
          "x-td-skip-instrumentation": "true",
        },
      });
      this.spanExportClient = new SpanExportServiceClient(transport);
    }

    logger.debug(
      `TdTraceExporter initialized - ${this.useRemoteExport ? "remote export enabled" : "local file export only"}`,
    );
  }

  /**
   * Export spans to trace-specific files and optionally to remote endpoint
   */
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    logger.debug(`TdTraceExporter.export() called with ${spans.length} span(s)`);

    if (this.mode !== TuskDriftMode.RECORD) {
      logger.debug(`Not recording spans in tuskDriftMode: ${this.mode}`);
      resultCallback({ code: ExportResultCode.SUCCESS });
      return;
    }

    // Additionally export to remote endpoint if configured
    if (this.useRemoteExport) {
      if (this.spanExportClient) {
        this.exportToRemote(spans)
          .then(() => {
            logger.debug(`Successfully exported ${spans.length} spans to remote endpoint`);
            resultCallback({ code: ExportResultCode.SUCCESS });
          })
          .catch((error) => {
            logger.error(`Failed to export spans to remote:`, error);
            resultCallback({
              code: ExportResultCode.FAILED,
              error: error instanceof Error ? error : new Error("Remote export failed"),
            });
          });
      } else {
        logger.error("Remote export client not initialized, likely because apiKey is not provided");
        resultCallback({
          code: ExportResultCode.FAILED,
          error: new Error(
            "Remote export client not initialized, likely because apiKey is not provided",
          ),
        });
      }
    } else {
      this.exportToLocalFiles(spans);
      resultCallback({ code: ExportResultCode.SUCCESS });
    }
  }

  /**
   * Export spans to remote endpoint via protobuf
   */
  private async exportToRemote(spans: ReadableSpan[]): Promise<void> {
    if (!this.spanExportClient) {
      throw new Error("Remote export client not initialized");
    }

    if (!this.observableServiceId) {
      throw new Error("Observable service ID not provided in config");
    }

    // Transform spans to protobuf format
    const protoSpans: Span[] = spans.map((span) => this.transformSpanToProtobuf(span));

    const request: ExportSpansRequest = {
      observableServiceId: this.observableServiceId,
      environment: this.environment,
      sdkVersion: this.sdkVersion,
      sdkInstanceId: this.sdkInstanceId,
      spans: protoSpans,
    };

    const response = await this.spanExportClient.exportSpans(request);

    if (!response.response.success) {
      throw new Error(`Remote export failed: ${response.response.message}`);
    }
  }

  /**
   * Export spans to local files
   */
  private exportToLocalFiles(spans: ReadableSpan[]): void {
    try {
      for (const span of spans) {
        const traceId = span.spanContext().traceId;
        const spanData = this.transformSpanToCleanJSON(span);

        // Get or create file path for this trace ID
        let filePath = this.traceFileMap.get(traceId);

        if (!filePath) {
          const isoTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
          filePath = path.join(this.baseDirectory, `${isoTimestamp}_trace_${traceId}.jsonl`);
          this.traceFileMap.set(traceId, filePath);
        }

        const jsonLine = JSON.stringify(spanData) + "\n";
        fs.appendFileSync(filePath, jsonLine, "utf8");
      }

      logger.debug(
        `Exported ${spans.length} span(s) to trace-specific files in ${this.baseDirectory}`,
      );
    } catch (error) {
      logger.error(`Failed to export spans to local files:`, error);
      throw error;
    }
  }

  /**
   * Transform OpenTelemetry span to clean JSON format with compile-time type safety
   * Return type is derived from protobuf schema but uses clean JSON.
   * We use JSON because serialized protobuf is extremely verbose and not readable.
   */
  private transformSpanToCleanJSON(span: ReadableSpan): CleanSpanData {
    const isRootSpan = !span.parentSpanId || span.kind === OtSpanKind.SERVER;

    // Extract data from span attributes
    const attributes = span.attributes;
    const packageName = this.extractPackageName(attributes);
    const instrumentationName = this.extractInstrumentationName(span, attributes);
    const submoduleName = this.extractSubmoduleName(attributes);

    // Process input data
    const inputValueString = attributes[TdSpanAttributes.INPUT_VALUE] as string;
    const inputData = JSON.parse(inputValueString);

    // Extract input schema merges if they exist
    const inputSchemaMergesString = attributes[TdSpanAttributes.INPUT_SCHEMA_MERGES] as string;
    const inputSchemaMerges = inputSchemaMergesString
      ? JSON.parse(inputSchemaMergesString)
      : undefined;

    const { schema: inputSchema, decodedValueHash: inputValueHash } =
      JsonSchemaHelper.generateSchemaAndHash(inputData, inputSchemaMerges);

    // Process output data
    let outputData: any = {};
    let outputSchema: JsonSchema = { type: JsonSchemaType.OBJECT, properties: {} };
    let outputValueHash: string = "";

    if (attributes[TdSpanAttributes.OUTPUT_VALUE]) {
      const outputValueString = attributes[TdSpanAttributes.OUTPUT_VALUE] as string;
      outputData = JSON.parse(outputValueString);

      // Extract output schema merges if they exist
      const outputSchemaMergesString = attributes[TdSpanAttributes.OUTPUT_SCHEMA_MERGES] as string;
      const outputSchemaMerges = outputSchemaMergesString
        ? JSON.parse(outputSchemaMergesString)
        : undefined;

      ({ schema: outputSchema, decodedValueHash: outputValueHash } =
        JsonSchemaHelper.generateSchemaAndHash(outputData, outputSchemaMerges));
    } else {
      ({ schema: outputSchema, decodedSchemaHash: outputValueHash } =
        JsonSchemaHelper.generateSchemaAndHash(outputData));
    }

    let metadata: MetadataObject | undefined = undefined;
    if (attributes[TdSpanAttributes.METADATA]) {
      metadata = JSON.parse(attributes[TdSpanAttributes.METADATA] as string);
    }

    let transformMetadata;
    const transformMetadataString = attributes[TdSpanAttributes.TRANSFORM_METADATA] as
      | string
      | undefined;
    if (transformMetadataString) {
      try {
        transformMetadata = JSON.parse(transformMetadataString);
      } catch (error) {
        logger.warn("Failed to parse transform metadata", error);
      }
    }

    const originalDate = OriginalGlobalUtils.getOriginalDate();

    return {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanId || "",

      name: attributes[TdSpanAttributes.NAME] as string,

      packageName,
      instrumentationName,
      submoduleName: submoduleName || "",

      packageType: (attributes[TdSpanAttributes.PACKAGE_TYPE] as PackageType) || undefined,

      inputValue: inputData,
      outputValue: outputData,
      inputSchema,
      outputSchema,

      inputSchemaHash: JsonSchemaHelper.generateDeterministicHash(inputSchema),
      outputSchemaHash: JsonSchemaHelper.generateDeterministicHash(outputSchema),
      inputValueHash,
      outputValueHash,

      kind: span.kind,

      status: {
        code: span.status.code === 1 ? StatusCode.OK : StatusCode.ERROR,
        message: span.status.message || "",
      },

      isPreAppStart: attributes[TdSpanAttributes.IS_PRE_APP_START] === true,

      timestamp: {
        seconds: Math.floor(originalDate.getTime() / 1000),
        nanos: (originalDate.getTime() % 1000) * 1000000,
      },
      duration: {
        seconds: span.duration[0],
        nanos: span.duration[1],
      },
      isRootSpan,
      metadata,
      transformMetadata,
    } satisfies CleanSpanData;
  }

  /**
   * Transform OpenTelemetry span to protobuf format
   */
  private transformSpanToProtobuf(span: ReadableSpan): Span {
    // Convert CleanSpanData to protobuf Span format
    const cleanSpan = this.transformSpanToCleanJSON(span);

    return {
      traceId: cleanSpan.traceId,
      spanId: cleanSpan.spanId,
      parentSpanId: cleanSpan.parentSpanId,
      name: cleanSpan.name,
      packageName: cleanSpan.packageName,
      instrumentationName: cleanSpan.instrumentationName,
      submoduleName: cleanSpan.submoduleName,
      packageType: cleanSpan.packageType || PackageType.UNSPECIFIED,
      inputValue: toStruct(cleanSpan.inputValue),
      outputValue: toStruct(cleanSpan.outputValue),
      inputSchema: toStruct(cleanSpan.inputSchema),
      outputSchema: toStruct(cleanSpan.outputSchema),
      inputSchemaHash: cleanSpan.inputSchemaHash || "",
      outputSchemaHash: cleanSpan.outputSchemaHash || "",
      inputValueHash: cleanSpan.inputValueHash || "",
      outputValueHash: cleanSpan.outputValueHash || "",
      kind: mapOtToPb(span.kind as OtSpanKind),
      status: cleanSpan.status,
      isPreAppStart: cleanSpan.isPreAppStart,
      timestamp: { seconds: BigInt(cleanSpan.timestamp.seconds), nanos: cleanSpan.timestamp.nanos },
      duration: { seconds: BigInt(cleanSpan.duration.seconds), nanos: cleanSpan.duration.nanos },
      isRootSpan: cleanSpan.isRootSpan,
      metadata: toStruct(cleanSpan.metadata),
    };
  }

  /**
   * Extract package name from attributes or instrumentation library
   */
  private extractPackageName(attributes: any): string {
    // Check for explicit package name in attributes
    if (attributes[TdSpanAttributes.PACKAGE_NAME]) {
      return attributes[TdSpanAttributes.PACKAGE_NAME] as string;
    }

    return "unknown";
  }

  /**
   * Extract instrumentation name from span data
   */
  private extractInstrumentationName(span: ReadableSpan, attributes: any): string {
    // Check for explicit instrumentation name in attributes
    if (attributes[TdSpanAttributes.INSTRUMENTATION_NAME]) {
      return attributes[TdSpanAttributes.INSTRUMENTATION_NAME] as string;
    }

    // Generate from library name or type
    if (span.instrumentationLibrary?.name) {
      return `tusk-instrumentation-${span.instrumentationLibrary.name}`;
    }

    // Generate from detected package
    const packageName = this.extractPackageName(attributes);
    return `tusk-instrumentation-${packageName}`;
  }

  /**
   * Extract submodule name from attributes
   */
  private extractSubmoduleName(attributes: any): string | undefined {
    // Check for explicit submodule in attributes
    if (attributes[TdSpanAttributes.SUBMODULE_NAME]) {
      return attributes[TdSpanAttributes.SUBMODULE_NAME] as string;
    }

    return undefined;
  }

  /**
   * Shutdown the exporter
   */
  async shutdown(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Force flush any pending spans
   */
  async forceFlush(): Promise<void> {
    // File-based exporter writes immediately, so nothing to flush
    return Promise.resolve();
  }
}
