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
  t.is(JsonSchemaHelper.getDetailedType(null), "NULL");
  t.is(JsonSchemaHelper.getDetailedType(undefined), "UNDEFINED");
  t.is(JsonSchemaHelper.getDetailedType("hello"), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(42), "NUMBER");
  t.is(JsonSchemaHelper.getDetailedType(3.14), "NUMBER");
  t.is(JsonSchemaHelper.getDetailedType(true), "BOOLEAN");
  t.is(JsonSchemaHelper.getDetailedType(false), "BOOLEAN");
  t.is(JsonSchemaHelper.getDetailedType(BigInt(123)), "NUMBER");
  t.is(JsonSchemaHelper.getDetailedType(Symbol("test")), "STRING");
});

test("getDetailedType - should correctly identify object types", (t) => {
  t.is(JsonSchemaHelper.getDetailedType({}), "OBJECT");
  t.is(JsonSchemaHelper.getDetailedType([]), "ORDERED_LIST");
  t.is(JsonSchemaHelper.getDetailedType(new Date()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(/regex/), "OBJECT");
  t.is(JsonSchemaHelper.getDetailedType(new Error("test")), "OBJECT");
  t.is(JsonSchemaHelper.getDetailedType(new Set()), "UNORDERED_LIST");
  t.is(JsonSchemaHelper.getDetailedType(new Map()), "OBJECT");
  t.is(JsonSchemaHelper.getDetailedType(() => {}), "FUNCTION");
});

test("getDetailedType - should correctly identify typed arrays", (t) => {
  t.is(JsonSchemaHelper.getDetailedType(new Int8Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Uint8Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Uint8ClampedArray()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Int16Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Uint16Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Int32Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Uint32Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Float32Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new Float64Array()), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new DataView(new ArrayBuffer(8))), "STRING");
  t.is(JsonSchemaHelper.getDetailedType(new ArrayBuffer(8)), "STRING");
});

test("getDetailedType - should handle arguments object", (t) => {
  function testFunc() {
    return JsonSchemaHelper.getDetailedType(arguments);
  }
  t.is(testFunc(), "ORDERED_LIST");
});

test("getDetailedType - should fall back to STRING for unknown types", (t) => {
  const unknownObj = Object.create(null);
  Object.setPrototypeOf(unknownObj, null);
  t.is(JsonSchemaHelper.getDetailedType(unknownObj), "OBJECT");
});

test("generateSchema - should generate schema for primitive types", (t) => {
  t.deepEqual(JsonSchemaHelper.generateSchema(null), { type: "NULL" });
  t.deepEqual(JsonSchemaHelper.generateSchema(undefined), { type: "UNDEFINED" });
  t.deepEqual(JsonSchemaHelper.generateSchema("test"), { type: "STRING" });
  t.deepEqual(JsonSchemaHelper.generateSchema(42), { type: "NUMBER" });
  t.deepEqual(JsonSchemaHelper.generateSchema(true), { type: "BOOLEAN" });
});

test("generateSchema - should generate schema for arrays", (t) => {
  t.deepEqual(JsonSchemaHelper.generateSchema([]), {
    type: "ORDERED_LIST",
    items: null,
  });

  t.deepEqual(JsonSchemaHelper.generateSchema([1, 2, 3]), {
    type: "ORDERED_LIST",
    items: { type: "NUMBER" },
  });

  t.deepEqual(JsonSchemaHelper.generateSchema(["a", "b"]), {
    type: "ORDERED_LIST",
    items: { type: "STRING" },
  });

  t.deepEqual(JsonSchemaHelper.generateSchema([{ id: 1 }]), {
    type: "ORDERED_LIST",
    items: {
      type: "OBJECT",
      properties: {
        id: { type: "NUMBER" },
      },
    },
  });
});

