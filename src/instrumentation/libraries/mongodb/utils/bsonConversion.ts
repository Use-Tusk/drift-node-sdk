import { SpanUtils, SpanInfo } from "../../../../core/tracing/SpanUtils";
import { logger } from "../../../../core/utils";

// ---------------------------------------------------------------------------
// BSON type detection helpers
// ---------------------------------------------------------------------------

function isObjectId(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value._bsontype === "ObjectId" || value._bsontype === "ObjectID") &&
    typeof value.toHexString === "function"
  );
}

function isUUID(value: any): boolean {
  // UUID extends Binary so _bsontype is "Binary"; disambiguate via constructor name
  return (
    typeof value === "object" &&
    value !== null &&
    value.constructor?.name === "UUID" &&
    value._bsontype === "Binary" &&
    typeof value.toString === "function"
  );
}

function isBinary(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Binary" &&
    value.constructor?.name !== "UUID"
  );
}

function isTimestamp(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Timestamp"
  );
}

function isDecimal128(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Decimal128" &&
    typeof value.toString === "function"
  );
}

function isLong(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Long"
  );
}

function isDouble(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Double"
  );
}

function isInt32(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Int32"
  );
}

function isCode(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "Code"
  );
}

function isDBRef(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "DBRef"
  );
}

function isMaxKey(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "MaxKey"
  );
}

function isMinKey(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "MinKey"
  );
}

function isBSONRegExp(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "BSONRegExp"
  );
}

function isBSONSymbol(value: any): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    value._bsontype === "BSONSymbol"
  );
}

// ---------------------------------------------------------------------------
// BSON constructor resolution for reconstruction
// ---------------------------------------------------------------------------

let cachedBsonModule: any = null;

