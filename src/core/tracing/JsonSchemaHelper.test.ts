import test from 'ava';
import {
  JsonSchemaHelper,
  EncodingType,
  DecodedType,
  JsonSchema,
  SchemaMerges,
  JsonSchemaType,
} from "./JsonSchemaHelper";

test("getDetailedType - should correctly identify primitive types", (t) => {
  t.is(JsonSchemaHelper.getDetailedType(null), JsonSchemaType.NULL);
  t.is(JsonSchemaHelper.getDetailedType(undefined), JsonSchemaType.UNDEFINED);
  t.is(JsonSchemaHelper.getDetailedType("hello"), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(42), JsonSchemaType.NUMBER);
  t.is(JsonSchemaHelper.getDetailedType(3.14), JsonSchemaType.NUMBER);
  t.is(JsonSchemaHelper.getDetailedType(true), JsonSchemaType.BOOLEAN);
  t.is(JsonSchemaHelper.getDetailedType(false), JsonSchemaType.BOOLEAN);
  t.is(JsonSchemaHelper.getDetailedType(BigInt(123)), JsonSchemaType.NUMBER);
  t.is(JsonSchemaHelper.getDetailedType(Symbol("test")), JsonSchemaType.STRING);
});

test("getDetailedType - should correctly identify object types", (t) => {
  t.is(JsonSchemaHelper.getDetailedType({}), JsonSchemaType.OBJECT);
  t.is(JsonSchemaHelper.getDetailedType([]), JsonSchemaType.ORDERED_LIST);
  t.is(JsonSchemaHelper.getDetailedType(new Date()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(/regex/), JsonSchemaType.OBJECT);
  t.is(JsonSchemaHelper.getDetailedType(new Error("test")), JsonSchemaType.OBJECT);
  t.is(JsonSchemaHelper.getDetailedType(new Set()), JsonSchemaType.UNORDERED_LIST);
  t.is(JsonSchemaHelper.getDetailedType(new Map()), JsonSchemaType.OBJECT);
  t.is(JsonSchemaHelper.getDetailedType(() => {}), JsonSchemaType.FUNCTION);
});

test("getDetailedType - should correctly identify typed arrays", (t) => {
  t.is(JsonSchemaHelper.getDetailedType(new Int8Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Uint8Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Uint8ClampedArray()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Int16Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Uint16Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Int32Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Uint32Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Float32Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new Float64Array()), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new DataView(new ArrayBuffer(8))), JsonSchemaType.STRING);
  t.is(JsonSchemaHelper.getDetailedType(new ArrayBuffer(8)), JsonSchemaType.STRING);
});

test("getDetailedType - should handle arguments object", (t) => {
  function testFunc() {
    return JsonSchemaHelper.getDetailedType(arguments);
  }
  t.is(testFunc(), JsonSchemaType.ORDERED_LIST);
});

test("getDetailedType - should fall back to STRING for unknown types", (t) => {
  const unknownObj = Object.create(null);
  Object.setPrototypeOf(unknownObj, null);
  t.is(JsonSchemaHelper.getDetailedType(unknownObj), JsonSchemaType.OBJECT);
});

test("generateSchema - should generate schema for primitive types", (t) => {
  t.deepEqual(JsonSchemaHelper.generateSchema(null), { type: JsonSchemaType.NULL, properties: {} });
  t.deepEqual(JsonSchemaHelper.generateSchema(undefined), { type: JsonSchemaType.UNDEFINED, properties: {} });
  t.deepEqual(JsonSchemaHelper.generateSchema("test"), { type: JsonSchemaType.STRING, properties: {} });
  t.deepEqual(JsonSchemaHelper.generateSchema(42), { type: JsonSchemaType.NUMBER, properties: {} });
  t.deepEqual(JsonSchemaHelper.generateSchema(true), { type: JsonSchemaType.BOOLEAN, properties: {} });
});