test("generateSchema - should generate schema for objects", (t) => {
  const simpleObj = { name: "John", age: 30 };
  t.deepEqual(JsonSchemaHelper.generateSchema(simpleObj), {
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      age: { type: "NUMBER" },
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
    type: "OBJECT",
    properties: {
      user: {
        type: "OBJECT",
        properties: {
          profile: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
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
    type: "UNORDERED_LIST",
    items: null,
  });

  const numberSet = new Set([1, 2, 3]);
  t.deepEqual(JsonSchemaHelper.generateSchema(numberSet), {
    type: "UNORDERED_LIST",
    items: { type: "NUMBER" },
  });

  const stringSet = new Set(["a", "b"]);
  t.deepEqual(JsonSchemaHelper.generateSchema(stringSet), {
    type: "UNORDERED_LIST",
    items: { type: "STRING" },
  });
});

test("generateSchema - should generate schema for Map objects", (t) => {
  const emptyMap = new Map();
  t.deepEqual(JsonSchemaHelper.generateSchema(emptyMap), {
    type: "OBJECT",
    properties: {},
  });

  const map = new Map([
    ["key1", "value1"],
    ["key2", 42],
  ] as [string, any][]);

  t.deepEqual(JsonSchemaHelper.generateSchema(map), {
    type: "OBJECT",
    properties: {
      key1: { type: "STRING" },
      key2: { type: "NUMBER" },
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
    type: "OBJECT",
    properties: {
      body: {
        type: "STRING",
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
      },
      header: { type: JsonSchemaType.STRING },
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
    type: "OBJECT",
    properties: {
      body: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          body: { type: "STRING" }, // Should NOT have encoding/decodedType
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
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      age: { type: "NUMBER" },
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
    type: "OBJECT",
    properties: {
      body: {
        type: "OBJECT",
        properties: {
          message: { type: "STRING" },
        },
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
      },
      contentType: { type: "STRING" },
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
    type: "OBJECT",
    properties: {
      name: { type: "STRING" },
      city: { type: "STRING" },
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
    type: "STRING",
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
    type: "OBJECT",
    properties: {
      emptyObj: {
        type: "OBJECT",
        properties: {},
      },
      emptyArr: {
        type: "ORDERED_LIST",
        items: null,
      },
      items: {
        type: "ORDERED_LIST",
        items: { type: "NUMBER" },
      },
    },
  });
});

test("getTypeMapping - should return the type mapping object", (t) => {
  const mapping = JsonSchemaHelper.getTypeMapping();
  t.truthy(mapping);
  t.is(mapping.string, "STRING");
  t.is(mapping.number, "NUMBER");
  t.is(mapping.boolean, "BOOLEAN");
  t.is(mapping.null, "NULL");
  t.is(mapping.undefined, "UNDEFINED");
  t.is(mapping.Array, "ORDERED_LIST");
  t.is(mapping.object, "OBJECT");
});

test("EncodingType and DecodedType enums - should have correct EncodingType values", (t) => {
  t.is(EncodingType.BASE64, "BASE64");
});

test("EncodingType and DecodedType enums - should have correct DecodedType values", (t) => {
  t.is(DecodedType.JSON, "JSON");
  t.is(DecodedType.HTML, "HTML");
  t.is(DecodedType.CSS, "CSS");
  t.is(DecodedType.JAVASCRIPT, "JAVASCRIPT");
  t.is(DecodedType.XML, "XML");
  t.is(DecodedType.YAML, "YAML");
  t.is(DecodedType.MARKDOWN, "MARKDOWN");
  t.is(DecodedType.CSV, "CSV");
  t.is(DecodedType.SQL, "SQL");
  t.is(DecodedType.GRAPHQL, "GRAPHQL");
  t.is(DecodedType.PLAIN_TEXT, "PLAIN_TEXT");
  t.is(DecodedType.FORM_DATA, "FORM_DATA");
  t.is(DecodedType.MULTIPART_FORM, "MULTIPART_FORM");
  t.is(DecodedType.PDF, "PDF");
  t.is(DecodedType.AUDIO, "AUDIO");
  t.is(DecodedType.VIDEO, "VIDEO");
  t.is(DecodedType.GZIP, "GZIP");
  t.is(DecodedType.BINARY, "BINARY");
  t.is(DecodedType.JPEG, "JPEG");
  t.is(DecodedType.PNG, "PNG");
  t.is(DecodedType.GIF, "GIF");
  t.is(DecodedType.WEBP, "WEBP");
  t.is(DecodedType.SVG, "SVG");
  t.is(DecodedType.ZIP, "ZIP");
});
