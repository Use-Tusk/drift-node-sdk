import { ReadableMetadata, ReadableMetadataValue } from "./types";

/**
 * Check if a buffer contains valid UTF-8 text
 */
function isUtf8(buffer: Buffer): boolean {
  try {
    const str = buffer.toString("utf8");
    return Buffer.from(str, "utf8").equals(buffer);
  } catch {
    return false;
  }
}

/**
 * Convert gRPC Metadata object to a plain JavaScript object
 */
export function serializeGrpcMetadata(metadata: any): ReadableMetadata {
  if (!metadata) {
    return {};
  }

  const readableMetadata: ReadableMetadata = {};

  // Get all metadata keys
  const metadataMap = metadata.getMap ? metadata.getMap() : {};
  const keys = Object.keys(metadataMap);

  for (const key of keys) {
    const valueArr = metadata.get(key);
    readableMetadata[key] = [];

    for (const value of valueArr) {
      if (typeof value === "string") {
        readableMetadata[key].push(value);
        continue;
      }

      // Handle binary values (Buffers)
      if (Buffer.isBuffer(value)) {
        let readableBuffer: ReadableMetadataValue;
        if (isUtf8(value)) {
          readableBuffer = {
            value: value.toString("utf8"),
            encoding: "utf8",
          };
        } else {
          readableBuffer = {
            value: value.toString("base64"),
            encoding: "base64",
          };
        }
        readableMetadata[key].push(readableBuffer);
      }
    }
  }

  return readableMetadata;
}

/**
 * Convert a plain JavaScript object back to gRPC Metadata
 */
export function deserializeGrpcMetadata(
  MetadataConstructor: any,
  readableMetadata: ReadableMetadata,
): any {
  const metadata = new MetadataConstructor();

  for (const [key, valueArr] of Object.entries(readableMetadata)) {
    for (const value of valueArr) {
      if (typeof value === "string") {
        metadata.add(key, value);
        continue;
      }

      // Handle binary values
      if (typeof value === "object" && "value" in value && "encoding" in value) {
        const encodedValue = value as ReadableMetadataValue;
        if (encodedValue.encoding === "utf8") {
          metadata.add(key, Buffer.from(encodedValue.value, "utf-8"));
        } else {
          metadata.add(key, Buffer.from(encodedValue.value, "base64"));
        }
      }
    }
  }

  return metadata;
}

/**
 * Extract service and method name from gRPC path
 * Path format: /package.ServiceName/MethodName
 */
export function parseGrpcPath(path: string): {
  method: string;
  service: string;
} {
  if (!path || path === null) {
    return { method: "", service: "" };
  }

  const parts = path.replace(/^\//, "").split("/");
  const service = parts[0] || "";
  const method = parts[1] || "";

  return { method, service };
}

/**
 * Convert request/response body to a serializable format, handling Buffers
 */
export function serializeGrpcPayload(realBody: any): {
  readableBody: any;
  bufferMap: Record<string, { value: string; encoding: string }>;
  jsonableStringMap: Record<string, string>;
} {
  const bufferMap: Record<string, { value: string; encoding: string }> = {};
  const jsonableStringMap: Record<string, string> = {};

  // Clone the body to avoid mutating the original
  const readableBody = deepClone(realBody);

  // Process the body recursively
  processPayloadForSerialization(readableBody, bufferMap, jsonableStringMap, []);

  return { readableBody, bufferMap, jsonableStringMap };
}

/**
 * Recursively process a payload to convert Buffers to placeholders
 */
function processPayloadForSerialization(
  payload: any,
  bufferMap: Record<string, { value: string; encoding: string }>,
  jsonableStringMap: Record<string, string>,
  path: string[],
): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  for (const key of Object.keys(payload)) {
    const currentPath = [...path, key];
    const currentPathStr = currentPath.join(".");

    // Handle Buffer objects
    if (Buffer.isBuffer(payload[key])) {
      if (isUtf8(payload[key])) {
        const stringValue = payload[key].toString("utf-8");
        bufferMap[currentPathStr] = {
          value: stringValue,
          encoding: "utf8",
        };
        payload[key] = "__tusk_drift_buffer_replaced__";
      } else {
        bufferMap[currentPathStr] = {
          value: payload[key].toString("base64"),
          encoding: "base64",
        };
        payload[key] = "__tusk_drift_buffer_replaced__";
      }
      continue;
    }

    // Handle nested objects
    if (typeof payload[key] === "object" && payload[key] !== null) {
      processPayloadForSerialization(payload[key], bufferMap, jsonableStringMap, currentPath);
    }
  }
}

/**
 * Convert a serialized payload back to its original format with Buffers restored
 */
export function deserializeGrpcPayload(
  readablePayload: any,
  bufferMap: Record<string, { value: string; encoding: string }>,
  jsonableStringMap: Record<string, string>,
): any {
  const clonedPayload = deepClone(readablePayload);
  restorePayloadFromSerialization(clonedPayload, bufferMap, jsonableStringMap, []);
  return clonedPayload;
}

/**
 * Recursively restore Buffers in a payload
 */
function restorePayloadFromSerialization(
  payload: any,
  bufferMap: Record<string, { value: string; encoding: string }>,
  jsonableStringMap: Record<string, string>,
  path: string[],
): void {
  if (!payload || typeof payload !== "object") {
    return;
  }

  for (const key of Object.keys(payload)) {
    const currentPath = [...path, key];
    const currentPathStr = currentPath.join(".");

    // Restore Buffer placeholders
    if (payload[key] === "__tusk_drift_buffer_replaced__") {
      const buffer = bufferMap[currentPathStr];
      if (buffer) {
        if (buffer.encoding === "utf8") {
          payload[key] = Buffer.from(buffer.value, "utf-8");
        } else {
          payload[key] = Buffer.from(buffer.value, "base64");
        }
      }
      continue;
    }

    // Handle nested objects
    if (typeof payload[key] === "object" && payload[key] !== null) {
      restorePayloadFromSerialization(payload[key], bufferMap, jsonableStringMap, currentPath);
    }
  }
}

/**
 * Deep clone an object
 */
function deepClone(obj: any): any {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }

  if (Buffer.isBuffer(obj)) {
    return Buffer.from(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }

  const cloned: any = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}
