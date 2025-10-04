import { createContextKey } from "@opentelemetry/api";
import { StatusCode, PackageType } from "@use-tusk/drift-schemas/core/span";
import { SpanKind } from "@opentelemetry/api";

export const REPLAY_TRACE_ID_CONTEXT_KEY = createContextKey("td.replayTraceId");
export const SPAN_KIND_CONTEXT_KEY = createContextKey("td.spanKind");
export const IS_PRE_APP_START_CONTEXT_KEY = createContextKey("td.isPreAppStart");
export const CALLING_LIBRARY_CONTEXT_KEY = createContextKey("td.callingLibrary");

export enum TdSpanAttributes {
  /**
   * Presentational information:
   *   - packageType: is the langauge agnostic type that will be used to classify the package
   *   - name: is the visual name of the span (e.g. for http could be "/api/users", for graphql could be "update UpdateUser")
   *
   * - packageName: is the name of the package that is instrumented and can be specific to a language
   * - instrumentationName: is the name of the instrumentation class
   * - submoduleName: is the name of the submodule that is instrumented (e.g. "GET", "query", "execute", "get", etc.)
   *
   * Example 1: fetch package
   *
   * name: "/api/users"
   * packageType: HTTP
   * packageName: "fetch"
   * instrumentationName: "FetchInstrumentation"
   * submoduleName: "GET"
   *
   * Example 2: graphql package
   *
   * name: "update UpdateUser"
   * packageType: GRAPHQL
   * packageName: "http"
   * instrumentationName: "HttpInstrumentation"
   * submoduleName: "execute"
   */
  NAME = "td.name",
  PACKAGE_TYPE = "td.packageType",
  PACKAGE_NAME = "td.packageName",
  INSTRUMENTATION_NAME = "td.instrumentationName",
  SUBMODULE_NAME = "td.submodule",
  IS_PRE_APP_START = "td.isPreAppStart",

  INPUT_VALUE = "td.inputValue",
  OUTPUT_VALUE = "td.outputValue",
  INPUT_SCHEMA_MERGES = "td.inputSchemaMerges",
  OUTPUT_SCHEMA_MERGES = "td.outputSchemaMerges",
  METADATA = "td.metadata",
  TRANSFORM_METADATA = "td.transformMetadata",
}

export type CleanSpanData = {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;

  packageName: string;
  instrumentationName: string;
  submoduleName: string;

  packageType?: PackageType;

  // keep these as plain JSON for readability
  inputValue: unknown;
  outputValue: unknown;
  inputSchema: unknown;
  outputSchema: unknown;

  inputSchemaHash: string;
  outputSchemaHash: string;
  inputValueHash: string;
  outputValueHash: string;

  kind: SpanKind;

  status: {
    code: StatusCode;
    message: string;
  };

  isPreAppStart: boolean;

  timestamp: { seconds: number; nanos: number };
  duration: { seconds: number; nanos: number };

  isRootSpan: boolean;

  metadata?: MetadataObject;
  transformMetadata?: {
    transformed: boolean;
    actions: Array<{
      type: "redact" | "mask" | "replace" | "drop";
      field: string;
      reason: string;
      description?: string;
    }>;
  };
  // sdk-specific
  isUsed?: boolean;
};

export type MockRequestData = {
  traceId: string;
  spanId: string;
  name: string;
  packageName: string;
  packageType?: PackageType;
  instrumentationName: string;
  submoduleName: string;
  inputValue: unknown;
  kind: SpanKind;
};

export type MetadataObject = {
  ENV_VARS?: Record<string, unknown>;
};

export type OneOf<T extends object> = {
  [K in keyof T]: Required<Pick<T, K>> & Partial<Record<Exclude<keyof T, K>, null>>;
}[keyof T];
