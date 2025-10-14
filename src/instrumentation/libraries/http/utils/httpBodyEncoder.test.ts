import test from 'ava';
import * as zlib from 'zlib';
import { httpBodyEncoder, getDecodedType } from './httpBodyEncoder';
import { DecodedType } from '@use-tusk/drift-schemas/core/json_schema';

// httpBodyEncoder function
test('should base64 encode a simple buffer', async (t) => {
  const testData = 'Hello, World!';
  const buffer = Buffer.from(testData, 'utf8');

  const result = await httpBodyEncoder({ bodyBuffer: buffer });

  t.is(result, buffer.toString('base64'));
});

test('should handle empty buffer', async (t) => {
  const buffer = Buffer.alloc(0);

  const result = await httpBodyEncoder({ bodyBuffer: buffer });

  t.is(result, '');
});

test('should handle binary data', async (t) => {
  const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);

  const result = await httpBodyEncoder({ bodyBuffer: binaryData });

  t.is(result, binaryData.toString('base64'));
});

test('should decompress gzip before encoding', async (t) => {
  const originalData = 'This is test data that will be compressed with gzip';
  const originalBuffer = Buffer.from(originalData, 'utf8');
  const compressedBuffer = zlib.gzipSync(originalBuffer);

  const result = await httpBodyEncoder({
    bodyBuffer: compressedBuffer,
    contentEncoding: 'gzip'
  });

  t.is(result, originalBuffer.toString('base64'));
});

test('should decompress deflate before encoding', async (t) => {
  const originalData = 'This is test data that will be compressed with deflate';
  const originalBuffer = Buffer.from(originalData, 'utf8');
  const compressedBuffer = zlib.deflateSync(originalBuffer);

  const result = await httpBodyEncoder({
    bodyBuffer: compressedBuffer,
    contentEncoding: 'deflate'
  });

  t.is(result, originalBuffer.toString('base64'));
});

test('should decompress brotli before encoding', async (t) => {
  const originalData = 'This is test data that will be compressed with brotli';
  const originalBuffer = Buffer.from(originalData, 'utf8');
  const compressedBuffer = zlib.brotliCompressSync(originalBuffer);

  const result = await httpBodyEncoder({
    bodyBuffer: compressedBuffer,
    contentEncoding: 'br'
  });

  t.is(result, originalBuffer.toString('base64'));
});

test('should handle unsupported content encoding gracefully', async (t) => {
  const testData = 'Test data with unsupported encoding';
  const buffer = Buffer.from(testData, 'utf8');

  const result = await httpBodyEncoder({
    bodyBuffer: buffer,
    contentEncoding: 'unsupported'
  });

  t.is(result, buffer.toString('base64'));
});

test('should handle invalid compressed data gracefully', async (t) => {
  const invalidCompressed = Buffer.from('This is not actually compressed data');

  const result = await httpBodyEncoder({
    bodyBuffer: invalidCompressed,
    contentEncoding: 'gzip'
  });

  // Should fall back to encoding the original buffer
  t.is(result, invalidCompressed.toString('base64'));
});

test('should handle case-insensitive content encoding', async (t) => {
  const originalData = 'Test data for case insensitive encoding';
  const originalBuffer = Buffer.from(originalData, 'utf8');
  const compressedBuffer = zlib.gzipSync(originalBuffer);

  const results = await Promise.all([
    httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'GZIP' }),
    httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'Gzip' }),
    httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'gzip' }),
  ]);

  results.forEach(result => {
    t.is(result, originalBuffer.toString('base64'));
  });
});

test('should handle Unicode data correctly', async (t) => {
  const unicodeData = 'Hello 🌟 World 💯 Café ñoño 中文 Привет';
  const buffer = Buffer.from(unicodeData, 'utf8');

  const result = await httpBodyEncoder({ bodyBuffer: buffer });

  t.is(result, buffer.toString('base64'));

  // Verify round trip
  const decoded = Buffer.from(result, 'base64').toString('utf8');
  t.is(decoded, unicodeData);
});

test('should handle large buffers efficiently', async (t) => {
  const largeData = 'x'.repeat(100000);
  const buffer = Buffer.from(largeData, 'utf8');

  const result = await httpBodyEncoder({ bodyBuffer: buffer });

  t.is(result, buffer.toString('base64'));
  t.is(typeof result, 'string');
});

// getDecodedType function
test('should return correct decoded type for JSON content types', (t) => {
  t.is(getDecodedType('application/json'), DecodedType.JSON);
  t.is(getDecodedType('application/json; charset=utf-8'), DecodedType.JSON);
});

test('should return correct decoded type for text content types', (t) => {
  t.is(getDecodedType('text/html'), DecodedType.HTML);
  t.is(getDecodedType('text/css'), DecodedType.CSS);
  t.is(getDecodedType('text/plain'), DecodedType.PLAIN_TEXT);
  t.is(getDecodedType('text/markdown'), DecodedType.MARKDOWN);
  t.is(getDecodedType('text/csv'), DecodedType.CSV);
});

test('should return correct decoded type for JavaScript content types', (t) => {
  t.is(getDecodedType('text/javascript'), DecodedType.JAVASCRIPT);
  t.is(getDecodedType('application/javascript'), DecodedType.JAVASCRIPT);
  t.is(getDecodedType('application/x-javascript'), DecodedType.JAVASCRIPT);
});

test('should return correct decoded type for XML content types', (t) => {
  t.is(getDecodedType('text/xml'), DecodedType.XML);
  t.is(getDecodedType('application/xml'), DecodedType.XML);
  t.is(getDecodedType('image/svg+xml'), DecodedType.SVG);
});