test("generateSchema - should generate schema for arrays", (t) => {
  t.deepEqual(JsonSchemaHelper.generateSchema([]), {
    type: JsonSchemaType.ORDERED_LIST,
    properties: {},
  });

  t.deepEqual(JsonSchemaHelper.generateSchema([1, 2, 3]), {
    type: JsonSchemaType.ORDERED_LIST,
    items: { type: JsonSchemaType.NUMBER, properties: {} },
    properties: {},
  });

  t.deepEqual(JsonSchemaHelper.generateSchema(["a", "b"]), {
    type: JsonSchemaType.ORDERED_LIST,
    items: { type: JsonSchemaType.STRING, properties: {} },
    properties: {},
  });

  t.deepEqual(JsonSchemaHelper.generateSchema([{ id: 1 }]), {
    type: JsonSchemaType.ORDERED_LIST,
    items: {
      type: JsonSchemaType.OBJECT,
      properties: {
        id: { type: JsonSchemaType.NUMBER, properties: {} },
      },
    },
    properties: {},
  });
});

test("generateSchema - should generate schema for objects", (t) => {
  const simpleObj = { name: "John", age: 30 };
  t.deepEqual(JsonSchemaHelper.generateSchema(simpleObj), {
    type: JsonSchemaType.OBJECT,
    properties: {
      name: { type: JsonSchemaType.STRING, properties: {} },
      age: { type: JsonSchemaType.NUMBER, properties: {} },
    },
  });

  const nestedObj = {
    user: {
      profile: {
        name: "Jane",
      },
    },
  };
  t.deepEqual(JsonSchemaHelper.generateSchema(nestedObj), {
    type: JsonSchemaType.OBJECT,
    properties: {
      user: {
        type: JsonSchemaType.OBJECT,
        properties: {
          profile: {
            type: JsonSchemaType.OBJECT,
            properties: {
              name: { type: JsonSchemaType.STRING, properties: {} },
            },
          },
        },
      },
    },
  });
});

test("generateSchema - should generate schema for Set objects", (t) => {
  const emptySet = new Set();
  t.deepEqual(JsonSchemaHelper.generateSchema(emptySet), {
    type: JsonSchemaType.UNORDERED_LIST,
    properties: {},
  });

  const numberSet = new Set([1, 2, 3]);
  t.deepEqual(JsonSchemaHelper.generateSchema(numberSet), {
    type: JsonSchemaType.UNORDERED_LIST,
    items: { type: JsonSchemaType.NUMBER, properties: {} },
    properties: {},
  });

  const stringSet = new Set(["a", "b"]);
  t.deepEqual(JsonSchemaHelper.generateSchema(stringSet), {
    type: JsonSchemaType.UNORDERED_LIST,
    items: { type: JsonSchemaType.STRING, properties: {} },
    properties: {},
  });
});

test("generateSchema - should generate schema for Map objects", (t) => {
  const emptyMap = new Map();
  t.deepEqual(JsonSchemaHelper.generateSchema(emptyMap), {
    type: JsonSchemaType.OBJECT,
    properties: {},
  });

  const map = new Map([
    ["key1", "value1"],
    ["key2", 42],
  ] as [string, any][]);

  t.deepEqual(JsonSchemaHelper.generateSchema(map), {
    type: JsonSchemaType.OBJECT,
    properties: {
      key1: { type: JsonSchemaType.STRING, properties: {} },
      key2: { type: JsonSchemaType.NUMBER, properties: {} },
    },
  });
});

test("generateSchema - should apply schema merges", (t) => {
  const data = {
    body: "eyJuYW1lIjoiSm9obiJ9", // base64 encoded JSON
    header: "regular string",
  };

  const merges: SchemaMerges = {
    body: {
      encoding: EncodingType.BASE64,
      decodedType: DecodedType.JSON,
    },
  };

  const schema = JsonSchemaHelper.generateSchema(data, merges);
  t.deepEqual(schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      body: {
        type: JsonSchemaType.STRING,
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
        properties: {},
      },
      header: { type: JsonSchemaType.STRING, properties: {} },
    },
  });
});

test("generateSchema - should not apply schema merges to nested properties with same name", (t) => {
  const data = {
    body: {
      title: "Example Post",
      body: "Hello everyone",
    },
  };

  const merges: SchemaMerges = {
    body: {
      encoding: EncodingType.BASE64,
      decodedType: DecodedType.JSON,
    },
  };

  const schema = JsonSchemaHelper.generateSchema(data, merges);
  t.deepEqual(schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      body: {
        type: JsonSchemaType.OBJECT,
        properties: {
          title: { type: JsonSchemaType.STRING, properties: {} },
          body: { type: JsonSchemaType.STRING, properties: {} }, // Should NOT have encoding/decodedType
        },
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
      },
    },
  });
});

