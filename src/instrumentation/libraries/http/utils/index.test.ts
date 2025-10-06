import test from "ava";
import * as httpUtils from './index';

test("HTTP Utils Index - should export functions from bodyDecompression", (t) => {
  t.is(typeof httpUtils.decompressBuffer, "function");
  t.is(typeof httpUtils.isSupportedEncoding, "function");
  t.is(typeof httpUtils.normalizeHeaders, "function");
});

test("HTTP Utils Index - should export functions from binaryDataHandler", (t) => {
  t.is(typeof httpUtils.isUtf8, "function");
  t.is(typeof httpUtils.bufferToString, "function");
  t.is(typeof httpUtils.combineChunks, "function");
});

test("HTTP Utils Index - should export functions and enums from httpBodyEncoder", (t) => {
  t.is(typeof httpUtils.httpBodyEncoder, "function");
  t.is(typeof httpUtils.getDecodedType, "function");
  t.is(typeof httpUtils.HttpBodyType, "object");
  t.is(httpUtils.HttpBodyType.JSON, "JSON");
  t.is(httpUtils.HttpBodyType.TEXT, "TEXT");
});

test("HTTP Utils Index - should have all expected exports available", (t) => {
  const expectedExports = [
    // From bodyDecompression
    'decompressBuffer',
    'isSupportedEncoding',
    'normalizeHeaders',

    // From binaryDataHandler
    'isUtf8',
    'bufferToString',
    'combineChunks',

    // From httpBodyEncoder
    'httpBodyEncoder',
    'getDecodedType',
    'HttpBodyType'
  ];

  expectedExports.forEach(exportName => {
    t.true(httpUtils.hasOwnProperty(exportName) || (httpUtils as any)[exportName] !== undefined);
  });
});

test("HTTP Utils Index - should export HttpBodyType enum with correct values", (t) => {
  t.is(httpUtils.HttpBodyType.NONE, "NONE");
  t.is(httpUtils.HttpBodyType.JSON, "JSON");
  t.is(httpUtils.HttpBodyType.TEXT, "TEXT");
  t.is(httpUtils.HttpBodyType.RAW, "RAW");
  t.is(httpUtils.HttpBodyType.X_WWW_URL_FORM_URLENCODED, "X_WWW_URL_FORM_URLENCODED");
  t.is(httpUtils.HttpBodyType.MULTIPART, "MULTIPART");
  t.is(httpUtils.HttpBodyType.UNSPECIFIED, "UNSPECIFIED");
});

test("HTTP Utils Index - should work together - decompress, detect encoding, and encode", async (t) => {
  const originalData = 'Hello, World! This is integration test data.';
  const originalBuffer = Buffer.from(originalData, 'utf8');

  // Test that functions work together
  const isUtf8Result = httpUtils.isUtf8(originalBuffer);
  t.is(isUtf8Result, true);

  const bufferToStringResult = httpUtils.bufferToString(originalBuffer);
  t.is(bufferToStringResult.content, originalData);
  t.is(bufferToStringResult.encoding, "utf8");

  const httpBodyResult = await httpUtils.httpBodyEncoder({
    bodyBuffer: originalBuffer
  });
  t.is(httpBodyResult, originalBuffer.toString('base64'));
});

test("HTTP Utils Index - should work with compressed data integration", async (t) => {
  const zlib = await import('zlib');
  const originalData = 'Compressed integration test data';
  const originalBuffer = Buffer.from(originalData, 'utf8');
  const compressedBuffer = zlib.gzipSync(originalBuffer);

  // Test decompression
  const decompressed = await httpUtils.decompressBuffer(compressedBuffer, 'gzip');
  t.is(decompressed.toString('utf8'), originalData);

  // Test encoding
  const encoded = await httpUtils.httpBodyEncoder({
    bodyBuffer: compressedBuffer,
    contentEncoding: 'gzip'
  });
  t.is(encoded, originalBuffer.toString('base64'));
});

test("HTTP Utils Index - should work with binary data integration", async (t) => {
  const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);

  // Test binary detection
  const isUtf8Result = httpUtils.isUtf8(binaryData);
  t.is(isUtf8Result, false);

  // Test binary conversion
  const bufferToStringResult = httpUtils.bufferToString(binaryData);
  t.is(bufferToStringResult.encoding, "base64");

  // Test encoding
  const httpBodyResult = await httpUtils.httpBodyEncoder({
    bodyBuffer: binaryData
  });
  t.is(httpBodyResult, binaryData.toString('base64'));
});

test("HTTP Utils Index - should work with chunk combination integration", async (t) => {
  const chunks = ['Hello, ', 'beautiful ', 'World!'];
  const combinedBuffer = httpUtils.combineChunks(chunks);

  t.is(httpUtils.isUtf8(combinedBuffer), true);

  const stringResult = httpUtils.bufferToString(combinedBuffer);
  t.is(stringResult.content, 'Hello, beautiful World!');
  t.is(stringResult.encoding, "utf8");

  const encoded = await httpUtils.httpBodyEncoder({
    bodyBuffer: combinedBuffer
  });
  t.is(encoded, combinedBuffer.toString('base64'));
});