test('should return correct decoded type for YAML content types', (t) => {
  t.is(getDecodedType('application/yaml'), DecodedType.YAML);
  t.is(getDecodedType('application/x-yaml'), DecodedType.YAML);
  t.is(getDecodedType('text/yaml'), DecodedType.YAML);
  t.is(getDecodedType('text/x-yaml'), DecodedType.YAML);
});

test('should return correct decoded type for form data content types', (t) => {
  t.is(getDecodedType('application/x-www-form-urlencoded'), DecodedType.FORM_DATA);
  t.is(getDecodedType('multipart/form-data'), DecodedType.MULTIPART_FORM);
  t.is(getDecodedType('multipart/form-data; boundary=something'), DecodedType.MULTIPART_FORM);
});

test('should return correct decoded type for image content types', (t) => {
  t.is(getDecodedType('image/jpeg'), DecodedType.JPEG);
  t.is(getDecodedType('image/jpg'), DecodedType.JPEG);
  t.is(getDecodedType('image/png'), DecodedType.PNG);
  t.is(getDecodedType('image/gif'), DecodedType.GIF);
  t.is(getDecodedType('image/webp'), DecodedType.WEBP);
  t.is(getDecodedType('image/bmp'), DecodedType.JPEG);
  t.is(getDecodedType('image/tiff'), DecodedType.JPEG);
  t.is(getDecodedType('image/ico'), DecodedType.PNG);
});

test('should return correct decoded type for audio content types', (t) => {
  t.is(getDecodedType('audio/mpeg'), DecodedType.AUDIO);
  t.is(getDecodedType('audio/mp3'), DecodedType.AUDIO);
  t.is(getDecodedType('audio/wav'), DecodedType.AUDIO);
  t.is(getDecodedType('audio/ogg'), DecodedType.AUDIO);
  t.is(getDecodedType('audio/webm'), DecodedType.AUDIO);
});

test('should return correct decoded type for video content types', (t) => {
  t.is(getDecodedType('video/mp4'), DecodedType.VIDEO);
  t.is(getDecodedType('video/webm'), DecodedType.VIDEO);
  t.is(getDecodedType('video/ogg'), DecodedType.VIDEO);
  t.is(getDecodedType('video/avi'), DecodedType.VIDEO);
  t.is(getDecodedType('video/mov'), DecodedType.VIDEO);
});

test('should return correct decoded type for archive content types', (t) => {
  t.is(getDecodedType('application/zip'), DecodedType.ZIP);
  t.is(getDecodedType('application/gzip'), DecodedType.GZIP);
  t.is(getDecodedType('application/x-gzip'), DecodedType.GZIP);
});

test('should return correct decoded type for binary content types', (t) => {
  t.is(getDecodedType('application/octet-stream'), DecodedType.BINARY);
  t.is(getDecodedType('application/tar'), DecodedType.BINARY);
  t.is(getDecodedType('application/rar'), DecodedType.BINARY);
  t.is(getDecodedType('application/7z'), DecodedType.BINARY);
});

test('should return correct decoded type for document content types', (t) => {
  t.is(getDecodedType('application/pdf'), DecodedType.PDF);
  t.is(getDecodedType('application/sql'), DecodedType.SQL);
  t.is(getDecodedType('text/sql'), DecodedType.SQL);
  t.is(getDecodedType('application/graphql'), DecodedType.GRAPHQL);
});

test('should handle content type with parameters', (t) => {
  const contentTypesWithParams = [
    'application/json; charset=utf-8',
    'text/html; charset=iso-8859-1',
    'multipart/form-data; boundary=----WebKitFormBoundary',
    'application/x-www-form-urlencoded; charset=UTF-8',
  ];

  t.is(getDecodedType(contentTypesWithParams[0]), DecodedType.JSON);
  t.is(getDecodedType(contentTypesWithParams[1]), DecodedType.HTML);
  t.is(getDecodedType(contentTypesWithParams[2]), DecodedType.MULTIPART_FORM);
  t.is(getDecodedType(contentTypesWithParams[3]), DecodedType.FORM_DATA);
});

test('should handle array of content types', (t) => {
  t.is(getDecodedType(['application/json', 'text/plain']), DecodedType.JSON);
  t.is(getDecodedType(['text/html']), DecodedType.HTML);
});

test('should handle case insensitive content types', (t) => {
  t.is(getDecodedType('APPLICATION/JSON'), DecodedType.JSON);
  t.is(getDecodedType('Text/HTML'), DecodedType.HTML);
  t.is(getDecodedType('IMAGE/PNG'), DecodedType.PNG);
});

test('should return undefined for unknown content types', (t) => {
  t.is(getDecodedType('unknown/type'), undefined);
  t.is(getDecodedType('custom/format'), undefined);
  t.is(getDecodedType('application/custom'), undefined);
});

test('should return undefined for invalid input', (t) => {
  t.is(getDecodedType(undefined), undefined);
  t.is(getDecodedType(null as any), undefined);
  t.is(getDecodedType(''), undefined);
  t.is(getDecodedType([]), undefined);
  t.is(getDecodedType(123 as any), undefined);
});

test('should handle content types with extra whitespace', (t) => {
  t.is(getDecodedType(' application/json '), DecodedType.JSON);
  t.is(getDecodedType('  text/html; charset=utf-8  '), DecodedType.HTML);
});

test('should handle content types with complex parameters', (t) => {
  const complexContentType = 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW; charset=utf-8';
  t.is(getDecodedType(complexContentType), DecodedType.MULTIPART_FORM);
});
