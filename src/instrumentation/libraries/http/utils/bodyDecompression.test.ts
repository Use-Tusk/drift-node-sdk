import * as zlib from 'zlib';
import { decompressBuffer, isSupportedEncoding, normalizeHeaders } from './bodyDecompression';

describe('bodyDecompression', () => {
  describe('decompressBuffer', () => {
    const testData = 'Hello, World! This is test data for compression.';
    const testBuffer = Buffer.from(testData, 'utf8');

    it('should decompress gzip encoded data', async () => {
      const compressed = zlib.gzipSync(testBuffer);
      const decompressed = await decompressBuffer(compressed, 'gzip');

      expect(decompressed.toString('utf8')).toBe(testData);
    });

    it('should decompress deflate encoded data', async () => {
      const compressed = zlib.deflateSync(testBuffer);
      const decompressed = await decompressBuffer(compressed, 'deflate');

      expect(decompressed.toString('utf8')).toBe(testData);
    });

    it('should decompress brotli encoded data', async () => {
      const compressed = zlib.brotliCompressSync(testBuffer);
      const decompressed = await decompressBuffer(compressed, 'br');

      expect(decompressed.toString('utf8')).toBe(testData);
    });

    it('should handle case-insensitive encoding names', async () => {
      const compressed = zlib.gzipSync(testBuffer);

      const results = await Promise.all([
        decompressBuffer(compressed, 'GZIP'),
        decompressBuffer(compressed, 'Gzip'),
        decompressBuffer(compressed, 'gZiP'),
      ]);

      results.forEach(result => {
        expect(result.toString('utf8')).toBe(testData);
      });
    });

    it('should handle encoding names with whitespace', async () => {
      const gzipCompressed = zlib.gzipSync(testBuffer);
      const deflateCompressed = zlib.deflateSync(testBuffer);
      const brotliCompressed = zlib.brotliCompressSync(testBuffer);

      const results = await Promise.all([
        decompressBuffer(gzipCompressed, ' gzip '),
        decompressBuffer(deflateCompressed, '\tdeflate\t'),
        decompressBuffer(brotliCompressed, ' BR '),
      ]);

      // All should work since whitespace is trimmed
      expect(results[0].toString('utf8')).toBe(testData);
      expect(results[1].toString('utf8')).toBe(testData);
      expect(results[2].toString('utf8')).toBe(testData);
    });

    it('should return original buffer for unsupported encodings', async () => {
      const result = await decompressBuffer(testBuffer, 'unsupported');
      expect(result).toBe(testBuffer);
    });

    it('should return original buffer for empty encoding', async () => {
      const result = await decompressBuffer(testBuffer, '');
      expect(result).toBe(testBuffer);
    });

    it('should handle invalid compressed data gracefully', async () => {
      const invalidCompressed = Buffer.from('This is not compressed data');

      await expect(decompressBuffer(invalidCompressed, 'gzip')).rejects.toThrow();
    });

    it('should handle empty buffer', async () => {
      const emptyBuffer = Buffer.alloc(0);
      const compressed = zlib.gzipSync(emptyBuffer);
      const decompressed = await decompressBuffer(compressed, 'gzip');

      expect(decompressed.length).toBe(0);
    });

    it('should handle large data', async () => {
      const largeData = 'x'.repeat(100000);
      const largeBuffer = Buffer.from(largeData, 'utf8');
      const compressed = zlib.gzipSync(largeBuffer);
      const decompressed = await decompressBuffer(compressed, 'gzip');

      expect(decompressed.toString('utf8')).toBe(largeData);
    });

    it('should handle binary data', async () => {
      const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90, 0xAB, 0xCD]);
      const compressed = zlib.gzipSync(binaryData);
      const decompressed = await decompressBuffer(compressed, 'gzip');

      expect(decompressed).toEqual(binaryData);
    });

    it('should handle Unicode data', async () => {
      const unicodeData = 'Hello 🌟 World 💯 Test 🚀 Data ñoño café';
      const unicodeBuffer = Buffer.from(unicodeData, 'utf8');
      const compressed = zlib.gzipSync(unicodeBuffer);
      const decompressed = await decompressBuffer(compressed, 'gzip');

      expect(decompressed.toString('utf8')).toBe(unicodeData);
    });
  });

  describe('isSupportedEncoding', () => {
    it('should return true for supported encodings', () => {
      const supportedEncodings = ['gzip', 'deflate', 'br'];

      supportedEncodings.forEach(encoding => {
        expect(isSupportedEncoding(encoding)).toBe(true);
      });
    });

    it('should return true for case-insensitive supported encodings', () => {
      const caseVariations = [
        'GZIP', 'Gzip', 'gZiP',
        'DEFLATE', 'Deflate', 'dEfLaTe',
        'BR', 'Br', 'bR'
      ];

      caseVariations.forEach(encoding => {
        expect(isSupportedEncoding(encoding)).toBe(true);
      });
    });

    it('should handle encodings with whitespace', () => {
      const encodingsWithWhitespace = [
        ' gzip ', '\tdeflate\t', ' br ', '  GZIP  '
      ];

      encodingsWithWhitespace.forEach(encoding => {
        expect(isSupportedEncoding(encoding)).toBe(true);
      });
    });

    it('should return false for unsupported encodings', () => {
      const unsupportedEncodings = [
        'compress', 'lz4', 'snappy', 'lzma', 'xz', 'unknown', ''
      ];

      unsupportedEncodings.forEach(encoding => {
        expect(isSupportedEncoding(encoding)).toBe(false);
      });
    });

    it('should handle special characters and invalid inputs', () => {
      const invalidInputs = [
        'gzip@', 'deflate!', 'br#', 'gzip-modified', 'deflate+extra'
      ];

      invalidInputs.forEach(encoding => {
        expect(isSupportedEncoding(encoding)).toBe(false);
      });
    });
  });

  describe('normalizeHeaders', () => {
    it('should convert header names to lowercase', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'ACCEPT': 'text/html',
        'User-Agent': 'test-agent'
      };

      const normalized = normalizeHeaders(headers);

      expect(normalized).toEqual({
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'accept': 'text/html',
        'user-agent': 'test-agent'
      });
    });

    it('should preserve header values unchanged', () => {
      const headers = {
        'Content-Type': 'Application/JSON; charset=UTF-8',
        'Custom-Header': 'SOME-VALUE-WITH-CAPS',
        'Authorization': 'Bearer TOKEN123'
      };

      const normalized = normalizeHeaders(headers);

      expect(normalized['content-type']).toBe('Application/JSON; charset=UTF-8');
      expect(normalized['custom-header']).toBe('SOME-VALUE-WITH-CAPS');
      expect(normalized['authorization']).toBe('Bearer TOKEN123');
    });

    it('should handle empty headers object', () => {
      const normalized = normalizeHeaders({});
      expect(normalized).toEqual({});
    });

    it('should handle headers with various data types', () => {
      const headers = {
        'String-Header': 'string-value',
        'Number-Header': 42,
        'Boolean-Header': true,
        'Array-Header': ['value1', 'value2'],
        'Object-Header': { nested: 'object' }
      };

      const normalized = normalizeHeaders(headers);

      expect(normalized['string-header']).toBe('string-value');
      expect(normalized['number-header']).toBe(42);
      expect(normalized['boolean-header']).toBe(true);
      expect(normalized['array-header']).toEqual(['value1', 'value2']);
      expect(normalized['object-header']).toEqual({ nested: 'object' });
    });

    it('should handle headers with special characters in names', () => {
      const headers = {
        'X-Custom-Header': 'value1',
        'x-forwarded-for': 'value2',
        'cache-control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      };

      const normalized = normalizeHeaders(headers);

      expect(normalized['x-custom-header']).toBe('value1');
      expect(normalized['x-forwarded-for']).toBe('value2');
      expect(normalized['cache-control']).toBe('no-cache');
      expect(normalized['access-control-allow-origin']).toBe('*');
    });

    it('should handle duplicate headers with different cases', () => {
      const headers = {
        'content-type': 'text/plain',
        'Content-Type': 'application/json'
      };

      const normalized = normalizeHeaders(headers);

      // The second one should overwrite the first
      expect(normalized['content-type']).toBe('application/json');
      expect(Object.keys(normalized)).toHaveLength(1);
    });

    it('should handle null and undefined values', () => {
      const headers = {
        'Null-Header': null,
        'Undefined-Header': undefined,
        'Valid-Header': 'valid-value'
      };

      const normalized = normalizeHeaders(headers);

      expect(normalized['null-header']).toBeNull();
      expect(normalized['undefined-header']).toBeUndefined();
      expect(normalized['valid-header']).toBe('valid-value');
    });
  });
});