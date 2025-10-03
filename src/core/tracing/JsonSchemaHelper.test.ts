import {
  JsonSchemaHelper,
  EncodingType,
  DecodedType,
  JsonSchema,
  SchemaMerges,
  JsonSchemaType,
} from "./JsonSchemaHelper";

describe("JsonSchemaHelper", () => {
  describe("getDetailedType", () => {
    it("should correctly identify primitive types", () => {
      expect(JsonSchemaHelper.getDetailedType(null)).toBe("NULL");
      expect(JsonSchemaHelper.getDetailedType(undefined)).toBe("UNDEFINED");
      expect(JsonSchemaHelper.getDetailedType("hello")).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(42)).toBe("NUMBER");
      expect(JsonSchemaHelper.getDetailedType(3.14)).toBe("NUMBER");
      expect(JsonSchemaHelper.getDetailedType(true)).toBe("BOOLEAN");
      expect(JsonSchemaHelper.getDetailedType(false)).toBe("BOOLEAN");
      expect(JsonSchemaHelper.getDetailedType(BigInt(123))).toBe("NUMBER");
      expect(JsonSchemaHelper.getDetailedType(Symbol("test"))).toBe("STRING");
    });

    it("should correctly identify object types", () => {
      expect(JsonSchemaHelper.getDetailedType({})).toBe("OBJECT");
      expect(JsonSchemaHelper.getDetailedType([])).toBe("ORDERED_LIST");
      expect(JsonSchemaHelper.getDetailedType(new Date())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(/regex/)).toBe("OBJECT");
      expect(JsonSchemaHelper.getDetailedType(new Error("test"))).toBe("OBJECT");
      expect(JsonSchemaHelper.getDetailedType(new Set())).toBe("UNORDERED_LIST");
      expect(JsonSchemaHelper.getDetailedType(new Map())).toBe("OBJECT");
      expect(JsonSchemaHelper.getDetailedType(() => {})).toBe("FUNCTION");
    });

    it("should correctly identify typed arrays", () => {
      expect(JsonSchemaHelper.getDetailedType(new Int8Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Uint8Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Uint8ClampedArray())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Int16Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Uint16Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Int32Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Uint32Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Float32Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new Float64Array())).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new DataView(new ArrayBuffer(8)))).toBe("STRING");
      expect(JsonSchemaHelper.getDetailedType(new ArrayBuffer(8))).toBe("STRING");
    });

    it("should handle arguments object", () => {
      function testFunc() {
        return JsonSchemaHelper.getDetailedType(arguments);
      }
      expect(testFunc()).toBe("ORDERED_LIST");
    });

    it("should fall back to STRING for unknown types", () => {
      const unknownObj = Object.create(null);
      Object.setPrototypeOf(unknownObj, null);
      expect(JsonSchemaHelper.getDetailedType(unknownObj)).toBe("OBJECT");
    });
  });

  describe("generateSchema", () => {
    it("should generate schema for primitive types", () => {
      expect(JsonSchemaHelper.generateSchema(null)).toEqual({ type: "NULL" });
      expect(JsonSchemaHelper.generateSchema(undefined)).toEqual({ type: "UNDEFINED" });
      expect(JsonSchemaHelper.generateSchema("test")).toEqual({ type: "STRING" });
      expect(JsonSchemaHelper.generateSchema(42)).toEqual({ type: "NUMBER" });
      expect(JsonSchemaHelper.generateSchema(true)).toEqual({ type: "BOOLEAN" });
    });

    it("should generate schema for arrays", () => {
      expect(JsonSchemaHelper.generateSchema([])).toEqual({
        type: "ORDERED_LIST",
        items: null,
      });

      expect(JsonSchemaHelper.generateSchema([1, 2, 3])).toEqual({
        type: "ORDERED_LIST",
        items: { type: "NUMBER" },
      });

      expect(JsonSchemaHelper.generateSchema(["a", "b"])).toEqual({
        type: "ORDERED_LIST",
        items: { type: "STRING" },
      });

      expect(JsonSchemaHelper.generateSchema([{ id: 1 }])).toEqual({
        type: "ORDERED_LIST",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "NUMBER" },
          },
        },
      });
    });

    it("should generate schema for objects", () => {
      const simpleObj = { name: "John", age: 30 };
      expect(JsonSchemaHelper.generateSchema(simpleObj)).toEqual({
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
      expect(JsonSchemaHelper.generateSchema(nestedObj)).toEqual({
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

    it("should generate schema for Set objects", () => {
      const emptySet = new Set();
      expect(JsonSchemaHelper.generateSchema(emptySet)).toEqual({
        type: "UNORDERED_LIST",
        items: null,
      });

      const numberSet = new Set([1, 2, 3]);
      expect(JsonSchemaHelper.generateSchema(numberSet)).toEqual({
        type: "UNORDERED_LIST",
        items: { type: "NUMBER" },
      });

      const stringSet = new Set(["a", "b"]);
      expect(JsonSchemaHelper.generateSchema(stringSet)).toEqual({
        type: "UNORDERED_LIST",
        items: { type: "STRING" },
      });
    });

    it("should generate schema for Map objects", () => {
      const emptyMap = new Map();
      expect(JsonSchemaHelper.generateSchema(emptyMap)).toEqual({
        type: "OBJECT",
        properties: {},
      });

      const map = new Map([
        ["key1", "value1"],
        ["key2", 42],
      ] as [string, any][]);

      expect(JsonSchemaHelper.generateSchema(map)).toEqual({
        type: "OBJECT",
        properties: {
          key1: { type: "STRING" },
          key2: { type: "NUMBER" },
        },
      });
    });

    it("should apply schema merges", () => {
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
      expect(schema).toEqual({
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

    it("should not apply schema merges to nested properties with same name", () => {
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
      expect(schema).toEqual({
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
  });

  describe("sortObjectKeysRecursively", () => {
    it("should sort object keys recursively", () => {
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

      expect(JsonSchemaHelper.sortObjectKeysRecursively(input)).toEqual(expected);
    });

    it("should handle primitive values", () => {
      expect(JsonSchemaHelper.sortObjectKeysRecursively(null)).toBe(null);
      expect(JsonSchemaHelper.sortObjectKeysRecursively(undefined)).toBe(undefined);
      expect(JsonSchemaHelper.sortObjectKeysRecursively("string")).toBe("string");
      expect(JsonSchemaHelper.sortObjectKeysRecursively(42)).toBe(42);
      expect(JsonSchemaHelper.sortObjectKeysRecursively(true)).toBe(true);
    });

    it("should handle arrays with objects", () => {
      const input = [
        { c: 1, a: 2 },
        { z: 3, b: 4 },
      ];

      const expected = [
        { a: 2, c: 1 },
        { b: 4, z: 3 },
      ];

      expect(JsonSchemaHelper.sortObjectKeysRecursively(input)).toEqual(expected);
    });
  });

  describe("generateDeterministicHash", () => {
    it("should generate consistent hashes for the same data", () => {
      const data1 = { b: 2, a: 1 };
      const data2 = { a: 1, b: 2 };

      const hash1 = JsonSchemaHelper.generateDeterministicHash(data1);
      const hash2 = JsonSchemaHelper.generateDeterministicHash(data2);

      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe("string");
      expect(hash1.length).toBe(64); // SHA256 hex length
    });

    it("should generate different hashes for different data", () => {
      const data1 = { a: 1, b: 2 };
      const data2 = { a: 1, b: 3 };

      const hash1 = JsonSchemaHelper.generateDeterministicHash(data1);
      const hash2 = JsonSchemaHelper.generateDeterministicHash(data2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle complex nested structures", () => {
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
      expect(typeof hash).toBe("string");
      expect(hash.length).toBe(64);

      // Same data should produce same hash
      const hash2 = JsonSchemaHelper.generateDeterministicHash(data);
      expect(hash).toBe(hash2);
    });
  });

  describe("generateSchemaAndHash", () => {
    it("should generate schema and hashes for simple data", () => {
      const data = { name: "John", age: 30 };
      const result = JsonSchemaHelper.generateSchemaAndHash(data);

      expect(result.schema).toEqual({
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          age: { type: "NUMBER" },
        },
      });
      expect(typeof result.decodedValueHash).toBe("string");
      expect(typeof result.decodedSchemaHash).toBe("string");
      expect(result.decodedValueHash.length).toBe(64);
      expect(result.decodedSchemaHash.length).toBe(64);
    });

    it("should handle schema merges with base64 encoding", () => {
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

      expect(result.schema).toEqual({
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
      expect(typeof result.decodedValueHash).toBe("string");
      expect(typeof result.decodedSchemaHash).toBe("string");
    });

    it("should normalize data by removing undefined values", () => {
      const data = {
        name: "John",
        age: undefined,
        city: "New York",
      };

      const result = JsonSchemaHelper.generateSchemaAndHash(data);

      expect(result.schema).toEqual({
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          city: { type: "STRING" },
        },
      });
      expect(result.schema.properties).not.toHaveProperty("age");
    });

    it("should handle decoding errors gracefully", () => {
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

      // Should not throw and should keep original value
      const result = JsonSchemaHelper.generateSchemaAndHash(data, schemaMerges);
      expect(result.schema.properties?.body).toEqual({
        type: "STRING",
        encoding: EncodingType.BASE64,
        decodedType: DecodedType.JSON,
      });
    });

    it("should handle empty objects and arrays", () => {
      const data = {
        emptyObj: {},
        emptyArr: [],
        items: [1, 2, 3],
      };

      const result = JsonSchemaHelper.generateSchemaAndHash(data);

      expect(result.schema).toEqual({
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
  });

  describe("getTypeMapping", () => {
    it("should return the type mapping object", () => {
      const mapping = JsonSchemaHelper.getTypeMapping();
      expect(mapping).toBeDefined();
      expect(mapping.string).toBe("STRING");
      expect(mapping.number).toBe("NUMBER");
      expect(mapping.boolean).toBe("BOOLEAN");
      expect(mapping.null).toBe("NULL");
      expect(mapping.undefined).toBe("UNDEFINED");
      expect(mapping.Array).toBe("ORDERED_LIST");
      expect(mapping.object).toBe("OBJECT");
    });
  });

  describe("EncodingType and DecodedType enums", () => {
    it("should have correct EncodingType values", () => {
      expect(EncodingType.BASE64).toBe("BASE64");
    });

    it("should have correct DecodedType values", () => {
      expect(DecodedType.JSON).toBe("JSON");
      expect(DecodedType.HTML).toBe("HTML");
      expect(DecodedType.CSS).toBe("CSS");
      expect(DecodedType.JAVASCRIPT).toBe("JAVASCRIPT");
      expect(DecodedType.XML).toBe("XML");
      expect(DecodedType.YAML).toBe("YAML");
      expect(DecodedType.MARKDOWN).toBe("MARKDOWN");
      expect(DecodedType.CSV).toBe("CSV");
      expect(DecodedType.SQL).toBe("SQL");
      expect(DecodedType.GRAPHQL).toBe("GRAPHQL");
      expect(DecodedType.PLAIN_TEXT).toBe("PLAIN_TEXT");
      expect(DecodedType.FORM_DATA).toBe("FORM_DATA");
      expect(DecodedType.MULTIPART_FORM).toBe("MULTIPART_FORM");
      expect(DecodedType.PDF).toBe("PDF");
      expect(DecodedType.AUDIO).toBe("AUDIO");
      expect(DecodedType.VIDEO).toBe("VIDEO");
      expect(DecodedType.GZIP).toBe("GZIP");
      expect(DecodedType.BINARY).toBe("BINARY");
      expect(DecodedType.JPEG).toBe("JPEG");
      expect(DecodedType.PNG).toBe("PNG");
      expect(DecodedType.GIF).toBe("GIF");
      expect(DecodedType.WEBP).toBe("WEBP");
      expect(DecodedType.SVG).toBe("SVG");
      expect(DecodedType.ZIP).toBe("ZIP");
    });
  });
});
