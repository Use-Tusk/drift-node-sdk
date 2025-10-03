import * as crypto from "crypto";
import { logger } from "../utils/logger";

export enum JsonSchemaType {
  NUMBER = "NUMBER",
  STRING = "STRING",
  BOOLEAN = "BOOLEAN",
  NULL = "NULL",
  UNDEFINED = "UNDEFINED",
  OBJECT = "OBJECT",
  ORDERED_LIST = "ORDERED_LIST",
  UNORDERED_LIST = "UNORDERED_LIST",
  FUNCTION = "FUNCTION",
}

// Standardized schema type mapping
const jsToJsonSchemaTypeMapping = {
  ["long"]: JsonSchemaType.NUMBER,
  ["undefined"]: JsonSchemaType.UNDEFINED,
  ["string"]: JsonSchemaType.STRING,
  ["number"]: JsonSchemaType.NUMBER,
  ["Number"]: JsonSchemaType.NUMBER,
  ["boolean"]: JsonSchemaType.BOOLEAN,
  ["null"]: JsonSchemaType.NULL,
  ["bigint"]: JsonSchemaType.NUMBER,
  ["Error"]: JsonSchemaType.OBJECT,
  ["function"]: JsonSchemaType.FUNCTION,
  ["RegExp"]: JsonSchemaType.OBJECT,
  ["Set"]: JsonSchemaType.UNORDERED_LIST,
  ["symbol"]: JsonSchemaType.STRING,
  ["Date"]: JsonSchemaType.STRING,
  ["Int8Array"]: JsonSchemaType.STRING,
  ["Uint8Array"]: JsonSchemaType.STRING,
  ["Uint8ClampedArray"]: JsonSchemaType.STRING,
  ["Int16Array"]: JsonSchemaType.STRING,
  ["Uint16Array"]: JsonSchemaType.STRING,
  ["Int32Array"]: JsonSchemaType.STRING,
  ["Uint32Array"]: JsonSchemaType.STRING,
  ["Float32Array"]: JsonSchemaType.STRING,
  ["Float64Array"]: JsonSchemaType.STRING,
  ["DataView"]: JsonSchemaType.STRING,
  ["ArrayBuffer"]: JsonSchemaType.STRING,
  ["object"]: JsonSchemaType.OBJECT,
  ["Object"]: JsonSchemaType.OBJECT,
  ["Map"]: JsonSchemaType.OBJECT,
  ["Array"]: JsonSchemaType.ORDERED_LIST,
  ["Arguments"]: JsonSchemaType.ORDERED_LIST,
} as const;

export enum EncodingType {
  BASE64 = "BASE64",
}

export enum DecodedType {
  JSON = "JSON",
  HTML = "HTML",
  CSS = "CSS",
  JAVASCRIPT = "JAVASCRIPT",
  XML = "XML",
  YAML = "YAML",
  MARKDOWN = "MARKDOWN",
  CSV = "CSV",
  SQL = "SQL",
  GRAPHQL = "GRAPHQL",
  PLAIN_TEXT = "PLAIN_TEXT",
  FORM_DATA = "FORM_DATA",
  MULTIPART_FORM = "MULTIPART_FORM",
  PDF = "PDF",
  AUDIO = "AUDIO",
  VIDEO = "VIDEO",
  GZIP = "GZIP",
  BINARY = "BINARY",
  JPEG = "JPEG",
  PNG = "PNG",
  GIF = "GIF",
  WEBP = "WEBP",
  SVG = "SVG",
  ZIP = "ZIP",
}

export interface JsonSchema {
  type: JsonSchemaType;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema | null;
  encoding?: EncodingType;
  decodedType?: DecodedType;
  matchImportance?: number; // Should be between 0 and 1, 0 being the lowest importance and 1 being the highest importance
}

// The following types can be merged with the generated schema to provide additional information
// This is set in the instrumentation layer and merged with the generated schema
export interface SchemaMergeTypes {
  encoding?: EncodingType;
  decodedType?: DecodedType;
  matchImportance?: number; // Should be between 0 and 1, 0 being the lowest importance and 1 being the highest importance
}

export type SchemaMerges = Record<string, SchemaMergeTypes>;

/**
 * Utility class for JSON schema generation and hashing
 */