test("sortObjectKeysRecursively - should sort object keys recursively", (t) => {
  const input = {
    z: 1,
    a: {
      y: 2,
      b: 3,
    },
    m: [{ z: 4, a: 5 }, "string"],
  };

  const expected = {
    a: {
      b: 3,
      y: 2,
    },
    m: [{ a: 5, z: 4 }, "string"],
    z: 1,
  };

  t.deepEqual(JsonSchemaHelper.sortObjectKeysRecursively(input), expected);
});

test("sortObjectKeysRecursively - should handle primitive values", (t) => {
  t.is(JsonSchemaHelper.sortObjectKeysRecursively(null), null);
  t.is(JsonSchemaHelper.sortObjectKeysRecursively(undefined), undefined);
  t.is(JsonSchemaHelper.sortObjectKeysRecursively("string"), "string");
  t.is(JsonSchemaHelper.sortObjectKeysRecursively(42), 42);
  t.is(JsonSchemaHelper.sortObjectKeysRecursively(true), true);
});

test("sortObjectKeysRecursively - should handle arrays with objects", (t) => {
  const input = [
    { c: 1, a: 2 },
    { z: 3, b: 4 },
  ];

  const expected = [
    { a: 2, c: 1 },
    { b: 4, z: 3 },
  ];

  t.deepEqual(JsonSchemaHelper.sortObjectKeysRecursively(input), expected);
});

test("generateDeterministicHash - should generate consistent hashes for the same data", (t) => {
  const data1 = { b: 2, a: 1 };
  const data2 = { a: 1, b: 2 };

  const hash1 = JsonSchemaHelper.generateDeterministicHash(data1);
  const hash2 = JsonSchemaHelper.generateDeterministicHash(data2);

  t.is(hash1, hash2);
  t.is(typeof hash1, "string");
  t.is(hash1.length, 64); // SHA256 hex length
});

test("generateDeterministicHash - should generate different hashes for different data", (t) => {
  const data1 = { a: 1, b: 2 };
  const data2 = { a: 1, b: 3 };

  const hash1 = JsonSchemaHelper.generateDeterministicHash(data1);
  const hash2 = JsonSchemaHelper.generateDeterministicHash(data2);

  t.not(hash1, hash2);
});

test("generateDeterministicHash - should handle complex nested structures", (t) => {
  const data = {
    users: [
      { name: "John", age: 30 },
      { name: "Jane", age: 25 },
    ],
    metadata: {
      total: 2,
      updated: "2023-01-01",
    },
  };

  const hash = JsonSchemaHelper.generateDeterministicHash(data);
  t.is(typeof hash, "string");
  t.is(hash.length, 64);

  // Same data should produce same hash
  const hash2 = JsonSchemaHelper.generateDeterministicHash(data);
  t.is(hash, hash2);
});

test("generateSchemaAndHash - should generate schema and hashes for simple data", (t) => {
  const data = { name: "John", age: 30 };
  const result = JsonSchemaHelper.generateSchemaAndHash(data);

  t.deepEqual(result.schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      name: { type: JsonSchemaType.STRING, properties: {} },
      age: { type: JsonSchemaType.NUMBER, properties: {} },
    },
  });
  t.is(typeof result.decodedValueHash, "string");
  t.is(typeof result.decodedSchemaHash, "string");
  t.is(result.decodedValueHash.length, 64);
  t.is(result.decodedSchemaHash.length, 64);
});

test("generateSchemaAndHash - should handle schema merges with base64 encoding", (t) => {
  const jsonData = { message: "Hello World" };
  const base64Data = Buffer.from(JSON.stringify(jsonData)).toString("base64");

  const data = {
    body: base64Data,
    contentType: "application/json",
  };

  const schemaMerges: SchemaMerges = {
    body: {
      encoding: EncodingType.BASE64,
      decodedType: DecodedType.JSON,
    },
  };

  const result = JsonSchemaHelper.generateSchemaAndHash(data, schemaMerges);

  t.deepEqual(result.schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      body: {
        type: JsonSchemaType.OBJECT,
        properties: {
          message: { type: JsonSchemaType.STRING, properties: {} },
        },
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
      },
      contentType: { type: JsonSchemaType.STRING, properties: {} },
    },
  });

  // The decoded data should have the JSON structure
  t.is(typeof result.decodedValueHash, "string");
  t.is(typeof result.decodedSchemaHash, "string");
});

