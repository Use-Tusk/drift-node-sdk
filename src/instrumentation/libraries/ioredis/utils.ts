import { BufferEncoding } from "./types";

interface ConvertedValue {
  value: any;
  bufferMeta?: string;
  encoding?: BufferEncoding;
}

/**
 * Check if a Buffer contains valid UTF-8 data
 */
function isUtf8(buffer: Buffer): boolean {
  try {
    const str = buffer.toString("utf8");
    // Check if the string can be converted back to the same buffer
    return Buffer.from(str, "utf8").equals(buffer);
  } catch {
    return false;
  }
}

/**
 * Convert a value (potentially a Buffer) to a JSON-able format with metadata
 */
export function convertValueToJsonable(value: any): ConvertedValue {
  if (Buffer.isBuffer(value)) {
    if (isUtf8(value)) {
      try {
        // Try to parse as JSON
        return {
          value: JSON.parse(value.toString()),
          bufferMeta: undefined,
          encoding: BufferEncoding.UTF8,
        };
      } catch {
        // Not JSON, just UTF-8 string
        return {
          value: value.toString("utf8"),
          bufferMeta: undefined,
          encoding: BufferEncoding.UTF8,
        };
      }
    }
    // Non-UTF-8 buffer - store as base64
    return {
      value: "RAW_CONTENT",
      bufferMeta: value.toString("base64"),
      encoding: BufferEncoding.BASE64,
    };
  }

  if (typeof value === "string") {
    try {
      // Try to parse as JSON
      return {
        value: JSON.parse(value),
        bufferMeta: undefined,
        encoding: BufferEncoding.NONE,
      };
    } catch {
      // Not JSON, just a string
    }
  }

  // For any other type (number, object, array, etc.)
  return {
    value,
    bufferMeta: undefined,
    encoding: BufferEncoding.NONE,
  };
}

/**
 * Recursively deserialize Buffer objects from JSON representation.
 * Converts {"type":"Buffer","data":[...]} back to actual Buffer instances.
 * This handles the format produced by JSON.stringify(Buffer).
 */
export function deserializeBufferValue(value: any): any {
  if (!value || typeof value !== "object") {
    return value;
  }

  // Check if value is a serialized Buffer: {"type":"Buffer","data":[...]}
  if (value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  // Recursively handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => deserializeBufferValue(item));
  }

  // Recursively handle plain objects
  const result: Record<string, any> = {};
  for (const key of Object.keys(value)) {
    result[key] = deserializeBufferValue(value[key]);
  }
  return result;
}