export class JsonSchemaHelper {
  /**
   * Determine the detailed type of a value using standardized mapping
   */
  static getDetailedType(value: any): JsonSchemaType {
    if (value === null) {
      return jsToJsonSchemaTypeMapping["null"];
    }

    if (value === undefined) {
      return jsToJsonSchemaTypeMapping["undefined"];
    }

    const primitiveType = typeof value;

    if (primitiveType === "object") {
      // More specific object type detection
      const objectType = Object.prototype.toString.call(value).slice(8, -1);

      if (objectType === "Array") {
        return jsToJsonSchemaTypeMapping["Array"];
      }

      if (objectType === "Date") {
        return jsToJsonSchemaTypeMapping["Date"];
      }

      if (objectType === "RegExp") {
        return jsToJsonSchemaTypeMapping["RegExp"];
      }

      if (objectType === "Error") {
        return jsToJsonSchemaTypeMapping["Error"];
      }

      if (objectType === "Set") {
        return jsToJsonSchemaTypeMapping["Set"];
      }

      if (objectType === "Map") {
        return jsToJsonSchemaTypeMapping["Map"];
      }

      // Typed arrays
      if (objectType === "Int8Array") return jsToJsonSchemaTypeMapping["Int8Array"];
      if (objectType === "Uint8Array") return jsToJsonSchemaTypeMapping["Uint8Array"];
      if (objectType === "Uint8ClampedArray") return jsToJsonSchemaTypeMapping["Uint8ClampedArray"];
      if (objectType === "Int16Array") return jsToJsonSchemaTypeMapping["Int16Array"];
      if (objectType === "Uint16Array") return jsToJsonSchemaTypeMapping["Uint16Array"];
      if (objectType === "Int32Array") return jsToJsonSchemaTypeMapping["Int32Array"];
      if (objectType === "Uint32Array") return jsToJsonSchemaTypeMapping["Uint32Array"];
      if (objectType === "Float32Array") return jsToJsonSchemaTypeMapping["Float32Array"];
      if (objectType === "Float64Array") return jsToJsonSchemaTypeMapping["Float64Array"];
      if (objectType === "DataView") return jsToJsonSchemaTypeMapping["DataView"];
      if (objectType === "ArrayBuffer") return jsToJsonSchemaTypeMapping["ArrayBuffer"];

      if (objectType === "Arguments") {
        return jsToJsonSchemaTypeMapping["Arguments"];
      }

      // Default to generic object
      return jsToJsonSchemaTypeMapping["object"];
    }

    if (primitiveType === "string") {
      return jsToJsonSchemaTypeMapping["string"];
    }

    if (primitiveType === "number") {
      return jsToJsonSchemaTypeMapping["number"];
    }

    if (primitiveType === "bigint") {
      return jsToJsonSchemaTypeMapping["bigint"];
    }

    if (primitiveType === "boolean") {
      return jsToJsonSchemaTypeMapping["boolean"];
    }

    if (primitiveType === "function") {
      return jsToJsonSchemaTypeMapping["function"];
    }

    if (primitiveType === "symbol") {
      return jsToJsonSchemaTypeMapping["symbol"];
    }

    // Fallback for unknown types
    return jsToJsonSchemaTypeMapping["string"];
  }

  /**
   * Merge schema override with generated schema
   * This allows partial overrides while preserving generated properties
   */
  private static mergeSchemaWithMerges(
    generatedSchema: JsonSchema,
    merges: SchemaMergeTypes,
  ): JsonSchema {
    const merged: JsonSchema = { ...generatedSchema };

    // Apply merges properties
    Object.keys(merges).forEach((key) => {
      (merged as any)[key] = (merges as any)[key];
    });

    return merged;
  }

  /**
   * Generate schema from data object using standardized types
   */
  static generateSchema(data: any, schemaMerges?: SchemaMerges): JsonSchema {
    if (data === null) {
      return { type: jsToJsonSchemaTypeMapping["null"] };
    }

    if (data === undefined) {
      return { type: jsToJsonSchemaTypeMapping["undefined"] };
    }

    const detailedType = JsonSchemaHelper.getDetailedType(data);

    if (detailedType === JsonSchemaType.ORDERED_LIST) {
      if (Array.isArray(data) && data.length === 0) {
        return { type: JsonSchemaType.ORDERED_LIST, items: null };
      }
      return {
        type: JsonSchemaType.ORDERED_LIST,
        items:
          Array.isArray(data) && data.length > 0 ? JsonSchemaHelper.generateSchema(data[0]) : null,
      };
    }

    if (detailedType === JsonSchemaType.UNORDERED_LIST) {
      // Handle Set objects
      if (data instanceof Set) {
        const firstItem = data.size > 0 ? data.values().next().value : null;
        return {
          type: JsonSchemaType.UNORDERED_LIST,
          items: firstItem !== null ? JsonSchemaHelper.generateSchema(firstItem) : null,
        };
      }
      return { type: JsonSchemaType.UNORDERED_LIST, items: null };
    }

    if (detailedType === JsonSchemaType.OBJECT) {
      const schema: JsonSchema = { type: JsonSchemaType.OBJECT, properties: {} };

      // Handle Map objects
      if (data instanceof Map) {
        data.forEach((value, key) => {
          if (schema.properties) {
            const keyString = String(key);
            const generatedSchema = JsonSchemaHelper.generateSchema(value);

            // Check for schema override for this key
            if (schemaMerges && schemaMerges[keyString]) {
              schema.properties[keyString] = JsonSchemaHelper.mergeSchemaWithMerges(
                generatedSchema,
                schemaMerges[keyString],
              );
            } else {
              schema.properties[keyString] = generatedSchema;
            }
          }
        });
      } else if (typeof data === "object") {
        Object.keys(data).forEach((key) => {
          if (schema.properties) {
            const generatedSchema = JsonSchemaHelper.generateSchema(data[key]);

            // Check for schema override for this key
            if (schemaMerges && schemaMerges[key]) {
              schema.properties[key] = JsonSchemaHelper.mergeSchemaWithMerges(
                generatedSchema,
                schemaMerges[key],
              );
            } else {
              schema.properties[key] = generatedSchema;
            }
          }
        });
      }

      return schema;
    }

    // For primitive types, return the standardized type
    return { type: detailedType };
  }