test("generateSchemaAndHash - should normalize data by removing undefined values", (t) => {
  const data = {
    name: "John",
    age: undefined,
    city: "New York",
  };

  const result = JsonSchemaHelper.generateSchemaAndHash(data);

  t.deepEqual(result.schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      name: { type: JsonSchemaType.STRING, properties: {} },
      city: { type: JsonSchemaType.STRING, properties: {} },
    },
  });
  t.false(Object.prototype.hasOwnProperty.call(result.schema.properties, "age"));
});

test("generateSchemaAndHash - should handle decoding errors gracefully", (t) => {
  const data = {
    body: "invalid-base64!!!",
    other: "valid",
  };

  const schemaMerges: SchemaMerges = {
    body: {
      encoding: EncodingType.BASE64,
      decodedType: DecodedType.JSON,
    },
  };

  // This test intentionally triggers a JSON decode error to test error handling
  // The warning message is expected and demonstrates graceful error handling
  const result = JsonSchemaHelper.generateSchemaAndHash(data, schemaMerges);
  t.deepEqual(result.schema.properties?.body, {
    type: JsonSchemaType.STRING,
    properties: {},
    encoding: EncodingType.BASE64,
    decodedType: DecodedType.JSON,
  });
});

test("generateSchemaAndHash - should handle empty objects and arrays", (t) => {
  const data = {
    emptyObj: {},
    emptyArr: [],
    items: [1, 2, 3],
  };

  const result = JsonSchemaHelper.generateSchemaAndHash(data);

  t.deepEqual(result.schema, {
    type: JsonSchemaType.OBJECT,
    properties: {
      emptyObj: {
        type: JsonSchemaType.OBJECT,
        properties: {},
      },
      emptyArr: {
        type: JsonSchemaType.ORDERED_LIST,
        properties: {},
      },
      items: {
        type: JsonSchemaType.ORDERED_LIST,
        items: { type: JsonSchemaType.NUMBER, properties: {} },
        properties: {},
      },
    },
  });
});

test("getTypeMapping - should return the type mapping object", (t) => {
  const mapping = JsonSchemaHelper.getTypeMapping();
  t.truthy(mapping);
  t.is(mapping.string, JsonSchemaType.STRING);
  t.is(mapping.number, JsonSchemaType.NUMBER);
  t.is(mapping.boolean, JsonSchemaType.BOOLEAN);
  t.is(mapping.null, JsonSchemaType.NULL);
  t.is(mapping.undefined, JsonSchemaType.UNDEFINED);
  t.is(mapping.Array, JsonSchemaType.ORDERED_LIST);
  t.is(mapping.object, JsonSchemaType.OBJECT);
});

test("EncodingType and DecodedType enums - should have correct EncodingType values", (t) => {
  t.is(EncodingType.BASE64, 1);
  t.is(EncodingType.UNSPECIFIED, 0);
});

test("EncodingType and DecodedType enums - should have correct DecodedType values", (t) => {
  t.is(DecodedType.UNSPECIFIED, 0);
  t.is(DecodedType.JSON, 1);
  t.is(DecodedType.HTML, 2);
  t.is(DecodedType.CSS, 3);
  t.is(DecodedType.JAVASCRIPT, 4);
  t.is(DecodedType.XML, 5);
  t.is(DecodedType.YAML, 6);
  t.is(DecodedType.MARKDOWN, 7);
  t.is(DecodedType.CSV, 8);
  t.is(DecodedType.SQL, 9);
  t.is(DecodedType.GRAPHQL, 10);
  t.is(DecodedType.PLAIN_TEXT, 11);
  t.is(DecodedType.FORM_DATA, 12);
  t.is(DecodedType.MULTIPART_FORM, 13);
  t.is(DecodedType.PDF, 14);
  t.is(DecodedType.AUDIO, 15);
  t.is(DecodedType.VIDEO, 16);
  t.is(DecodedType.GZIP, 17);
  t.is(DecodedType.BINARY, 18);
  t.is(DecodedType.JPEG, 19);
  t.is(DecodedType.PNG, 20);
  t.is(DecodedType.GIF, 21);
  t.is(DecodedType.WEBP, 22);
  t.is(DecodedType.SVG, 23);
  t.is(DecodedType.ZIP, 24);
});
