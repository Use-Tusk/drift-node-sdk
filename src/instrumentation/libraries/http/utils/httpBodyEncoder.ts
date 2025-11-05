import { decompressBuffer } from "./bodyDecompression";
import { DecodedType } from "@use-tusk/drift-schemas/core/json_schema";
import { logger } from "../../../../core/utils/logger";

// Mapping from content-type to decoded type
const CONTENT_TYPE_MAPPING: Record<string, DecodedType> = {
  // JSON
  "application/json": DecodedType.JSON,

  // HTML
  "text/html": DecodedType.HTML,

  // CSS
  "text/css": DecodedType.CSS,

  // JavaScript
  "text/javascript": DecodedType.JAVASCRIPT,
  "application/javascript": DecodedType.JAVASCRIPT,
  "application/x-javascript": DecodedType.JAVASCRIPT,

  // XML
  "text/xml": DecodedType.XML,
  "application/xml": DecodedType.XML,

  // SVG (special case - XML-based but can be rendered)
  "image/svg+xml": DecodedType.SVG,

  // YAML
  "application/yaml": DecodedType.YAML,
  "application/x-yaml": DecodedType.YAML,
  "text/yaml": DecodedType.YAML,
  "text/x-yaml": DecodedType.YAML,

  // Plain text
  "text/plain": DecodedType.PLAIN_TEXT,

  // Markdown
  "text/markdown": DecodedType.MARKDOWN,
  "text/x-markdown": DecodedType.MARKDOWN,

  // CSV
  "text/csv": DecodedType.CSV,
  "application/csv": DecodedType.CSV,

  // SQL
  "application/sql": DecodedType.SQL,
  "text/sql": DecodedType.SQL,

  // GraphQL
  "application/graphql": DecodedType.GRAPHQL,

  // Form data
  "application/x-www-form-urlencoded": DecodedType.FORM_DATA,
  "multipart/form-data": DecodedType.MULTIPART_FORM,

  // PDF
  "application/pdf": DecodedType.PDF,

  // Specific image formats
  "image/jpeg": DecodedType.JPEG,
  "image/jpg": DecodedType.JPEG,
  "image/png": DecodedType.PNG,
  "image/gif": DecodedType.GIF,
  "image/webp": DecodedType.WEBP,
  "image/bmp": DecodedType.JPEG,
  "image/tiff": DecodedType.JPEG,
  "image/ico": DecodedType.PNG,

  // Audio (keep generic since audio formatting is similar)
  "audio/mpeg": DecodedType.AUDIO,
  "audio/mp3": DecodedType.AUDIO,
  "audio/wav": DecodedType.AUDIO,
  "audio/ogg": DecodedType.AUDIO,
  "audio/webm": DecodedType.AUDIO,

  // Video (keep generic since video formatting is similar)
  "video/mp4": DecodedType.VIDEO,
  "video/webm": DecodedType.VIDEO,
  "video/ogg": DecodedType.VIDEO,
  "video/avi": DecodedType.VIDEO,
  "video/mov": DecodedType.VIDEO,

  // Specific binary formats
  "application/zip": DecodedType.ZIP,
  "application/gzip": DecodedType.GZIP,
  "application/x-gzip": DecodedType.GZIP,

  // Generic binary
  "application/octet-stream": DecodedType.BINARY,
  "application/tar": DecodedType.BINARY,
  "application/rar": DecodedType.BINARY,
  "application/7z": DecodedType.BINARY,
};

/**
 * Async HTTP body encoder that base64 encodes the body buffer
 */
export async function httpBodyEncoder({
  bodyBuffer,
  contentEncoding,
}: {
  bodyBuffer: Buffer;
  contentEncoding?: string;
}): Promise<string> {
  // First check if we need to decompress the body
  let processedBuffer = bodyBuffer;

  if (contentEncoding) {
    try {
      processedBuffer = await decompressBuffer(bodyBuffer, contentEncoding);
    } catch (error) {
      logger.warn(`Failed to decompress body with encoding ${contentEncoding}:`, error);
    }
  }

  return processedBuffer.toString("base64");
}

/**
 * Parses a Content-Type header and returns the corresponding decoded type enum
 * @param contentType - The Content-Type header value (e.g., "application/json; charset=utf-8")
 * @returns The corresponding DecodedType enum value
 */
export function getDecodedType(
  contentType: string | string[] | undefined,
): DecodedType | undefined {
  if (!contentType) {
    return undefined;
  }

  // Handle array values (when same header appears multiple times)
  // Should rarely happen, but just in case. First one is usually the "original" one.
  const contentTypeString =
    Array.isArray(contentType) && contentType.length > 0 ? contentType[0] : contentType;

  if (!contentTypeString || typeof contentTypeString !== "string") {
    logger.debug(`Invalid Content-Type header: ${contentType}`);
    return undefined;
  }

  // Convert to lowercase and extract the main media type (before semicolon)
  const mainType = contentTypeString.toLowerCase().split(";")[0].trim();
  return CONTENT_TYPE_MAPPING[mainType];
}

export const ACCEPTABLE_CONTENT_TYPES = new Set([DecodedType.JSON, DecodedType.PLAIN_TEXT]);
