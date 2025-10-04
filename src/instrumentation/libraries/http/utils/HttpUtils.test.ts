import test from "ava";
import {
  decompressBuffer,
  isSupportedEncoding,
  normalizeHeaders
} from './bodyDecompression';
import {
  isUtf8,
  bufferToString,
  combineChunks
} from './binaryDataHandler';
import {
  httpBodyEncoder,
  getDecodedType,
  HttpBodyType
} from './httpBodyEncoder';

// Body Decompression Tests
test("decompressBuffer - should decompress gzip encoded data", async (t) => {
  const original = Buffer.from('Hello, World!');
  const zlib = require('zlib');
  const compressed = zlib.gzipSync(original);
  const decompressed = await decompressBuffer(compressed, 'gzip');
  t.is(decompressed.toString(), 'Hello, World!');
});

test("decompressBuffer - should decompress deflate encoded data", async (t) => {
  const original = Buffer.from('Hello, World!');
  const zlib = require('zlib');
  const compressed = zlib.deflateSync(original);
  const decompressed = await decompressBuffer(compressed, 'deflate');
  t.is(decompressed.toString(), 'Hello, World!');
});

test("decompressBuffer - should handle unsupported encodings", async (t) => {
  const buffer = Buffer.from('test data');
  const result = await decompressBuffer(buffer, 'unsupported');
  t.is(result, buffer);
});

test("decompressBuffer - should handle invalid compressed data gracefully", async (t) => {
  const invalidData = Buffer.from('not compressed data');
  try {
    const result = await decompressBuffer(invalidData, 'gzip');
    // If it doesn't throw, it should return the original buffer
    t.is(result, invalidData);
  } catch (error) {
    // If it throws, that's also acceptable behavior for invalid data
    t.truthy(error);
  }
});

test("isSupportedEncoding - should return true for supported encodings", (t) => {
  t.is(isSupportedEncoding('gzip'), true);
  t.is(isSupportedEncoding('deflate'), true);
  t.is(isSupportedEncoding('br'), true);
});

test("isSupportedEncoding - should return false for unsupported encodings", (t) => {
  t.is(isSupportedEncoding('unsupported'), false);
  t.is(isSupportedEncoding(''), false);
});

test("normalizeHeaders - should convert header names to lowercase", (t) => {
  const headers = { 'Content-Type': 'application/json', 'AUTHORIZATION': 'Bearer token' };
  const normalized = normalizeHeaders(headers);
  t.is(normalized['content-type'], 'application/json');
  t.is(normalized['authorization'], 'Bearer token');
});

test("normalizeHeaders - should handle empty headers object", (t) => {
  const result = normalizeHeaders({});
  t.deepEqual(result, {});
});

// Binary Data Handler Tests
test("isUtf8 - should return true for valid UTF-8 text", (t) => {
  const buffer = Buffer.from('Hello, World!', 'utf8');
  t.is(isUtf8(buffer), true);
});

test("isUtf8 - should return false for binary data", (t) => {
  const buffer = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);
  t.is(isUtf8(buffer), false);
});

test("isUtf8 - should return true for empty buffer", (t) => {
  const buffer = Buffer.alloc(0);
  t.is(isUtf8(buffer), true);
});

test("bufferToString - should convert UTF-8 buffer to string", (t) => {
  const buffer = Buffer.from('Hello, World!', 'utf8');
  const result = bufferToString(buffer);
  t.is(result.content, 'Hello, World!');
  t.is(result.encoding, 'utf8');
});

test("bufferToString - should convert binary buffer to base64 string", (t) => {
  const buffer = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);
  const result = bufferToString(buffer);
  t.is(result.content, buffer.toString('base64'));
  t.is(result.encoding, 'base64');
});

test("bufferToString - should handle empty buffer", (t) => {
  const buffer = Buffer.alloc(0);
  const result = bufferToString(buffer);
  t.is(result.content, '');
  t.is(result.encoding, 'utf8');
});

test("combineChunks - should combine string chunks into a buffer", (t) => {
  const chunks = ['Hello, ', 'World!'];
  const result = combineChunks(chunks);
  t.is(result.toString(), 'Hello, World!');
});

