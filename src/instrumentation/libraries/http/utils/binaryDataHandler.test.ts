import test from 'ava';
import { isUtf8, bufferToString, combineChunks } from './binaryDataHandler';

test("isUtf8 - should return true for empty buffer", (t) => {
  const buffer = Buffer.alloc(0);
  t.is(isUtf8(buffer), true);
});

test("isUtf8 - should return true for valid UTF-8 text", (t) => {
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
    t.is(isUtf8(buffer), true);
  });
});

test("isUtf8 - should return false for binary data", (t) => {
  // Create binary data that's not valid UTF-8
  const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]);
  t.is(isUtf8(binaryData), false);
});

test("isUtf8 - should return false for invalid UTF-8 sequences", (t) => {
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
    t.is(isUtf8(buffer), false);
  });
});

test("isUtf8 - should handle edge cases", (t) => {
  // Single valid UTF-8 byte
  t.is(isUtf8(Buffer.from([0x41])), true); // 'A'

  // Valid multi-byte UTF-8
  t.is(isUtf8(Buffer.from([0xC3, 0xA9])), true); // 'é'

  // Mixed valid and invalid (should be false)
  t.is(isUtf8(Buffer.from([0x41, 0xFF])), false);
});

test("bufferToString - should convert UTF-8 buffer to string with utf8 encoding", (t) => {
  const testStrings = [
    'Hello, World!',
    'Special chars: àáâãäå',
    'Unicode: 🌟🚀💯',
    'Multi-line\ntext\nhere',
  ];

  testStrings.forEach(str => {
    const buffer = Buffer.from(str, 'utf8');
    const result = bufferToString(buffer);

    t.is(result.content, str);
    t.is(result.encoding, 'utf8');
  });
});

test("bufferToString - should convert binary buffer to base64 string", (t) => {
  const binaryData = Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90, 0xAB, 0xCD]);
  const result = bufferToString(binaryData);

  t.is(result.content, binaryData.toString('base64'));
  t.is(result.encoding, 'base64');
});

test("bufferToString - should handle empty buffer", (t) => {
  const buffer = Buffer.alloc(0);
  const result = bufferToString(buffer);

  t.is(result.content, '');
  t.is(result.encoding, 'utf8');
});

test("bufferToString - should handle image data as base64", (t) => {
  // Simulate PNG header bytes
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const result = bufferToString(pngHeader);

  t.is(result.encoding, 'base64');
  t.is(result.content, pngHeader.toString('base64'));
});

test("bufferToString - should handle mixed content appropriately", (t) => {
  // Start with valid UTF-8 but add invalid bytes
  const mixedBuffer = Buffer.concat([
    Buffer.from('Hello '),
    Buffer.from([0xFF, 0xFE])
  ]);

  const result = bufferToString(mixedBuffer);
  t.is(result.encoding, 'base64');
});

test("combineChunks - should combine string chunks into a buffer", (t) => {
  const chunks = ['Hello, ', 'World!'];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.toString('utf8'), 'Hello, World!');
});

test("combineChunks - should combine buffer chunks", (t) => {
  const chunks = [
    Buffer.from('Hello, '),
    Buffer.from('World!')
  ];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.toString('utf8'), 'Hello, World!');
});

test("combineChunks - should combine mixed string and buffer chunks", (t) => {
  const chunks = [
    'Hello, ',
    Buffer.from('beautiful '),
    'World!'
  ];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.toString('utf8'), 'Hello, beautiful World!');
});

test("combineChunks - should handle empty chunks array", (t) => {
  const result = combineChunks([]);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.length, 0);
});

test("combineChunks - should handle empty strings and buffers", (t) => {
  const chunks = ['', Buffer.alloc(0), 'content', '', Buffer.from('more')];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.toString('utf8'), 'contentmore');
});

test("combineChunks - should handle binary data chunks", (t) => {
  const chunks = [
    Buffer.from([0xFF, 0xFE]),
    Buffer.from([0x00, 0x01]),
    Buffer.from([0x80, 0x90])
  ];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.deepEqual(result, Buffer.from([0xFF, 0xFE, 0x00, 0x01, 0x80, 0x90]));
});

test("combineChunks - should preserve encoding when combining", (t) => {
  const utf8Text = 'Héllo 🌟';
  const chunks = [
    utf8Text.slice(0, 3),
    utf8Text.slice(3)
  ];
  const result = combineChunks(chunks);

  t.is(result.toString('utf8'), utf8Text);
});

test("combineChunks - should handle large chunks efficiently", (t) => {
  const largeString = 'x'.repeat(10000);
  const chunks = [
    largeString.slice(0, 3000),
    largeString.slice(3000, 7000),
    largeString.slice(7000)
  ];
  const result = combineChunks(chunks);

  t.is(Buffer.isBuffer(result), true);
  t.is(result.toString('utf8'), largeString);
  t.is(result.length, 10000);
});
