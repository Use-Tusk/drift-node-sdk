import test from "ava";
import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
import { PgInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";

class MockPgClient {
  _queries: any[] = [];
  _connections: any[] = [];

  query(text: string, values?: any[], callback?: Function): any;
  query(config: { text: string; values?: any[]; callback?: Function }, callback?: Function): any;
  query(textOrConfig: any, valuesOrCallback?: any, callback?: Function): any {
    const isConfigObject = typeof textOrConfig === "object" && textOrConfig.text;

    if (isConfigObject) {
      const config = textOrConfig;
      const cb = callback || config.callback;
      this._queries.push({ text: config.text, values: config.values, callback: cb });

      if (cb) {
        process.nextTick(() =>
          cb(null, { command: "SELECT", rowCount: 1, oid: 0, rows: [{ id: 1 }], fields: [] }),
        );
        return;
      } else {
        return Promise.resolve({
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          rows: [{ id: 1 }],
          fields: [],
        });
      }
    } else {
      const text = textOrConfig;
      const values = Array.isArray(valuesOrCallback) ? valuesOrCallback : undefined;
      const cb = typeof valuesOrCallback === "function" ? valuesOrCallback : callback;

      this._queries.push({ text, values, callback: cb });

      if (cb) {
        process.nextTick(() =>
          cb(null, { command: "SELECT", rowCount: 1, oid: 0, rows: [{ id: 1 }], fields: [] }),
        );
        return;
      } else {
        return Promise.resolve({
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          rows: [{ id: 1 }],
          fields: [],
        });
      }
    }
  }

  connect(callback?: Function): any {
    this._connections.push({ callback });

    if (callback) {
      process.nextTick(() => callback(null));
      return;
    } else {
      return Promise.resolve();
    }
  }
}

class MockPgPool {
  _queries: any[] = [];
  _connections: any[] = [];

  query(text: string, values?: any[], callback?: Function): any;
  query(config: { text: string; values?: any[]; callback?: Function }, callback?: Function): any;
  query(textOrConfig: any, valuesOrCallback?: any, callback?: Function): any {
    const isConfigObject = typeof textOrConfig === "object" && textOrConfig.text;

    if (isConfigObject) {
      const config = textOrConfig;
      const cb = callback || config.callback;
      this._queries.push({ text: config.text, values: config.values, callback: cb });

      if (cb) {
        process.nextTick(() =>
          cb(null, { command: "SELECT", rowCount: 1, oid: 0, rows: [{ id: 1 }], fields: [] }),
        );
        return;
      } else {
        return Promise.resolve({
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          rows: [{ id: 1 }],
          fields: [],
        });
      }
    } else {
      const text = textOrConfig;
      const values = Array.isArray(valuesOrCallback) ? valuesOrCallback : undefined;
      const cb = typeof valuesOrCallback === "function" ? valuesOrCallback : callback;

      this._queries.push({ text, values, callback: cb });

      if (cb) {
        process.nextTick(() =>
          cb(null, { command: "SELECT", rowCount: 1, oid: 0, rows: [{ id: 1 }], fields: [] }),
        );
        return;
      } else {
        return Promise.resolve({
          command: "SELECT",
          rowCount: 1,
          oid: 0,
          rows: [{ id: 1 }],
          fields: [],
        });
      }
    }
  }

  connect(callback?: Function): any {
    this._connections.push({ callback });
    const mockClient = new MockPgClient();

    if (callback) {
      process.nextTick(() => callback(null, mockClient, () => {}));
      return;
    } else {
      return Promise.resolve(mockClient);
    }
  }
}

const mockPgModule = {
  Client: MockPgClient,
  Query: function () {},
  Pool: MockPgPool,
  Connection: function () {},
  types: {},
  DatabaseError: Error,
  TypeOverrides: function () {},
  escapeIdentifier: (str: string) => `"${str}"`,
  escapeLiteral: (str: string) => `'${str}'`,
  Result: function () {},
};

const mockPgPoolModule = function () {
  return new MockPgPool();
};
mockPgPoolModule.prototype = MockPgPool.prototype;

// Helper function to execute database operations
async function executePgOperation(
  operationType: "query" | "connect",
  clientType: "pg" | "pg-pool",
  useCallback: boolean = false,
): Promise<any> {
  if (clientType === "pg") {
    const client = new MockPgClient();

    if (operationType === "query") {
      if (useCallback) {
        return new Promise((resolve) => {
          client.query("SELECT * FROM test", undefined, (err: any, result: any) => {
            resolve({ err, result });
          });
        });
      } else {
        return await client.query("SELECT * FROM test");
      }
    } else {
      // connect
      if (useCallback) {
        return new Promise((resolve) => {
          client.connect((err: any) => {
            resolve({ err });
          });
        });
      } else {
        return await client.connect();
      }
    }
  } else {
    // pg-pool
    const pool = new MockPgPool();

    if (operationType === "query") {
      if (useCallback) {
        return new Promise((resolve) => {
          pool.query("SELECT * FROM test", undefined, (err: any, result: any) => {
            resolve({ err, result });
          });
        });
      } else {
        return await pool.query("SELECT * FROM test");
      }
    } else {
      // connect
      if (useCallback) {
        return new Promise((resolve) => {
          pool.connect((err: any, client: any, done: any) => {
            resolve({ err, client, done });
          });
        });
      } else {
        return await pool.connect();
      }
    }
  }
}

let pgInstrumentation: PgInstrumentation;

test.beforeEach(() => {
  pgInstrumentation = new PgInstrumentation({
    mode: TuskDriftMode.RECORD,
  });

  // Initialize instrumentation which patches the modules
  const modules = pgInstrumentation.init();

  // Apply patches to our mock modules
  modules.forEach((module) => {
    if (module.name === "pg" && module.patch) {
      module.patch(mockPgModule);
    } else if (module.name === "pg-pool" && module.patch) {
      module.patch(mockPgPoolModule);
    }
  });
});

test.afterEach(() => {
  SpanUtilsErrorTesting.teardownErrorResilienceTest();
});

// PG Client Query Error Resilience
test("should complete PG query when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query (callback) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("query", "pg", true);
  t.is(result.err, null);
  t.is(result.result.command, "SELECT");
});

