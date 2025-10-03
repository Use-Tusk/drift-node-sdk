import * as zlib from 'zlib';
import { httpBodyEncoder, getDecodedType, HttpBodyType } from './httpBodyEncoder';
import { DecodedType } from '../../../../core/tracing/JsonSchemaHelper';

describe('httpBodyEncoder', () => {
  describe('httpBodyEncoder function', () => {
    it('should base64 encode a simple buffer', async () => {
      const testData = 'Hello, World!';
      const buffer = Buffer.from(testData, 'utf8');

      const result = await httpBodyEncoder({ bodyBuffer: buffer });

      expect(result).toBe(buffer.toString('base64'));
    });

    it('should handle empty buffer', async () => {
      const buffer = Buffer.alloc(0);

      const result = await httpBodyEncoder({ bodyBuffer: buffer });

      expect(result).toBe('');
    });

    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);

      const result = await httpBodyEncoder({ bodyBuffer: binaryData });

      expect(result).toBe(binaryData.toString('base64'));
    });

    it('should decompress gzip before encoding', async () => {
      const originalData = 'This is test data that will be compressed with gzip';
      const originalBuffer = Buffer.from(originalData, 'utf8');
      const compressedBuffer = zlib.gzipSync(originalBuffer);

      const result = await httpBodyEncoder({
        bodyBuffer: compressedBuffer,
        contentEncoding: 'gzip'
      });

      expect(result).toBe(originalBuffer.toString('base64'));
    });

    it('should decompress deflate before encoding', async () => {
      const originalData = 'This is test data that will be compressed with deflate';
      const originalBuffer = Buffer.from(originalData, 'utf8');
      const compressedBuffer = zlib.deflateSync(originalBuffer);

      const result = await httpBodyEncoder({
        bodyBuffer: compressedBuffer,
        contentEncoding: 'deflate'
      });

      expect(result).toBe(originalBuffer.toString('base64'));
    });

    it('should decompress brotli before encoding', async () => {
      const originalData = 'This is test data that will be compressed with brotli';
      const originalBuffer = Buffer.from(originalData, 'utf8');
      const compressedBuffer = zlib.brotliCompressSync(originalBuffer);

      const result = await httpBodyEncoder({
        bodyBuffer: compressedBuffer,
        contentEncoding: 'br'
      });

      expect(result).toBe(originalBuffer.toString('base64'));
    });

    it('should handle unsupported content encoding gracefully', async () => {
      const testData = 'Test data with unsupported encoding';
      const buffer = Buffer.from(testData, 'utf8');

      const result = await httpBodyEncoder({
        bodyBuffer: buffer,
        contentEncoding: 'unsupported'
      });

      expect(result).toBe(buffer.toString('base64'));
    });

    it('should handle invalid compressed data gracefully', async () => {
      const invalidCompressed = Buffer.from('This is not actually compressed data');

      const result = await httpBodyEncoder({
        bodyBuffer: invalidCompressed,
        contentEncoding: 'gzip'
      });

      // Should fall back to encoding the original buffer
      expect(result).toBe(invalidCompressed.toString('base64'));
    });

    it('should handle case-insensitive content encoding', async () => {
      const originalData = 'Test data for case insensitive encoding';
      const originalBuffer = Buffer.from(originalData, 'utf8');
      const compressedBuffer = zlib.gzipSync(originalBuffer);

      const results = await Promise.all([
        httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'GZIP' }),
        httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'Gzip' }),
        httpBodyEncoder({ bodyBuffer: compressedBuffer, contentEncoding: 'gzip' }),
      ]);

      results.forEach(result => {
        expect(result).toBe(originalBuffer.toString('base64'));
      });
    });

    it('should handle Unicode data correctly', async () => {
      const unicodeData = 'Hello 🌟 World 💯 Café ñoño 中文 Привет';
      const buffer = Buffer.from(unicodeData, 'utf8');

      const result = await httpBodyEncoder({ bodyBuffer: buffer });

      expect(result).toBe(buffer.toString('base64'));

      // Verify round trip
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      expect(decoded).toBe(unicodeData);
    });

    it('should handle large buffers efficiently', async () => {
      const largeData = 'x'.repeat(100000);
      const buffer = Buffer.from(largeData, 'utf8');

      const result = await httpBodyEncoder({ bodyBuffer: buffer });

      expect(result).toBe(buffer.toString('base64'));
      expect(typeof result).toBe('string');
    });
  });

  describe('getDecodedType function', () => {
    it('should return correct decoded type for JSON content types', () => {
      expect(getDecodedType('application/json')).toBe(DecodedType.JSON);
      expect(getDecodedType('application/json; charset=utf-8')).toBe(DecodedType.JSON);
    });

    it('should return correct decoded type for text content types', () => {
      expect(getDecodedType('text/html')).toBe(DecodedType.HTML);
      expect(getDecodedType('text/css')).toBe(DecodedType.CSS);
      expect(getDecodedType('text/plain')).toBe(DecodedType.PLAIN_TEXT);
      expect(getDecodedType('text/markdown')).toBe(DecodedType.MARKDOWN);
      expect(getDecodedType('text/csv')).toBe(DecodedType.CSV);
    });

    it('should return correct decoded type for JavaScript content types', () => {
      expect(getDecodedType('text/javascript')).toBe(DecodedType.JAVASCRIPT);
      expect(getDecodedType('application/javascript')).toBe(DecodedType.JAVASCRIPT);
      expect(getDecodedType('application/x-javascript')).toBe(DecodedType.JAVASCRIPT);
    });

    it('should return correct decoded type for XML content types', () => {
      expect(getDecodedType('text/xml')).toBe(DecodedType.XML);
      expect(getDecodedType('application/xml')).toBe(DecodedType.XML);
      expect(getDecodedType('image/svg+xml')).toBe(DecodedType.SVG);
    });

    it('should return correct decoded type for YAML content types', () => {
      expect(getDecodedType('application/yaml')).toBe(DecodedType.YAML);
      expect(getDecodedType('application/x-yaml')).toBe(DecodedType.YAML);
      expect(getDecodedType('text/yaml')).toBe(DecodedType.YAML);
      expect(getDecodedType('text/x-yaml')).toBe(DecodedType.YAML);
    });

    it('should return correct decoded type for form data content types', () => {
      expect(getDecodedType('application/x-www-form-urlencoded')).toBe(DecodedType.FORM_DATA);
      expect(getDecodedType('multipart/form-data')).toBe(DecodedType.MULTIPART_FORM);
      expect(getDecodedType('multipart/form-data; boundary=something')).toBe(DecodedType.MULTIPART_FORM);
    });

    it('should return correct decoded type for image content types', () => {
      expect(getDecodedType('image/jpeg')).toBe(DecodedType.JPEG);
      expect(getDecodedType('image/jpg')).toBe(DecodedType.JPEG);
      expect(getDecodedType('image/png')).toBe(DecodedType.PNG);
      expect(getDecodedType('image/gif')).toBe(DecodedType.GIF);
      expect(getDecodedType('image/webp')).toBe(DecodedType.WEBP);
      expect(getDecodedType('image/bmp')).toBe(DecodedType.JPEG);
      expect(getDecodedType('image/tiff')).toBe(DecodedType.JPEG);
      expect(getDecodedType('image/ico')).toBe(DecodedType.PNG);
    });

    it('should return correct decoded type for audio content types', () => {
      expect(getDecodedType('audio/mpeg')).toBe(DecodedType.AUDIO);
      expect(getDecodedType('audio/mp3')).toBe(DecodedType.AUDIO);
      expect(getDecodedType('audio/wav')).toBe(DecodedType.AUDIO);
      expect(getDecodedType('audio/ogg')).toBe(DecodedType.AUDIO);
      expect(getDecodedType('audio/webm')).toBe(DecodedType.AUDIO);
    });

    it('should return correct decoded type for video content types', () => {
      expect(getDecodedType('video/mp4')).toBe(DecodedType.VIDEO);
      expect(getDecodedType('video/webm')).toBe(DecodedType.VIDEO);
      expect(getDecodedType('video/ogg')).toBe(DecodedType.VIDEO);
      expect(getDecodedType('video/avi')).toBe(DecodedType.VIDEO);
      expect(getDecodedType('video/mov')).toBe(DecodedType.VIDEO);
    });

    it('should return correct decoded type for archive content types', () => {
      expect(getDecodedType('application/zip')).toBe(DecodedType.ZIP);
      expect(getDecodedType('application/gzip')).toBe(DecodedType.GZIP);
      expect(getDecodedType('application/x-gzip')).toBe(DecodedType.GZIP);
    });

    it('should return correct decoded type for binary content types', () => {
      expect(getDecodedType('application/octet-stream')).toBe(DecodedType.BINARY);
      expect(getDecodedType('application/tar')).toBe(DecodedType.BINARY);
      expect(getDecodedType('application/rar')).toBe(DecodedType.BINARY);
      expect(getDecodedType('application/7z')).toBe(DecodedType.BINARY);
    });

    it('should return correct decoded type for document content types', () => {
      expect(getDecodedType('application/pdf')).toBe(DecodedType.PDF);
      expect(getDecodedType('application/sql')).toBe(DecodedType.SQL);
      expect(getDecodedType('text/sql')).toBe(DecodedType.SQL);
      expect(getDecodedType('application/graphql')).toBe(DecodedType.GRAPHQL);
    });

    it('should handle content type with parameters', () => {
      const contentTypesWithParams = [
        'application/json; charset=utf-8',
        'text/html; charset=iso-8859-1',
        'multipart/form-data; boundary=----WebKitFormBoundary',
        'application/x-www-form-urlencoded; charset=UTF-8',
      ];

      expect(getDecodedType(contentTypesWithParams[0])).toBe(DecodedType.JSON);
      expect(getDecodedType(contentTypesWithParams[1])).toBe(DecodedType.HTML);
      expect(getDecodedType(contentTypesWithParams[2])).toBe(DecodedType.MULTIPART_FORM);
      expect(getDecodedType(contentTypesWithParams[3])).toBe(DecodedType.FORM_DATA);
    });

    it('should handle array of content types', () => {
      expect(getDecodedType(['application/json', 'text/plain'])).toBe(DecodedType.JSON);
      expect(getDecodedType(['text/html'])).toBe(DecodedType.HTML);
    });

    it('should handle case insensitive content types', () => {
      expect(getDecodedType('APPLICATION/JSON')).toBe(DecodedType.JSON);
      expect(getDecodedType('Text/HTML')).toBe(DecodedType.HTML);
      expect(getDecodedType('IMAGE/PNG')).toBe(DecodedType.PNG);
    });

    it('should return undefined for unknown content types', () => {
      expect(getDecodedType('unknown/type')).toBeUndefined();
      expect(getDecodedType('custom/format')).toBeUndefined();
      expect(getDecodedType('application/custom')).toBeUndefined();
    });

    it('should return undefined for invalid input', () => {
      expect(getDecodedType(undefined)).toBeUndefined();
      expect(getDecodedType(null as any)).toBeUndefined();
      expect(getDecodedType('')).toBeUndefined();
      expect(getDecodedType([])).toBeUndefined();
      expect(getDecodedType(123 as any)).toBeUndefined();
    });

    it('should handle content types with extra whitespace', () => {
      expect(getDecodedType(' application/json ')).toBe(DecodedType.JSON);
      expect(getDecodedType('  text/html; charset=utf-8  ')).toBe(DecodedType.HTML);
    });

    it('should handle content types with complex parameters', () => {
      const complexContentType = 'multipart/form-data; boundary=----WebKitFormBoundary7MA4YWxkTrZu0gW; charset=utf-8';
      expect(getDecodedType(complexContentType)).toBe(DecodedType.MULTIPART_FORM);
    });
  });

  describe('HttpBodyType enum', () => {
    it('should have correct enum values', () => {
      expect(HttpBodyType.NONE).toBe('NONE');
      expect(HttpBodyType.JSON).toBe('JSON');
      expect(HttpBodyType.TEXT).toBe('TEXT');
      expect(HttpBodyType.RAW).toBe('RAW');
      expect(HttpBodyType.X_WWW_URL_FORM_URLENCODED).toBe('X_WWW_URL_FORM_URLENCODED');
      expect(HttpBodyType.MULTIPART).toBe('MULTIPART');
      expect(HttpBodyType.UNSPECIFIED).toBe('UNSPECIFIED');
    });
  });
});