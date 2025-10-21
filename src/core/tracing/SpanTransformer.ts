import { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import { JsonSchemaHelper, JsonSchemaType, JsonSchema } from "./JsonSchemaHelper";
import { CleanSpanData, MetadataObject, TdSpanAttributes } from "../types";
import { PackageType, StatusCode } from "@use-tusk/drift-schemas/core/span";
import { logger, OriginalGlobalUtils } from "../utils";

/**
 * Utility class for transforming OpenTelemetry spans to CleanSpanData
 */
export class SpanTransformer {
  /**
   * Transform OpenTelemetry span to clean JSON format with compile-time type safety
   * Return type is derived from protobuf schema but uses clean JSON.
   * We use JSON because serialized protobuf is extremely verbose and not readable.
   */
  static transformSpanToCleanJSON(span: ReadableSpan): CleanSpanData {
    const isRootSpan = !span.parentSpanId || span.kind === OtSpanKind.SERVER;

    // Extract data from span attributes
    const attributes = span.attributes;
    const packageName = SpanTransformer.extractPackageName(attributes);
    const instrumentationName = SpanTransformer.extractInstrumentationName(span, attributes);
    const submoduleName = SpanTransformer.extractSubmoduleName(attributes);

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
    let outputData: unknown = {};
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
        logger.warn("[SpanTransformer] Failed to parse transform metadata", error);
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
   * Extract package name from attributes or instrumentation library
   */
  private static extractPackageName(attributes: Record<string, unknown>): string {
    // Check for explicit package name in attributes
    if (attributes[TdSpanAttributes.PACKAGE_NAME]) {
      return attributes[TdSpanAttributes.PACKAGE_NAME] as string;
    }

    return "unknown";
  }

  /**
   * Extract instrumentation name from span data
   */
  private static extractInstrumentationName(
    span: ReadableSpan,
    attributes: Record<string, unknown>,
  ): string {
    // Check for explicit instrumentation name in attributes
    if (attributes[TdSpanAttributes.INSTRUMENTATION_NAME]) {
      return attributes[TdSpanAttributes.INSTRUMENTATION_NAME] as string;
    }

    // Generate from library name or type
    if (span.instrumentationLibrary?.name) {
      return `tusk-instrumentation-${span.instrumentationLibrary.name}`;
    }

    // Generate from detected package
    const packageName = SpanTransformer.extractPackageName(attributes);
    return `tusk-instrumentation-${packageName}`;
  }

  /**
   * Extract submodule name from attributes
   */
  private static extractSubmoduleName(attributes: Record<string, unknown>): string | undefined {
    // Check for explicit submodule in attributes
    if (attributes[TdSpanAttributes.SUBMODULE_NAME]) {
      return attributes[TdSpanAttributes.SUBMODULE_NAME] as string;
    }

    return undefined;
  }
}
