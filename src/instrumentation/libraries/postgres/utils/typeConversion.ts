import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { SpanUtils } from "../../../../core/tracing/SpanUtils";
import { PostgresConvertedResult, PostgresOutputValueType, isPostgresOutputValueType } from "../types";
import { logger } from "../../../../core/utils";

/**
 * Convert PostgreSQL string values back to appropriate JavaScript types
 * based on field metadata from the recorded response.
 */
export function convertPostgresTypes(result: any): PostgresConvertedResult | undefined {
  if (!isPostgresOutputValueType(result)) {
    logger.error(
      `[PostgresInstrumentation] output value is not of type PostgresOutputValueType`,
      result,
    );
    return undefined;
  }

  const { rows, count, command, columns, state, statement } = result;

  // Reconstruct Result-like object, converting serialized Buffers back to actual Buffers
  const resultArray = Array.from((rows || []).map((row: any) => reconstructBuffers(row)));

  // Attach metadata as non-enumerable properties (matching postgres.js behavior)
  // Only add properties that are actually present in the recorded data to avoid
  // undefined -> null conversion which causes JSON serialization mismatches
  if (count !== undefined) {
    Object.defineProperty(resultArray, "count", {
      value: count,
      writable: true,
      enumerable: false,
    });
  }

  if (command !== undefined) {
    Object.defineProperty(resultArray, "command", {
      value: command,
      writable: true,
      enumerable: false,
    });
  }

  if (columns !== undefined) {
    Object.defineProperty(resultArray, "columns", {
      value: columns,
      writable: true,
      enumerable: false,
    });
  }

  if (state !== undefined) {
    Object.defineProperty(resultArray, "state", {
      value: state,
      writable: true,
      enumerable: false,
    });
  }

  if (statement !== undefined) {
    Object.defineProperty(resultArray, "statement", {
      value: statement,
      writable: true,
      enumerable: false,
    });
  }

  return resultArray;
}

/**
 * Recursively reconstructs Buffer objects from their JSON-serialized format.
 * When Buffers are JSON.stringify'd, they become { type: "Buffer", data: [...] }.
 * This method converts them back to actual Buffer instances.
 */
export function reconstructBuffers(value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  // Detect serialized Buffer: { type: "Buffer", data: [...] }
  if (typeof value === "object" && value.type === "Buffer" && Array.isArray(value.data)) {
    return Buffer.from(value.data);
  }

  // Recursively handle arrays
  if (Array.isArray(value)) {
    return value.map((item) => reconstructBuffers(item));
  }

  // Recursively handle plain objects
  if (typeof value === "object") {
    const result: any = {};
    for (const key of Object.keys(value)) {
      result[key] = reconstructBuffers(value[key]);
    }
    return result;
  }

  return value;
}

/**
 * Add output attributes to span for PostgreSQL results.
 */
export function addOutputAttributesToSpan(spanInfo: SpanInfo, result?: any): void {
  if (!result) return;

  // ALL postgres.js results are Result objects (extend Array) with metadata properties
  // We need to explicitly capture these non-enumerable properties
  const isArray = Array.isArray(result);

  logger.debug(
    `[PostgresInstrumentation] Adding output attributes to span for ${isArray ? "array" : "object"} result`,
  );

  // Helper to convert Buffers to strings for JSON serialization
  // This ensures consistent string data in both RECORD and REPLAY modes
  const normalizeValue = (val: any): any => {
    if (Buffer.isBuffer(val)) {
      return val.toString("utf8");
    } else if (Array.isArray(val)) {
      return val.map(normalizeValue);
    } else if (
      val &&
      typeof val === "object" &&
      val.type === "Buffer" &&
      Array.isArray(val.data)
    ) {
      // Handle already-serialized Buffer objects
      return Buffer.from(val.data).toString("utf8");
    }
    return val;
  };

  const outputValue: PostgresOutputValueType = {
    // Always capture rows (the array data), normalizing any Buffer objects
    rows: isArray
      ? Array.from(result).map(normalizeValue)
      : (result.rows || []).map(normalizeValue),
    // Explicitly capture non-enumerable metadata properties
    count: result.count !== undefined && result.count !== null ? result.count : undefined,
    command: result.command || undefined,
    // You could also capture: columns, state, statement if needed
    columns: result.columns || undefined,
    state: result.state || undefined,
    statement: result.statement || undefined,
  };

  SpanUtils.addSpanAttributes(spanInfo.span, {
    outputValue,
  });
}
