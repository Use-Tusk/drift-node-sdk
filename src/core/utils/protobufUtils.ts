import { Value, Struct } from "@use-tusk/drift-schemas/google/protobuf/struct";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import { SpanKind as PbSpanKind } from "@use-tusk/drift-schemas/core/span";
import {
  type JsonSchema,
  JsonSchemaType,
  EncodingType,
  DecodedType,
} from "@use-tusk/drift-schemas/core/json_schema";

export const toStruct = (obj: unknown | undefined) =>
  obj ? objectToProtobufStruct(obj) : undefined;

// Map OpenTelemetry SpanKind -> protobuf SpanKind
export const mapOtToPb = (k: OtSpanKind): PbSpanKind => {
  switch (k) {
    case OtSpanKind.INTERNAL:
      return PbSpanKind.INTERNAL;
    case OtSpanKind.SERVER:
      return PbSpanKind.SERVER;
    case OtSpanKind.CLIENT:
      return PbSpanKind.CLIENT;
    case OtSpanKind.PRODUCER:
      return PbSpanKind.PRODUCER;
    case OtSpanKind.CONSUMER:
      return PbSpanKind.CONSUMER;
    default:
      return PbSpanKind.UNSPECIFIED;
  }
};

/**
 * Converts a JavaScript object to protobuf Struct format
 */
export function objectToProtobufStruct(obj: unknown): Struct {
  const fields: Record<string, Value> = {};

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    fields[key] = valueToProtobufValue(value);
  }

  return Struct.create({ fields });
}

/**
 * Converts a JavaScript value to protobuf Value format
 */
export function valueToProtobufValue(value: unknown): Value {
  if (value === null || value === undefined) {
    return Value.create({ kind: { oneofKind: "nullValue", nullValue: 0 } });
  }

  if (typeof value === "boolean") {
    return Value.create({ kind: { oneofKind: "boolValue", boolValue: value } });
  }

  if (typeof value === "number") {
    return Value.create({ kind: { oneofKind: "numberValue", numberValue: value } });
  }

  if (typeof value === "string") {
    return Value.create({ kind: { oneofKind: "stringValue", stringValue: value } });
  }

  if (Array.isArray(value)) {
    const listValue = {
      values: value.map((item) => valueToProtobufValue(item)),
    };
    return Value.create({ kind: { oneofKind: "listValue", listValue } });
  }

  if (typeof value === "object" && value !== null) {
    const structValue = objectToProtobufStruct(value);
    return Value.create({ kind: { oneofKind: "structValue", structValue } });
  }

  // Fallback to string representation for other types
  return Value.create({ kind: { oneofKind: "stringValue", stringValue: String(value) } });
}

/**
 * Human-readable labels for MatchType enum values
 */
const MATCH_TYPE_LABELS: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "INPUT_VALUE_HASH",
  2: "INPUT_VALUE_HASH_REDUCED_SCHEMA",
  3: "INPUT_SCHEMA_HASH",
  4: "INPUT_SCHEMA_HASH_REDUCED_SCHEMA",
  5: "FUZZY",
  6: "FALLBACK",
};

/**
 * Human-readable labels for MatchScope enum values
 */
const MATCH_SCOPE_LABELS: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "SPAN",
  2: "TRACE",
  3: "GLOBAL",
};

export interface MatchLevel {
  matchType?: number;
  matchScope?: number;
  matchDescription?: string;
  topCandidates?: unknown[];
  similarityScore?: number;
}

/**
 * Converts a numeric match type to a human-readable label
 */
export function getMatchTypeLabel(matchType: number): string {
  return MATCH_TYPE_LABELS[matchType] ?? `UNKNOWN(${matchType})`;
}

/**
 * Converts a numeric match scope to a human-readable label
 */
export function getMatchScopeLabel(matchScope: number): string {
  return MATCH_SCOPE_LABELS[matchScope] ?? `UNKNOWN(${matchScope})`;
}

/**
 * Formats a matchLevel object as a concise, readable string for logging
 */
export function formatMatchLevelForLog(matchLevel: MatchLevel | undefined): string {
  if (!matchLevel) return "No match level info";

  const matchType = matchLevel.matchType ?? 0;
  const matchScope = matchLevel.matchScope ?? 0;
  const typeLabel = getMatchTypeLabel(matchType);
  const scopeLabel = getMatchScopeLabel(matchScope);

  let result = `[${typeLabel}] scope=${scopeLabel}`;

  if (matchLevel.matchDescription) {
    result += ` - "${matchLevel.matchDescription}"`;
  }

  if (matchLevel.similarityScore !== undefined) {
    result += ` (score: ${matchLevel.similarityScore})`;
  }

  return result;
}
