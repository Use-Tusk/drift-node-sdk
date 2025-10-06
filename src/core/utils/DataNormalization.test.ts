import test from 'ava';
import {
  normalizeInputData,
  createSpanInputValue,
  createMockInputValue,
} from "./dataNormalizationUtils";

test("normalizeInputData - should remove undefined values from objects", (t) => {
  const input = {
    a: "value",
    b: undefined,
    c: null,
    d: 0,
    e: false,
    f: "",
  };

  const result = normalizeInputData(input);

  t.deepEqual(result, {
    a: "value",
    c: null,
    d: 0,
    e: false,
    f: "",
  });
  t.false(Object.prototype.hasOwnProperty.call(result, "b"));
});

test("normalizeInputData - should handle nested objects with undefined values", (t) => {
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

  t.deepEqual(result, {
    user: {
      name: "John",
      address: {
        street: "123 Main St",
        country: null,
      },
    },
  });
  t.false(Object.prototype.hasOwnProperty.call(result.user, "age"));
  t.false(Object.prototype.hasOwnProperty.call(result.user.address, "zip"));
  t.false(Object.prototype.hasOwnProperty.call(result, "metadata"));
});

test("normalizeInputData - should handle arrays with undefined values", (t) => {
  const input = {
    items: ["a", undefined, "b", null, "c"],
    numbers: [1, undefined, 2, 0],
  };

  const result = normalizeInputData(input);

  t.deepEqual(result, {
    items: ["a", null, "b", null, "c"],
    numbers: [1, null, 2, 0],
  });
});

test("normalizeInputData - should handle circular references safely", (t) => {
  const input: any = {
    name: "test",
    value: 123,
  };
  input.self = input;

  const result = normalizeInputData(input);

  t.deepEqual(result, {
    name: "test",
    value: 123,
    self: "[Circular]",
  });
});

test("normalizeInputData - should handle empty objects", (t) => {
  const input = {};
  const result = normalizeInputData(input);
  t.deepEqual(result, {});
});

test("normalizeInputData - should handle primitive values wrapped in objects", (t) => {
  const input = {
    string: "test",
    number: 42,
    boolean: true,
    null: null,
    undefined: undefined,
  };

  const result = normalizeInputData(input);

  t.deepEqual(result, {
    string: "test",
    number: 42,
    boolean: true,
    null: null,
  });
});

test("normalizeInputData - should preserve Date objects", (t) => {
  const date = new Date("2023-01-01");
  const input = {
    timestamp: date,
    other: undefined,
  };

  const result = normalizeInputData(input);

  t.deepEqual(result, {
    timestamp: date.toISOString(),
  });
});

test("normalizeInputData - should handle complex nested structures", (t) => {
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

  t.deepEqual(result, {
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

test("createSpanInputValue - should return a JSON string of normalized data", (t) => {
  const input = {
    user: "john",
    age: undefined,
    active: true,
  };

  const result = createSpanInputValue(input);

  t.is(typeof result, "string");
  t.deepEqual(JSON.parse(result), {
    user: "john",
    active: true,
  });
});

test("createSpanInputValue - should handle circular references in span values", (t) => {
  const input: any = {
    name: "test",
  };
  input.circular = input;

  const result = createSpanInputValue(input);

  t.is(typeof result, "string");
  t.deepEqual(JSON.parse(result), {
    name: "test",
    circular: "[Circular]",
  });
});

test("createSpanInputValue - should produce consistent output for identical normalized data", (t) => {
  const input1 = { a: 1, b: undefined, c: "test" };
  const input2 = { a: 1, c: "test" };

  const result1 = createSpanInputValue(input1);
  const result2 = createSpanInputValue(input2);

  t.is(result1, result2);
});

test("createMockInputValue - should return normalized object data", (t) => {
  const input = {
    user: "john",
    age: undefined,
    active: true,
  };

  const result = createMockInputValue(input);

  t.deepEqual(result, {
    user: "john",
    active: true,
  });
  t.false(Object.prototype.hasOwnProperty.call(result, "age"));
});

test("createMockInputValue - should handle circular references in mock values", (t) => {
  const input: any = {
    name: "test",
  };
  input.circular = input;

  const result = createMockInputValue(input);

  t.deepEqual(result, {
    name: "test",
    circular: "[Circular]",
  });
});

test("createMockInputValue - should produce consistent output for identical normalized data", (t) => {
  const input1 = { a: 1, b: undefined, c: "test" };
  const input2 = { a: 1, c: "test" };

  const result1 = createMockInputValue(input1);
  const result2 = createMockInputValue(input2);

  t.deepEqual(result1, result2);
});

test("createMockInputValue - should preserve type information", (t) => {
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

  t.deepEqual(result, {
    id: 1,
    name: "test",
  });
});

test("consistency between functions - should ensure createSpanInputValue and createMockInputValue produce equivalent data structures", (t) => {
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

  t.deepEqual(JSON.parse(spanValue), mockValue);
});

test("consistency between functions - should handle edge cases consistently", (t) => {
  const edgeCases = [
    {},
    { only: undefined },
    { mixed: "value", empty: undefined },
    { nested: { deep: { value: "test", undefined: undefined } } },
  ];

  edgeCases.forEach((testCase) => {
    const spanValue = createSpanInputValue(testCase);
    const mockValue = createMockInputValue(testCase);

    t.deepEqual(JSON.parse(spanValue), mockValue);
  });
});