function getBsonConstructors(moduleExports?: any): any {
  // Prefer module exports (mongodb re-exports all BSON types)
  if (moduleExports?.ObjectId) {
    return moduleExports;
  }

  // Use cached bson module if available
  if (cachedBsonModule) {
    return cachedBsonModule;
  }

  // Fallback: try to require bson (always available as mongodb dependency)
  try {
    cachedBsonModule = require("bson");
    return cachedBsonModule;
  } catch {
    logger.warn(
      `[MongodbInstrumentation] Could not load BSON constructors for reconstruction`,
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sanitization (BSON instances -> JSON-safe marker objects)
// ---------------------------------------------------------------------------

function _sanitize(value: any, seen: WeakSet<object>): any {
  // Primitives and null/undefined pass through
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object" && typeof value !== "function") {
    return value;
  }
  // Date is handled natively by JSON.stringify
  if (value instanceof Date) {
    return value;
  }

  // --- BSON type checks (UUID before Binary is critical) ---
  try {
    if (isObjectId(value)) {
      return { __bsonType: "ObjectId", value: value.toHexString() };
    }
    if (isUUID(value)) {
      return { __bsonType: "UUID", value: value.toString() };
    }
    if (isBinary(value)) {
      return {
        __bsonType: "Binary",
        base64: value.toString("base64"),
        subType: value.sub_type,
      };
    }
    if (isTimestamp(value)) {
      return {
        __bsonType: "Timestamp",
        t: typeof value.t === "number" ? value.t : Number(value.getHighBits?.() ?? 0),
        i: typeof value.i === "number" ? value.i : Number(value.getLowBits?.() ?? 0),
      };
    }
    if (isDecimal128(value)) {
      return { __bsonType: "Decimal128", value: value.toString() };
    }
    if (isLong(value)) {
      return {
        __bsonType: "Long",
        low: value.low,
        high: value.high,
        unsigned: !!value.unsigned,
      };
    }
    if (isDouble(value)) {
      return typeof value.valueOf === "function" ? value.valueOf() : value.value;
    }
    if (isInt32(value)) {
      return typeof value.valueOf === "function" ? value.valueOf() : value.value;
    }
    if (isCode(value)) {
      return {
        __bsonType: "Code",
        code: value.code,
        scope: value.scope ? _sanitize(value.scope, seen) : null,
      };
    }
    if (isDBRef(value)) {
      return {
        __bsonType: "DBRef",
        collection: value.collection,
        oid: _sanitize(value.oid, seen),
        db: value.db || undefined,
      };
    }
    if (isMaxKey(value)) {
      return { __bsonType: "MaxKey" };
    }
    if (isMinKey(value)) {
      return { __bsonType: "MinKey" };
    }
    if (isBSONRegExp(value)) {
      return {
        __bsonType: "BSONRegExp",
        pattern: value.pattern,
        options: value.options,
      };
    }
    if (isBSONSymbol(value)) {
      return {
        __bsonType: "BSONSymbol",
        value: typeof value.valueOf === "function" ? value.valueOf() : String(value),
      };
    }
  } catch (error) {
    logger.warn(
      `[MongodbInstrumentation] Error sanitizing BSON value, falling back to String():`,
      error,
    );
    return String(value);
  }

  // --- Native RegExp — serializes to {} via JSON, so handle explicitly ---
  if (value instanceof RegExp) {
    return { __bsonType: "NativeRegExp", pattern: value.source, flags: value.flags };
  }

  // --- Node.js Buffer — serialize as compact base64 ---
  if (Buffer.isBuffer(value)) {
    return { __bsonType: "Buffer", base64: value.toString("base64") };
  }

  // --- Circular reference detection ---
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  // --- Array handling ---
  if (Array.isArray(value)) {
    return value.map((item) => _sanitize(item, seen));
  }

  // --- Plain object handling ---
  if (typeof value === "object") {
    const result: any = {};
    for (const key of Object.keys(value)) {
      result[key] = _sanitize(value[key], seen);
    }
    // Capture getter properties from the prototype (e.g. BulkWriteResult.ok)
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype) {
      const descriptors = Object.getOwnPropertyDescriptors(proto);
      for (const [key, desc] of Object.entries(descriptors)) {
        if (desc.get && key !== "constructor" && !(key in result)) {
          try {
            const val = value[key];
            if (val !== undefined && typeof val !== "function") {
              result[key] = _sanitize(val, seen);
            }
          } catch {
            // Getter may throw; skip it
          }
        }
      }
    }
    return result;
  }

  return value;
}

/**
 * Sanitize BSON types to JSON-serializable marker representations.
 *
 * Recursively walks the input value and converts BSON type instances
 * (ObjectId, Binary, UUID, Timestamp, etc.) to plain objects with a
 * `__bsonType` discriminator that can survive JSON round-tripping.
 */
export function sanitizeBsonValue(value: any): any {
  return _sanitize(value, new WeakSet());
}

// ---------------------------------------------------------------------------
// Reconstruction (JSON-safe markers -> BSON instances)
// ---------------------------------------------------------------------------

/**
 * Reconstruct BSON types from their JSON-safe marker representations.
 * Used during replay mode to restore the correct BSON type instances
 * so that application code calling .toString(), .equals(), or instanceof works correctly.
 */
export function reconstructBsonValue(value: any, moduleExports?: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value !== "object") {
    return value;
  }

  // Array: recurse into each element
  if (Array.isArray(value)) {
    return value.map((item) => reconstructBsonValue(item, moduleExports));
  }

  // Detect __bsonType marker and reconstruct
  if (value.__bsonType) {
    const bson = getBsonConstructors(moduleExports);
    if (!bson) {
      logger.warn(
        `[MongodbInstrumentation] Cannot reconstruct BSON type "${value.__bsonType}" — no constructors available`,
      );
      return value;
    }

    try {
      switch (value.__bsonType) {
        case "ObjectId":
          if (bson.ObjectId) return new bson.ObjectId(value.value);
          break;
        case "UUID":
          if (bson.UUID) return new bson.UUID(value.value);
          break;
        case "Binary":
          if (bson.Binary) {
            return new bson.Binary(
              Buffer.from(value.base64, "base64"),
              value.subType,
            );
          }
          break;
        case "Timestamp":
          if (bson.Timestamp) {
            return new bson.Timestamp({ t: value.t, i: value.i });
          }
          break;
        case "Decimal128":
          if (bson.Decimal128) {
            return bson.Decimal128.fromString
              ? bson.Decimal128.fromString(value.value)
              : new bson.Decimal128(value.value);
          }
          break;
        case "Long":
          if (bson.Long) {
            return new bson.Long(value.low, value.high, value.unsigned);
          }
          break;
        case "Code":
          if (bson.Code) {
            const scope = value.scope
              ? reconstructBsonValue(value.scope, moduleExports)
              : undefined;
            return new bson.Code(value.code, scope);
          }
          break;
        case "DBRef":
          if (bson.DBRef) {
            const oid = reconstructBsonValue(value.oid, moduleExports);
            return new bson.DBRef(value.collection, oid, value.db);
          }
          break;
        case "MaxKey":
          if (bson.MaxKey) return new bson.MaxKey();
          break;
        case "MinKey":
          if (bson.MinKey) return new bson.MinKey();
          break;
        case "BSONRegExp":
          if (bson.BSONRegExp) {
            return new bson.BSONRegExp(value.pattern, value.options);
          }
          break;
        case "BSONSymbol":
          if (bson.BSONSymbol) return new bson.BSONSymbol(value.value);
          break;
        case "NativeRegExp":
          return new RegExp(value.pattern, value.flags || "");
        case "Buffer":
          return Buffer.from(value.base64, "base64");
        default:
          logger.warn(
            `[MongodbInstrumentation] Unknown BSON marker type: "${value.__bsonType}"`,
          );
          return value;
      }
    } catch (error) {
      logger.warn(
        `[MongodbInstrumentation] Error reconstructing BSON type "${value.__bsonType}":`,
        error,
      );
      return value;
    }

    // Constructor not found for this type
    logger.warn(
      `[MongodbInstrumentation] BSON constructor not available for type "${value.__bsonType}"`,
    );
    return value;
  }

  // Plain object: recurse into each property
  const result: any = {};
  for (const key of Object.keys(value)) {
    result[key] = reconstructBsonValue(value[key], moduleExports);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Span attribute helpers
// ---------------------------------------------------------------------------

/**
 * Add output attributes to a span for MongoDB operation results.
 * Sanitizes BSON types before adding to ensure JSON-serializability.
 */
export function addOutputAttributesToSpan(
  spanInfo: SpanInfo,
  result: any,
): void {
  try {
    const sanitized = sanitizeBsonValue(result);
    SpanUtils.addSpanAttributes(spanInfo.span, { outputValue: sanitized });
  } catch (error) {
    logger.error(
      `[MongodbInstrumentation] Error adding output attributes to span:`,
      error,
    );
  }
}

/**
 * Wrap cursor result documents in an object for recording.
 *
 * The Tusk CLI serializes span outputValue into a protobuf Struct for mock
 * responses. Top-level arrays cannot be represented as a Struct field "body"
 * (the CLI omits them), so we wrap the documents array inside a plain object.
 * Use `unwrapCursorOutput` during replay to extract the documents.
 */
export function wrapCursorOutput(documents: any[]): any {
  return { __cursorDocuments: documents };
}

/**
 * Unwrap cursor result documents from the recording wrapper.
 * Handles both the wrapped format (`{ __cursorDocuments: [...] }`) and
 * a direct array fallback for forward compatibility.
 */
export function unwrapCursorOutput(result: any): any[] {
  if (result && typeof result === "object" && Array.isArray(result.__cursorDocuments)) {
    return result.__cursorDocuments;
  }
  if (Array.isArray(result)) {
    return result;
  }
  return [];
}

/**
 * Wrap a direct method result so it survives protobuf Struct serialization.
 *
 * The Tusk CLI can only store objects in response.body (protobuf Struct).
 * Non-object values (numbers, strings, booleans, arrays) are lost.
 * This wraps them in a plain object; use `unwrapDirectOutput` during replay.
 * Object results are left as-is since they already work with Struct.
 */
export function wrapDirectOutput(value: any): any {
  if (value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  return { __directResult: value };
}

/**
 * Unwrap a direct method result from the recording wrapper.
 * Handles both the wrapped format and passthrough for plain objects.
 */
export function unwrapDirectOutput(value: any): any {
  if (value && typeof value === "object" && "__directResult" in value) {
    return value.__directResult;
  }
  return value;
}

/**
 * Strips the `session` property from MongoDB options objects.
 * Sessions are transient runtime objects that cannot be serialized
 * and are not meaningful for mock matching.
 */
export function sanitizeOptions(options: any): any {
  if (!options || typeof options !== "object") return options;
  if (options.session) {
    const { session, ...rest } = options;
    return rest;
  }
  return options;
}
