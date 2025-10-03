/**
 * Utility functions for handling binary data and encoding detection
 */

/**
 * Checks if a buffer contains valid UTF-8 text
 * Uses TextDecoder with fatal flag
 *
 * @param buffer - The buffer to check
 * @returns boolean - True if the buffer contains valid UTF-8 text
 */
export function isUtf8(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });

  try {
    // If this succeeds, the buffer contains valid UTF-8
    decoder.decode(buffer);
    return true;
  } catch (error) {
    // If this fails, the buffer contains invalid UTF-8 (likely binary)
    return false;
  }
}

/**
 * Safely converts a buffer to string using appropriate encoding
 *
 * @param buffer - The buffer to convert
 * @returns object with content and encoding used
 */
export function bufferToString(buffer: Buffer): { content: string; encoding: "utf8" | "base64" } {
  if (isUtf8(buffer)) {
    return {
      content: buffer.toString("utf8"),
      encoding: "utf8",
    };
  } else {
    return {
      content: buffer.toString("base64"),
      encoding: "base64",
    };
  }
}

/**
 * Safely combines multiple chunks into a single buffer
 *
 * @param chunks - Array of chunks (can be strings or Buffers)
 * @returns Buffer - Combined buffer
 */
export function combineChunks(chunks: (string | Buffer)[]): Buffer {
  const buffers: Buffer[] = chunks.map((chunk) => {
    if (Buffer.isBuffer(chunk)) {
      return chunk;
    }
    return Buffer.from(chunk);
  });

  return Buffer.concat(buffers);
}
