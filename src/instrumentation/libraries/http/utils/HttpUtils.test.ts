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

describe('HTTP Utils', () => {
  describe('Body Decompression', () => {
    describe('decompressBuffer', () => {
      it('should decompress gzip encoded data', async () => {
        const original = Buffer.from('Hello, World!');
        const zlib = require('zlib');
        const compressed = zlib.gzipSync(original);
        const decompressed = await decompressBuffer(compressed, 'gzip');
        expect(decompressed.toString()).toBe('Hello, World!');
      });

      it('should decompress deflate encoded data', async () => {
        const original = Buffer.from('Hello, World!');
        const zlib = require('zlib');
        const compressed = zlib.deflateSync(original);
        const decompressed = await decompressBuffer(compressed, 'deflate');
        expect(decompressed.toString()).toBe('Hello, World!');
      });

      it('should handle unsupported encodings', async () => {
        const buffer = Buffer.from('test data');
        const result = await decompressBuffer(buffer, 'unsupported');
        expect(result).toBe(buffer);
      });

      it('should handle invalid compressed data gracefully', async () => {
        const invalidData = Buffer.from('not compressed data');
        try {
          const result = await decompressBuffer(invalidData, 'gzip');
          // If it doesn't throw, it should return the original buffer
          expect(result).toBe(invalidData);
        } catch (error) {
          // If it throws, that's also acceptable behavior for invalid data
          expect(error).toBeDefined();
        }
      });
    });

    describe('isSupportedEncoding', () => {
      it('should return true for supported encodings', () => {
        expect(isSupportedEncoding('gzip')).toBe(true);
        expect(isSupportedEncoding('deflate')).toBe(true);
        expect(isSupportedEncoding('br')).toBe(true);
      });

      it('should return false for unsupported encodings', () => {
        expect(isSupportedEncoding('unsupported')).toBe(false);
        expect(isSupportedEncoding('')).toBe(false);
      });
    });

    describe('normalizeHeaders', () => {
      it('should convert header names to lowercase', () => {
        const headers = { 'Content-Type': 'application/json', 'AUTHORIZATION': 'Bearer token' };
        const normalized = normalizeHeaders(headers);
        expect(normalized['content-type']).toBe('application/json');
        expect(normalized['authorization']).toBe('Bearer token');
      });

      it('should handle empty headers object', () => {
        const result = normalizeHeaders({});
        expect(result).toEqual({});
      });
    });
  });

  describe('Binary Data Handler', () => {
    describe('isUtf8', () => {
      it('should return true for valid UTF-8 text', () => {
        const buffer = Buffer.from('Hello, World!', 'utf8');
        expect(isUtf8(buffer)).toBe(true);
      });

      it('should return false for binary data', () => {
        const buffer = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);
        expect(isUtf8(buffer)).toBe(false);
      });

      it('should return true for empty buffer', () => {
        const buffer = Buffer.alloc(0);
        expect(isUtf8(buffer)).toBe(true);
      });
    });

    describe('bufferToString', () => {
      it('should convert UTF-8 buffer to string', () => {
        const buffer = Buffer.from('Hello, World!', 'utf8');
        const result = bufferToString(buffer);
        expect(result.content).toBe('Hello, World!');
        expect(result.encoding).toBe('utf8');
      });

      it('should convert binary buffer to base64 string', () => {
        const buffer = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);
        const result = bufferToString(buffer);
        expect(result.content).toBe(buffer.toString('base64'));
        expect(result.encoding).toBe('base64');
      });

      it('should handle empty buffer', () => {
        const buffer = Buffer.alloc(0);
        const result = bufferToString(buffer);
        expect(result.content).toBe('');
        expect(result.encoding).toBe('utf8');
      });
    });

    describe('combineChunks', () => {
      it('should combine string chunks into a buffer', () => {
        const chunks = ['Hello, ', 'World!'];
        const result = combineChunks(chunks);
        expect(result.toString()).toBe('Hello, World!');
      });

      it('should combine buffer chunks', () => {
        const chunks = [Buffer.from('Hello, '), Buffer.from('World!')];
        const result = combineChunks(chunks);
        expect(result.toString()).toBe('Hello, World!');
      });

      it('should handle empty chunks array', () => {
        const result = combineChunks([]);
        expect(result).toEqual(Buffer.alloc(0));
      });
    });
  });

  describe('HTTP Body Encoder', () => {
    describe('httpBodyEncoder', () => {
      it('should base64 encode a simple buffer', async () => {
        const buffer = Buffer.from('Hello, World!');
        const result = await httpBodyEncoder({ bodyBuffer: buffer });
        expect(result).toBe(buffer.toString('base64'));
      });

      it('should handle empty buffer', async () => {
        const buffer = Buffer.alloc(0);
        const result = await httpBodyEncoder({ bodyBuffer: buffer });
        expect(result).toBe('');
      });

      it('should decompress gzip before encoding', async () => {
        const original = Buffer.from('Hello, World!');
        const zlib = require('zlib');
        const compressed = zlib.gzipSync(original);
        const result = await httpBodyEncoder({
          bodyBuffer: compressed,
          contentEncoding: 'gzip'
        });
        expect(result).toBe(original.toString('base64'));
      });

      it('should handle unsupported content encoding gracefully', async () => {
        const buffer = Buffer.from('Hello, World!');
        const result = await httpBodyEncoder({
          bodyBuffer: buffer,
          contentEncoding: 'unsupported'
        });
        expect(result).toBe(buffer.toString('base64'));
      });
    });

    describe('getDecodedType', () => {
      it('should return correct decoded type for JSON content types', () => {
        expect(getDecodedType('application/json')).toBe(HttpBodyType.JSON);
        expect(getDecodedType('application/json; charset=utf-8')).toBe(HttpBodyType.JSON);
      });

      it('should return correct decoded type for text content types', () => {
        // Based on the actual enum and mapping, text/plain maps to PLAIN_TEXT, not TEXT
        expect(getDecodedType('text/plain')).toBe('PLAIN_TEXT');
        expect(getDecodedType('text/html')).toBe('HTML');
      });

      it('should return undefined for unknown content types', () => {
        expect(getDecodedType('unknown/type')).toBeUndefined();
        expect(getDecodedType('')).toBeUndefined();
      });

      it('should handle array of content types', () => {
        expect(getDecodedType(['application/json', 'text/plain'])).toBe(HttpBodyType.JSON);
      });

      it('should handle case insensitive content types', () => {
        expect(getDecodedType('APPLICATION/JSON')).toBe(HttpBodyType.JSON);
      });
    });

    describe('HttpBodyType enum', () => {
      it('should have correct enum values', () => {
        expect(HttpBodyType.JSON).toBe('JSON');
        expect(HttpBodyType.TEXT).toBe('TEXT');
        expect(HttpBodyType.RAW).toBe('RAW');
        expect(HttpBodyType.NONE).toBe('NONE');
      });
    });
  });

  describe('Integration', () => {
    it('should work together - decompress, detect encoding, and encode', async () => {
      const originalData = JSON.stringify({ message: 'Hello, World!' });
      const buffer = Buffer.from(originalData);
      const zlib = require('zlib');
      const compressed = zlib.gzipSync(buffer);

      // Decompress
      const decompressed = await decompressBuffer(compressed, 'gzip');
      expect(decompressed.toString()).toBe(originalData);

      // Encode
      const encoded = await httpBodyEncoder({ bodyBuffer: decompressed });
      expect(encoded).toBe(buffer.toString('base64'));

      // Get type
      const type = getDecodedType('application/json');
      expect(type).toBe(HttpBodyType.JSON);
    });

    it('should handle binary data flow', async () => {
      const binaryData = Buffer.from([0x00, 0x01, 0xFF, 0xFE]);

      // Check if binary
      expect(isUtf8(binaryData)).toBe(false);

      // Convert to string (should be base64)
      const stringified = bufferToString(binaryData);
      expect(stringified.content).toBe(binaryData.toString('base64'));
      expect(stringified.encoding).toBe('base64');

      // Encode through httpBodyEncoder
      const encoded = await httpBodyEncoder({ bodyBuffer: binaryData });
      expect(encoded).toBe(binaryData.toString('base64'));
    });
  });
});