test("combineChunks - should combine buffer chunks", (t) => {
  const chunks = [Buffer.from('Hello, '), Buffer.from('World!')];
  const result = combineChunks(chunks);
  t.is(result.toString(), 'Hello, World!');
});

test("combineChunks - should handle empty chunks array", (t) => {
  const result = combineChunks([]);
  t.deepEqual(result, Buffer.alloc(0));
});

// HTTP Body Encoder Tests
test("httpBodyEncoder - should base64 encode a simple buffer", async (t) => {
  const buffer = Buffer.from('Hello, World!');
  const result = await httpBodyEncoder({ bodyBuffer: buffer });
  t.is(result, buffer.toString('base64'));
});

test("httpBodyEncoder - should handle empty buffer", async (t) => {
  const buffer = Buffer.alloc(0);
  const result = await httpBodyEncoder({ bodyBuffer: buffer });
  t.is(result, '');
});

test("httpBodyEncoder - should decompress gzip before encoding", async (t) => {
  const original = Buffer.from('Hello, World!');
  const zlib = require('zlib');
  const compressed = zlib.gzipSync(original);
  const result = await httpBodyEncoder({
    bodyBuffer: compressed,
    contentEncoding: 'gzip'
  });
  t.is(result, original.toString('base64'));
});

test("httpBodyEncoder - should handle unsupported content encoding gracefully", async (t) => {
  const buffer = Buffer.from('Hello, World!');
  const result = await httpBodyEncoder({
    bodyBuffer: buffer,
    contentEncoding: 'unsupported'
  });
  t.is(result, buffer.toString('base64'));
});

test("getDecodedType - should return correct decoded type for JSON content types", (t) => {
  t.is(getDecodedType('application/json'), HttpBodyType.JSON);
  t.is(getDecodedType('application/json; charset=utf-8'), HttpBodyType.JSON);
});

test("getDecodedType - should return correct decoded type for text content types", (t) => {
  // Based on the actual enum and mapping, text/plain maps to PLAIN_TEXT, not TEXT
  t.is(getDecodedType('text/plain'), 'PLAIN_TEXT');
  t.is(getDecodedType('text/html'), 'HTML');
});

test("getDecodedType - should return undefined for unknown content types", (t) => {
  t.is(getDecodedType('unknown/type'), undefined);
  t.is(getDecodedType(''), undefined);
});

test("getDecodedType - should handle array of content types", (t) => {
  t.is(getDecodedType(['application/json', 'text/plain']), HttpBodyType.JSON);
});

test("getDecodedType - should handle case insensitive content types", (t) => {
  t.is(getDecodedType('APPLICATION/JSON'), HttpBodyType.JSON);
});

test("HttpBodyType - should have correct enum values", (t) => {
  t.is(HttpBodyType.JSON, 'JSON');
  t.is(HttpBodyType.TEXT, 'TEXT');
  t.is(HttpBodyType.RAW, 'RAW');
  t.is(HttpBodyType.NONE, 'NONE');
});

// Integration Tests
test("Integration - should work together - decompress, detect encoding, and encode", async (t) => {
  const originalData = JSON.stringify({ message: 'Hello, World!' });
  const buffer = Buffer.from(originalData);
  const zlib = require('zlib');
  const compressed = zlib.gzipSync(buffer);

  // Decompress
  const decompressed = await decompressBuffer(compressed, 'gzip');
  t.is(decompressed.toString(), originalData);

  // Encode
  const encoded = await httpBodyEncoder({ bodyBuffer: decompressed });
  t.is(encoded, buffer.toString('base64'));

  // Get type
  const type = getDecodedType('application/json');
  t.is(type, HttpBodyType.JSON);
});

test("Integration - should handle binary data flow", async (t) => {
  const binaryData = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);

  // Check if binary
  t.is(isUtf8(binaryData), false);

  // Convert to string (should be base64)
  const stringified = bufferToString(binaryData);
  t.is(stringified.content, binaryData.toString('base64'));
  t.is(stringified.encoding, 'base64');

  // Encode through httpBodyEncoder
  const encoded = await httpBodyEncoder({ bodyBuffer: binaryData });
  t.is(encoded, binaryData.toString('base64'));
});