test("should complete PG query when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query (callback) when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executePgOperation("query", "pg", true);
  t.is(result.err, null);
  t.is(result.result.command, "SELECT");
});

test("should complete PG query when SpanUtils.setStatus throws", async (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
    shouldReturnNull: true,
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG query when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = await executePgOperation("query", "pg", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

// PG Client Connect Error Resilience
test("should complete PG connect when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("connect", "pg", false);
  t.is(result, undefined); // connect resolves with undefined
});

test("should complete PG connect (callback) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("connect", "pg", true);
  t.is(result.err, null);
});

test("should complete PG connect when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executePgOperation("connect", "pg", false);
  t.is(result, undefined);
});

test("should complete PG connect when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executePgOperation("connect", "pg", false);
  t.is(result, undefined);
});

// PG Pool Query Error Resilience
test("should complete PG Pool query when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query (callback) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("query", "pg-pool", true);
  t.is(result.err, null);
  t.is(result.result.command, "SELECT");
});

test("should complete PG Pool query when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query when SpanUtils.setStatus throws", async (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
    shouldReturnNull: true,
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

test("should complete PG Pool query when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = await executePgOperation("query", "pg-pool", false);
  t.is(result.command, "SELECT");
  t.is(result.rowCount, 1);
});

// PG Pool Connect Error Resilience
test("should complete PG Pool connect when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("connect", "pg-pool", false);
  t.true(result instanceof MockPgClient);
});

test("should complete PG Pool connect (callback) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executePgOperation("connect", "pg-pool", true);
  t.is(result.err, null);
  t.true(result.client instanceof MockPgClient);
  t.is(typeof result.done, "function");
});

test("should complete PG Pool connect when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executePgOperation("connect", "pg-pool", false);
  t.true(result instanceof MockPgClient);
});

test("should complete PG Pool connect when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executePgOperation("connect", "pg-pool", false);
  t.true(result instanceof MockPgClient);
});
