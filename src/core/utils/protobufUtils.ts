import { Value, Struct } from "@use-tusk/drift-schemas/google/protobuf/struct";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import {
  SpanKind as PbSpanKind,
  MatchType,
  MatchScope,
  MatchLevel,
} from "@use-tusk/drift-schemas/core/span";

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
const MATCH_TYPE_LABELS: Record<MatchType, string> = {
  [MatchType.UNSPECIFIED]: "UNSPECIFIED",
  [MatchType.INPUT_VALUE_HASH]: "INPUT_VALUE_HASH",
  [MatchType.INPUT_VALUE_HASH_REDUCED_SCHEMA]: "INPUT_VALUE_HASH_REDUCED_SCHEMA",
  [MatchType.INPUT_SCHEMA_HASH]: "INPUT_SCHEMA_HASH",
  [MatchType.INPUT_SCHEMA_HASH_REDUCED_SCHEMA]: "INPUT_SCHEMA_HASH_REDUCED_SCHEMA",
  [MatchType.FUZZY]: "FUZZY",
  [MatchType.FALLBACK]: "FALLBACK",
};

/**
 * Human-readable labels for MatchScope enum values
 */
const MATCH_SCOPE_LABELS: Record<MatchScope, string> = {
  [MatchScope.UNSPECIFIED]: "UNSPECIFIED",
  [MatchScope.TRACE]: "TRACE",
  [MatchScope.GLOBAL]: "GLOBAL",
};

/**
 * Converts a MatchType enum to a human-readable label
 */
export function getMatchTypeLabel(matchType: MatchType): string {
  return MATCH_TYPE_LABELS[matchType] ?? `UNKNOWN(${matchType})`;
}

/**
 * Converts a MatchScope enum to a human-readable label
 */
export function getMatchScopeLabel(matchScope: MatchScope): string {
  return MATCH_SCOPE_LABELS[matchScope] ?? `UNKNOWN(${matchScope})`;
}

/**
 * Formats a matchLevel object as a concise, readable string for logging
 */
export function formatMatchLevelForLog(matchLevel: MatchLevel | undefined): string {
  if (!matchLevel) return "No match level info";

  const matchType = matchLevel.matchType ?? MatchType.UNSPECIFIED;
  const matchScope = matchLevel.matchScope ?? MatchScope.UNSPECIFIED;
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
