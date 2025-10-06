import test from 'ava';
import * as zlib from 'zlib';
import { decompressBuffer, isSupportedEncoding, normalizeHeaders } from './bodyDecompression';

const testData = 'Hello, World! This is test data for compression.';
const testBuffer = Buffer.from(testData, 'utf8');

test("decompressBuffer - should decompress gzip encoded data", async (t) => {
  const compressed = zlib.gzipSync(testBuffer);
  const decompressed = await decompressBuffer(compressed, 'gzip');

  t.is(decompressed.toString('utf8'), testData);
});

test("decompressBuffer - should decompress deflate encoded data", async (t) => {
  const compressed = zlib.deflateSync(testBuffer);
  const decompressed = await decompressBuffer(compressed, 'deflate');

  t.is(decompressed.toString('utf8'), testData);
});

test("decompressBuffer - should decompress brotli encoded data", async (t) => {
  const compressed = zlib.brotliCompressSync(testBuffer);
  const decompressed = await decompressBuffer(compressed, 'br');

  t.is(decompressed.toString('utf8'), testData);
});

test("decompressBuffer - should handle case-insensitive encoding names", async (t) => {
  const compressed = zlib.gzipSync(testBuffer);

  const results = await Promise.all([
    decompressBuffer(compressed, 'GZIP'),
    decompressBuffer(compressed, 'Gzip'),
    decompressBuffer(compressed, 'gZiP'),
  ]);

  results.forEach(result => {
    t.is(result.toString('utf8'), testData);
  });
});

test("decompressBuffer - should handle encoding names with whitespace", async (t) => {
  const gzipCompressed = zlib.gzipSync(testBuffer);
  const deflateCompressed = zlib.deflateSync(testBuffer);
  const brotliCompressed = zlib.brotliCompressSync(testBuffer);

  const results = await Promise.all([
    decompressBuffer(gzipCompressed, ' gzip '),
    decompressBuffer(deflateCompressed, '\tdeflate\t'),
    decompressBuffer(brotliCompressed, ' BR '),
  ]);

  // All should work since whitespace is trimmed
  t.is(results[0].toString('utf8'), testData);
  t.is(results[1].toString('utf8'), testData);
  t.is(results[2].toString('utf8'), testData);
});

test("decompressBuffer - should return original buffer for unsupported encodings", async (t) => {
  const result = await decompressBuffer(testBuffer, 'unsupported');
  t.is(result, testBuffer);
});

test("decompressBuffer - should return original buffer for empty encoding", async (t) => {
  const result = await decompressBuffer(testBuffer, '');
  t.is(result, testBuffer);
});

test("decompressBuffer - should handle invalid compressed data gracefully", async (t) => {
  const invalidCompressed = Buffer.from('This is not compressed data');

  await t.throwsAsync(async () => {
    await decompressBuffer(invalidCompressed, 'gzip');
  });
});

test("decompressBuffer - should handle empty buffer", async (t) => {
  const emptyBuffer = Buffer.alloc(0);
  const compressed = zlib.gzipSync(emptyBuffer);
  const decompressed = await decompressBuffer(compressed, 'gzip');

  t.is(decompressed.length, 0);
});

test("decompressBuffer - should handle large data", async (t) => {
  const largeData = 'x'.repeat(100000);
  const largeBuffer = Buffer.from(largeData, 'utf8');
  const compressed = zlib.gzipSync(largeBuffer);
  const decompressed = await decompressBuffer(compressed, 'gzip');

  t.is(decompressed.toString('utf8'), largeData);
});

test("decompressBuffer - should handle binary data", async (t) => {
  const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90, 0xAB, 0xCD]);
  const compressed = zlib.gzipSync(binaryData);
  const decompressed = await decompressBuffer(compressed, 'gzip');

  t.deepEqual(decompressed, binaryData);
});

test("decompressBuffer - should handle Unicode data", async (t) => {
  const unicodeData = 'Hello 🌟 World 💯 Test 🚀 Data ñoño café';
  const unicodeBuffer = Buffer.from(unicodeData, 'utf8');
  const compressed = zlib.gzipSync(unicodeBuffer);
  const decompressed = await decompressBuffer(compressed, 'gzip');

  t.is(decompressed.toString('utf8'), unicodeData);
});

test("isSupportedEncoding - should return true for supported encodings", (t) => {
  const supportedEncodings = ['gzip', 'deflate', 'br'];

  supportedEncodings.forEach(encoding => {
    t.is(isSupportedEncoding(encoding), true);
  });
});

