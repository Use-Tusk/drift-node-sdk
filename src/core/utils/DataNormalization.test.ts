import {
  normalizeInputData,
  createSpanInputValue,
  createMockInputValue,
} from "./dataNormalizationUtils";

describe("DataNormalization", () => {
  describe("normalizeInputData", () => {
    it("should remove undefined values from objects", () => {
      const input = {
        a: "value",
        b: undefined,
        c: null,
        d: 0,
        e: false,
        f: "",
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        a: "value",
        c: null,
        d: 0,
        e: false,
        f: "",
      });
      expect(result).not.toHaveProperty("b");
    });

    it("should handle nested objects with undefined values", () => {
      const input = {
        user: {
          name: "John",
          age: undefined,
          address: {
            street: "123 Main St",
            zip: undefined,
            country: null,
          },
        },
        metadata: undefined,
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        user: {
          name: "John",
          address: {
            street: "123 Main St",
            country: null,
          },
        },
      });
      expect(result.user).not.toHaveProperty("age");
      expect(result.user.address).not.toHaveProperty("zip");
      expect(result).not.toHaveProperty("metadata");
    });

    it("should handle arrays with undefined values", () => {
      const input = {
        items: ["a", undefined, "b", null, "c"],
        numbers: [1, undefined, 2, 0],
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        items: ["a", null, "b", null, "c"],
        numbers: [1, null, 2, 0],
      });
    });

    it("should handle circular references safely", () => {
      const input: any = {
        name: "test",
        value: 123,
      };
      input.self = input;

      const result = normalizeInputData(input);

      expect(result).toEqual({
        name: "test",
        value: 123,
        self: "[Circular]",
      });
    });

    it("should handle empty objects", () => {
      const input = {};
      const result = normalizeInputData(input);
      expect(result).toEqual({});
    });

    it("should handle primitive values wrapped in objects", () => {
      const input = {
        string: "test",
        number: 42,
        boolean: true,
        null: null,
        undefined: undefined,
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        string: "test",
        number: 42,
        boolean: true,
        null: null,
      });
    });

    it("should preserve Date objects", () => {
      const date = new Date("2023-01-01");
      const input = {
        timestamp: date,
        other: undefined,
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        timestamp: date.toISOString(),
      });
    });

    it("should handle complex nested structures", () => {
      const input = {
        level1: {
          level2: {
            level3: {
              value: "deep",
              undefined: undefined,
            },
            array: [{ keep: "this", remove: undefined }, undefined, "string"],
          },
        },
      };

      const result = normalizeInputData(input);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: {
              value: "deep",
            },
            array: [{ keep: "this" }, null, "string"],
          },
        },
      });
    });
  });

  describe("createSpanInputValue", () => {
    it("should return a JSON string of normalized data", () => {
      const input = {
        user: "john",
        age: undefined,
        active: true,
      };

      const result = createSpanInputValue(input);

      expect(typeof result).toBe("string");
      expect(JSON.parse(result)).toEqual({
        user: "john",
        active: true,
      });
    });

    it("should handle circular references in span values", () => {
      const input: any = {
        name: "test",
      };
      input.circular = input;

      const result = createSpanInputValue(input);

      expect(typeof result).toBe("string");
      expect(JSON.parse(result)).toEqual({
        name: "test",
        circular: "[Circular]",
      });
    });

    it("should produce consistent output for identical normalized data", () => {
      const input1 = { a: 1, b: undefined, c: "test" };
      const input2 = { a: 1, c: "test" };

      const result1 = createSpanInputValue(input1);
      const result2 = createSpanInputValue(input2);

      expect(result1).toBe(result2);
    });
  });

  describe("createMockInputValue", () => {
    it("should return normalized object data", () => {
      const input = {
        user: "john",
        age: undefined,
        active: true,
      };

      const result = createMockInputValue(input);

      expect(result).toEqual({
        user: "john",
        active: true,
      });
      expect(result).not.toHaveProperty("age");
    });

    it("should handle circular references in mock values", () => {
      const input: any = {
        name: "test",
      };
      input.circular = input;

      const result = createMockInputValue(input);

      expect(result).toEqual({
        name: "test",
        circular: "[Circular]",
      });
    });

    it("should produce consistent output for identical normalized data", () => {
      const input1 = { a: 1, b: undefined, c: "test" };
      const input2 = { a: 1, c: "test" };

      const result1 = createMockInputValue(input1);
      const result2 = createMockInputValue(input2);

      expect(result1).toEqual(result2);
    });

    it("should preserve type information", () => {
      interface TestInput {
        id: number;
        name: string;
        optional?: string;
      }

      const input: TestInput = {
        id: 1,
        name: "test",
        optional: undefined,
      };

      const result = createMockInputValue(input);

      expect(result).toEqual({
        id: 1,
        name: "test",
      });
    });
  });

  describe("consistency between functions", () => {
    it("should ensure createSpanInputValue and createMockInputValue produce equivalent data structures", () => {
      const input = {
        database: "users",
        query: "SELECT * FROM users",
        params: undefined,
        options: {
          timeout: 5000,
          debug: undefined,
          cache: true,
        },
      };

      const spanValue = createSpanInputValue(input);
      const mockValue = createMockInputValue(input);

      expect(JSON.parse(spanValue)).toEqual(mockValue);
    });

    it("should handle edge cases consistently", () => {
      const edgeCases = [
        {},
        { only: undefined },
        { mixed: "value", empty: undefined },
        { nested: { deep: { value: "test", undefined: undefined } } },
      ];

      edgeCases.forEach((testCase) => {
        const spanValue = createSpanInputValue(testCase);
        const mockValue = createMockInputValue(testCase);

        expect(JSON.parse(spanValue)).toEqual(mockValue);
      });
    });
  });
});