  /**
   * Generate deterministic hash for any data
   */
  static generateDeterministicHash(data: any): string {
    // Sort object keys to ensure deterministic hashing
    const sortedData = JsonSchemaHelper.sortObjectKeysRecursively(data);
    const jsonString = JSON.stringify(sortedData);
    return crypto.createHash("sha256").update(jsonString).digest("hex");
  }

  /**
   * Recursively sort object keys for deterministic hashing
   */
  static sortObjectKeysRecursively(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => JsonSchemaHelper.sortObjectKeysRecursively(item));
    }

    if (typeof obj === "object") {
      const sortedObj: any = {};
      Object.keys(obj)
        .sort()
        .forEach((key) => {
          sortedObj[key] = JsonSchemaHelper.sortObjectKeysRecursively(obj[key]);
        });
      return sortedObj;
    }

    return obj;
  }

  /**
   * Decode data based on schema merges containing encoding and decodedType
   */
  private static decodeDataWithMerges(data: any, schemaMerges?: SchemaMerges): any {
    if (!schemaMerges) {
      return data;
    }

    const decodedData = { ...data };

    // Process each schema override that has encoding and decodedType
    for (const [key, schema] of Object.entries(schemaMerges)) {
      if (schema.encoding && schema.decodedType && data[key] !== undefined) {
        try {
          let decodedValue = data[key];

          // Decode based on encoding type
          if (schema.encoding === EncodingType.BASE64 && typeof decodedValue === "string") {
            const buffer = Buffer.from(decodedValue, "base64");
            decodedValue = buffer.toString("utf8");
          }

          // Parse based on decoded type
          if (schema.decodedType === DecodedType.JSON && typeof decodedValue === "string") {
            decodedValue = JSON.parse(decodedValue);
          }

          decodedData[key] = decodedValue;
        } catch (error) {
          logger.warn(`[JsonSchemaHelper] Failed to decode ${key}:`, error);
          // Keep original value if decoding fails
          decodedData[key] = data[key];
        }
      }
    }

    return decodedData;
  }

  /**
   * Generate schema and hash for input/output data
   *
   * This method handles schema merges by decoding data (e.g., base64 -> JSON) and
   * generating schemas/hashes with schema merges applied.
   *
   * @param data - The original input data to process
   * @param schemaMerges - Optional schema merges could contain encoding, decodedType, and/or matchImportance info
   * @returns Object containing:
   *   - schema: JsonSchema for the original data with merges applied
   *   - decodedValueHash: Hash of the decoded data values (what the data looks like after decoding)
   *   - decodedSchemaHash: Hash of the decoded data schema (structure of decoded data) with schema merges applied
   *
   *
   * E.g. if body is base64-encoded JSON, the schema will show
   *
   * "body": {
   *    "type": "OBJECT",
   *    "properties": {
   *       "location": { "type": "STRING" },
   *       "current": {
   *         "type": "OBJECT",
   *         "properties": {
   *           "temp_F": { "type": "STRING" },
   *           "humidity": { "type": "STRING" },
   *         }
   *       },
   *     },
   *    "encoding": "BASE64",
   *    "decodedType": "JSON"
   *  },
   *
   * Where the actual body is stored as a base64-encoded JSON string but the schema still demonstrates the structure of the JSON object.
   */
  static generateSchemaAndHash(
    data: any,
    schemaMerges?: SchemaMerges,
  ): {
    schema: JsonSchema;
    decodedValueHash: string;
    decodedSchemaHash: string;
  } {
    // Simulate the same JSON serialization/deserialization that happens during recording
    // This removes undefined values and normalizes the structure
    const normalizedData = JSON.parse(JSON.stringify(data));

    // Decode data based on schema merges (e.g., base64 -> JSON)
    const decodedData = JsonSchemaHelper.decodeDataWithMerges(normalizedData, schemaMerges);

    // Generate schema for the decoded data with the schema merges applied
    const schema = JsonSchemaHelper.generateSchema(decodedData, schemaMerges);

    // Generate hashes for decoded data
    const decodedValueHash = JsonSchemaHelper.generateDeterministicHash(decodedData);
    const decodedSchemaHash = JsonSchemaHelper.generateDeterministicHash(schema);

    return { schema, decodedValueHash, decodedSchemaHash };
  }

  /**
   * Get the standardized type mapping for reference
   */
  static getTypeMapping(): typeof jsToJsonSchemaTypeMapping {
    return jsToJsonSchemaTypeMapping;
  }
}