test("isSupportedEncoding - should return true for case-insensitive supported encodings", (t) => {
  const caseVariations = [
    'GZIP', 'Gzip', 'gZiP',
    'DEFLATE', 'Deflate', 'dEfLaTe',
    'BR', 'Br', 'bR'
  ];

  caseVariations.forEach(encoding => {
    t.is(isSupportedEncoding(encoding), true);
  });
});

test("isSupportedEncoding - should handle encodings with whitespace", (t) => {
  const encodingsWithWhitespace = [
    ' gzip ', '\tdeflate\t', ' br ', '  GZIP  '
  ];

  encodingsWithWhitespace.forEach(encoding => {
    t.is(isSupportedEncoding(encoding), true);
  });
});

test("isSupportedEncoding - should return false for unsupported encodings", (t) => {
  const unsupportedEncodings = [
    'compress', 'lz4', 'snappy', 'lzma', 'xz', 'unknown', ''
  ];

  unsupportedEncodings.forEach(encoding => {
    t.is(isSupportedEncoding(encoding), false);
  });
});

test("isSupportedEncoding - should handle special characters and invalid inputs", (t) => {
  const invalidInputs = [
    'gzip@', 'deflate!', 'br#', 'gzip-modified', 'deflate+extra'
  ];

  invalidInputs.forEach(encoding => {
    t.is(isSupportedEncoding(encoding), false);
  });
});

test("normalizeHeaders - should convert header names to lowercase", (t) => {
  const headers = {
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
    'ACCEPT': 'text/html',
    'User-Agent': 'test-agent'
  };

  const normalized = normalizeHeaders(headers);

  t.deepEqual(normalized, {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
    'accept': 'text/html',
    'user-agent': 'test-agent'
  });
});

test("normalizeHeaders - should preserve header values unchanged", (t) => {
  const headers = {
    'Content-Type': 'Application/JSON; charset=UTF-8',
    'Custom-Header': 'SOME-VALUE-WITH-CAPS',
    'Authorization': 'Bearer TOKEN123'
  };

  const normalized = normalizeHeaders(headers);

  t.is(normalized['content-type'], 'Application/JSON; charset=UTF-8');
  t.is(normalized['custom-header'], 'SOME-VALUE-WITH-CAPS');
  t.is(normalized['authorization'], 'Bearer TOKEN123');
});

test("normalizeHeaders - should handle empty headers object", (t) => {
  const normalized = normalizeHeaders({});
  t.deepEqual(normalized, {});
});

test("normalizeHeaders - should handle headers with various data types", (t) => {
  const headers = {
    'String-Header': 'string-value',
    'Number-Header': 42,
    'Boolean-Header': true,
    'Array-Header': ['value1', 'value2'],
    'Object-Header': { nested: 'object' }
  };

  const normalized = normalizeHeaders(headers);

  t.is(normalized['string-header'], 'string-value');
  t.is(normalized['number-header'], 42);
  t.is(normalized['boolean-header'], true);
  t.deepEqual(normalized['array-header'], ['value1', 'value2']);
  t.deepEqual(normalized['object-header'], { nested: 'object' });
});

test("normalizeHeaders - should handle headers with special characters in names", (t) => {
  const headers = {
    'X-Custom-Header': 'value1',
    'x-forwarded-for': 'value2',
    'cache-control': 'no-cache',
    'Access-Control-Allow-Origin': '*'
  };

  const normalized = normalizeHeaders(headers);

  t.is(normalized['x-custom-header'], 'value1');
  t.is(normalized['x-forwarded-for'], 'value2');
  t.is(normalized['cache-control'], 'no-cache');
  t.is(normalized['access-control-allow-origin'], '*');
});

test("normalizeHeaders - should handle duplicate headers with different cases", (t) => {
  const headers = {
    'content-type': 'text/plain',
    'Content-Type': 'application/json'
  };

  const normalized = normalizeHeaders(headers);

  // The second one should overwrite the first
  t.is(normalized['content-type'], 'application/json');
  t.is(Object.keys(normalized).length, 1);
});

test("normalizeHeaders - should handle null and undefined values", (t) => {
  const headers = {
    'Null-Header': null,
    'Undefined-Header': undefined,
    'Valid-Header': 'valid-value'
  };

  const normalized = normalizeHeaders(headers);

  t.is(normalized['null-header'], null);
  t.is(normalized['undefined-header'], undefined);
  t.is(normalized['valid-header'], 'valid-value');
});
