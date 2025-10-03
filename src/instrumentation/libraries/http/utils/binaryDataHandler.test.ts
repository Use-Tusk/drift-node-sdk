import { isUtf8, bufferToString, combineChunks } from './binaryDataHandler';

describe('binaryDataHandler', () => {
  describe('isUtf8', () => {
    it('should return true for empty buffer', () => {
      const buffer = Buffer.alloc(0);
      expect(isUtf8(buffer)).toBe(true);
    });

    it('should return true for valid UTF-8 text', () => {
      const validUtf8Strings = [
        'Hello, World!',
        'ASCII text',
        'Café',
        'こんにちは', // Japanese
        '🌟 Emoji 🚀',
        'Ñoño español',
        'Привет мир', // Russian
        '中文', // Chinese
      ];

      validUtf8Strings.forEach(str => {
        const buffer = Buffer.from(str, 'utf8');
        expect(isUtf8(buffer)).toBe(true);
      });
    });

    it('should return false for binary data', () => {
      // Create binary data that's not valid UTF-8
      const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);
      expect(isUtf8(binaryData)).toBe(false);
    });

    it('should return false for invalid UTF-8 sequences', () => {
      // Invalid UTF-8 sequences
      const invalidSequences = [
        [0xC0, 0x80], // Overlong encoding
        [0xE0, 0x80, 0x80], // Overlong encoding
        [0xF0, 0x80, 0x80, 0x80], // Overlong encoding
        [0xFF, 0xFF], // Invalid start bytes
        [0x80, 0x80], // Continuation bytes without start
        [0xC2], // Incomplete sequence
      ];

      invalidSequences.forEach(sequence => {
        const buffer = Buffer.from(sequence);
        expect(isUtf8(buffer)).toBe(false);
      });
    });

    it('should handle edge cases', () => {
      // Single valid UTF-8 byte
      expect(isUtf8(Buffer.from([0x41]))).toBe(true); // 'A'

      // Valid multi-byte UTF-8
      expect(isUtf8(Buffer.from([0xC3, 0xA9]))).toBe(true); // 'é'

      // Mixed valid and invalid (should be false)
      expect(isUtf8(Buffer.from([0x41, 0xFF]))).toBe(false);
    });
  });

  describe('bufferToString', () => {
    it('should convert UTF-8 buffer to string with utf8 encoding', () => {
      const testStrings = [
        'Hello, World!',
        'Special chars: àáâãäå',
        'Unicode: 🌟🚀💯',
        'Multi-line\ntext\nhere',
      ];

      testStrings.forEach(str => {
        const buffer = Buffer.from(str, 'utf8');
        const result = bufferToString(buffer);

        expect(result.content).toBe(str);
        expect(result.encoding).toBe('utf8');
      });
    });

    it('should convert binary buffer to base64 string', () => {
      const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90, 0xAB, 0xCD]);
      const result = bufferToString(binaryData);

      expect(result.content).toBe(binaryData.toString('base64'));
      expect(result.encoding).toBe('base64');
    });

    it('should handle empty buffer', () => {
      const buffer = Buffer.alloc(0);
      const result = bufferToString(buffer);

      expect(result.content).toBe('');
      expect(result.encoding).toBe('utf8');
    });

    it('should handle image data as base64', () => {
      // Simulate PNG header bytes
      const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      const result = bufferToString(pngHeader);

      expect(result.encoding).toBe('base64');
      expect(result.content).toBe(pngHeader.toString('base64'));
    });

    it('should handle mixed content appropriately', () => {
      // Start with valid UTF-8 but add invalid bytes
      const mixedBuffer = Buffer.concat([
        Buffer.from('Hello '),
        Buffer.from([0xFF, 0xFE])
      ]);

      const result = bufferToString(mixedBuffer);
      expect(result.encoding).toBe('base64');
    });
  });

  describe('combineChunks', () => {
    it('should combine string chunks into a buffer', () => {
      const chunks = ['Hello, ', 'World!'];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('Hello, World!');
    });

    it('should combine buffer chunks', () => {
      const chunks = [
        Buffer.from('Hello, '),
        Buffer.from('World!')
      ];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('Hello, World!');
    });

    it('should combine mixed string and buffer chunks', () => {
      const chunks = [
        'Hello, ',
        Buffer.from('beautiful '),
        'World!'
      ];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('Hello, beautiful World!');
    });

    it('should handle empty chunks array', () => {
      const result = combineChunks([]);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('should handle empty strings and buffers', () => {
      const chunks = ['', Buffer.alloc(0), 'content', '', Buffer.from('more')];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe('contentmore');
    });

    it('should handle binary data chunks', () => {
      const chunks = [
        Buffer.from([0xFF, 0xFE]),
        Buffer.from([0x00, 0x01]),
        Buffer.from([0x80, 0x90])
      ];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result).toEqual(Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]));
    });

    it('should preserve encoding when combining', () => {
      const utf8Text = 'Héllo 🌟';
      const chunks = [
        utf8Text.slice(0, 3),
        utf8Text.slice(3)
      ];
      const result = combineChunks(chunks);

      expect(result.toString('utf8')).toBe(utf8Text);
    });

    it('should handle large chunks efficiently', () => {
      const largeString = 'x'.repeat(10000);
      const chunks = [
        largeString.slice(0, 3000),
        largeString.slice(3000, 7000),
        largeString.slice(7000)
      ];
      const result = combineChunks(chunks);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString('utf8')).toBe(largeString);
      expect(result.length).toBe(10000);
    });
  });
});