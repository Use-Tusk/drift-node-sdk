/**
 * Shared data normalization utilities to ensure consistent data processing
 * between recording (span export) and replay (mock request) modes.
 *
 * This utility addresses the issue where recording uses JSON.stringify() which omits
 * undefined values, while replay sends raw objects with undefined values that get
 * converted to explicit null fields in protobuf.
 */

/**
 * Safe JSON stringify that handles circular references
 */
function safeJsonStringify(obj: any): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) {
        return "[Circular]";
      }
      seen.add(value);
    }
    return value;
  });
}

/**
 * Normalizes input data for consistent processing across recording and replay.
 * This ensures the same data structure is used in both modes by:
 * 1. Filtering out undefined values (like JSON.stringify does)
 * 2. Providing a consistent object structure for hashing
 * 3. Handling circular references safely
 */
export function normalizeInputData<T extends Record<string, any>>(inputData: T): T {
  // Use safe JSON.stringify round-trip to match recording behavior
  // This removes undefined values, normalizes the data structure, and handles circular references
  return JSON.parse(safeJsonStringify(inputData)) as T;
}

/**
 * Creates a normalized input value for span attributes during recording.
 * This should be used instead of direct JSON.stringify to ensure consistency.
 */
export function createSpanInputValue(inputData: Record<string, any>): string {
  const normalized = normalizeInputData(inputData);
  return safeJsonStringify(normalized);
}

/**
 * Creates a normalized input value for mock requests during replay.
 * This ensures the same normalization is applied as during recording.
 */
export function createMockInputValue<T extends Record<string, any>>(inputData: T): T {
  return normalizeInputData(inputData);
}
