import * as httpUtils from './index';

describe('HTTP Utils Index', () => {
  describe('exports', () => {
    it('should export functions from bodyDecompression', () => {
      expect(typeof httpUtils.decompressBuffer).toBe('function');
      expect(typeof httpUtils.isSupportedEncoding).toBe('function');
      expect(typeof httpUtils.normalizeHeaders).toBe('function');
    });

    it('should export functions from binaryDataHandler', () => {
      expect(typeof httpUtils.isUtf8).toBe('function');
      expect(typeof httpUtils.bufferToString).toBe('function');
      expect(typeof httpUtils.combineChunks).toBe('function');
    });

    it('should export functions and enums from httpBodyEncoder', () => {
      expect(typeof httpUtils.httpBodyEncoder).toBe('function');
      expect(typeof httpUtils.getDecodedType).toBe('function');
      expect(typeof httpUtils.HttpBodyType).toBe('object');
      expect(httpUtils.HttpBodyType.JSON).toBe('JSON');
      expect(httpUtils.HttpBodyType.TEXT).toBe('TEXT');
    });

    it('should have all expected exports available', () => {
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
        expect(httpUtils).toHaveProperty(exportName);
      });
    });

    it('should export HttpBodyType enum with correct values', () => {
      expect(httpUtils.HttpBodyType.NONE).toBe('NONE');
      expect(httpUtils.HttpBodyType.JSON).toBe('JSON');
      expect(httpUtils.HttpBodyType.TEXT).toBe('TEXT');
      expect(httpUtils.HttpBodyType.RAW).toBe('RAW');
      expect(httpUtils.HttpBodyType.X_WWW_URL_FORM_URLENCODED).toBe('X_WWW_URL_FORM_URLENCODED');
      expect(httpUtils.HttpBodyType.MULTIPART).toBe('MULTIPART');
      expect(httpUtils.HttpBodyType.UNSPECIFIED).toBe('UNSPECIFIED');
    });
  });

  describe('integration test', () => {
    it('should work together - decompress, detect encoding, and encode', async () => {
      const originalData = 'Hello, World! This is integration test data.';
      const originalBuffer = Buffer.from(originalData, 'utf8');

      // Test that functions work together
      const isUtf8Result = httpUtils.isUtf8(originalBuffer);
      expect(isUtf8Result).toBe(true);

      const bufferToStringResult = httpUtils.bufferToString(originalBuffer);
      expect(bufferToStringResult.content).toBe(originalData);
      expect(bufferToStringResult.encoding).toBe('utf8');

      const httpBodyResult = await httpUtils.httpBodyEncoder({
        bodyBuffer: originalBuffer
      });
      expect(httpBodyResult).toBe(originalBuffer.toString('base64'));
    });

    it('should work with compressed data integration', async () => {
      const zlib = await import('zlib');
      const originalData = 'Compressed integration test data';
      const originalBuffer = Buffer.from(originalData, 'utf8');
      const compressedBuffer = zlib.gzipSync(originalBuffer);

      // Test decompression
      const decompressed = await httpUtils.decompressBuffer(compressedBuffer, 'gzip');
      expect(decompressed.toString('utf8')).toBe(originalData);

      // Test encoding
      const encoded = await httpUtils.httpBodyEncoder({
        bodyBuffer: compressedBuffer,
        contentEncoding: 'gzip'
      });
      expect(encoded).toBe(originalBuffer.toString('base64'));
    });

    it('should work with binary data integration', async () => {
      const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);

      // Test binary detection
      const isUtf8Result = httpUtils.isUtf8(binaryData);
      expect(isUtf8Result).toBe(false);

      // Test binary conversion
      const bufferToStringResult = httpUtils.bufferToString(binaryData);
      expect(bufferToStringResult.encoding).toBe('base64');

      // Test encoding
      const httpBodyResult = await httpUtils.httpBodyEncoder({
        bodyBuffer: binaryData
      });
      expect(httpBodyResult).toBe(binaryData.toString('base64'));
    });

    it('should work with chunk combination integration', async () => {
      const chunks = ['Hello, ', 'beautiful ', 'World!'];
      const combinedBuffer = httpUtils.combineChunks(chunks);

      expect(httpUtils.isUtf8(combinedBuffer)).toBe(true);

      const stringResult = httpUtils.bufferToString(combinedBuffer);
      expect(stringResult.content).toBe('Hello, beautiful World!');
      expect(stringResult.encoding).toBe('utf8');

      const encoded = await httpUtils.httpBodyEncoder({
        bodyBuffer: combinedBuffer
      });
      expect(encoded).toBe(combinedBuffer.toString('base64'));
    });
  });
});