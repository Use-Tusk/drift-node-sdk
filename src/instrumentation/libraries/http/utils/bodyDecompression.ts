import * as zlib from "zlib";
import { logger } from "../../../../core/utils/logger";

/**
 * Supported compression encodings and their corresponding zlib decompression functions
 */
const ENCODING_FUNCTION_MAP = {
  gzip: "gunzip",
  deflate: "inflate",
  br: "brotliDecompress",
} as const;

type SupportedEncoding = keyof typeof ENCODING_FUNCTION_MAP;

/**
 * Decompresses a buffer using the specified encoding
 *
 * @param buffer - The compressed buffer to decompress
 * @param encoding - The compression encoding (gzip, deflate, br)
 * @returns Promise<Buffer> - The decompressed buffer
 */
export async function decompressBuffer(buffer: Buffer, encoding: string): Promise<Buffer> {
  const normalizedEncoding = encoding.toLowerCase().trim() as SupportedEncoding;

  if (normalizedEncoding in ENCODING_FUNCTION_MAP) {
    return new Promise((resolve, reject) => {
      const zlibFunction = ENCODING_FUNCTION_MAP[normalizedEncoding];
      (zlib as any)[zlibFunction](buffer, (err: Error | null, decoded: Buffer) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });
  }

  logger.debug(`Unknown encoding: ${encoding} - skipping decoding.`);
  return Promise.resolve(buffer);
}

/**
 * Checks if a string represents a supported compression encoding
 *
 * @param encoding - The encoding string to check
 * @returns boolean - True if the encoding is supported
 */
export function isSupportedEncoding(encoding: string): boolean {
  const normalizedEncoding = encoding.toLowerCase().trim();
  return normalizedEncoding in ENCODING_FUNCTION_MAP;
}

export function normalizeHeaders(headers: Record<string, any>): Record<string, any> {
  const normalized: Record<string, any> = {};
  for (const [name, value] of Object.entries(headers)) {
    normalized[name.toLowerCase()] = value;
  }
  return normalized;
}
