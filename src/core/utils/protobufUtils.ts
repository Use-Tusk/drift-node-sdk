import { Value, Struct } from "@use-tusk/drift-schemas/google/protobuf/struct";
import { SpanKind as OtSpanKind } from "@opentelemetry/api";
import { SpanKind as PbSpanKind } from "@use-tusk/drift-schemas/core/span";

export const toStruct = (obj: any | undefined) => (obj ? objectToProtobufStruct(obj) : undefined);

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
export function objectToProtobufStruct(obj: any): Struct {
  const fields: Record<string, Value> = {};

  for (const [key, value] of Object.entries(obj)) {
    fields[key] = valueToProtobufValue(value);
  }

  return Struct.create({ fields });
}

/**
 * Converts a JavaScript value to protobuf Value format
 */
export function valueToProtobufValue(value: any): Value {
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
