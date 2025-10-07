process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "debug",
});
TuskDrift.markAppAsReady();

import test from "ava";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../../core/types";
import { PgClientInputValue, PgResult } from "../types";

// Use require to avoid ES6 import hoisting
const { Client } = require("pg");

// Check with docker-compose.test.yml!
// don't use 5432 because it'll probably conflict with some other db
// don't use 5000 because apparently it's used by airdrop
const TEST_POSTGRES_URL = "postgresql://test_user:test_password@127.0.0.1:5001/test_db";

async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

let spanAdapter: InMemorySpanAdapter;
let client: Client;

test.before(async (t) => {
  spanAdapter = new InMemorySpanAdapter();
  registerInMemoryAdapter(spanAdapter);

  client = new Client({
    connectionString: TEST_POSTGRES_URL,
    connectionTimeoutMillis: 20_000,
  });
  await client.connect();

  // Set up test table
  await client.query(`
    CREATE TABLE IF NOT EXISTS test_users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100),
      email VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Clean and insert test data
  await client.query("DELETE FROM test_users");
  await client.query(`
    INSERT INTO test_users (name, email) VALUES
    ('Alice Johnson', 'alice@example.com'),
    ('Bob Smith', 'bob@example.com')
  `);
});

test.after.always(async () => {
  if (client) {
    await client.query("DROP TABLE IF EXISTS test_users");
    await client.end();
  }
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(() => {
  spanAdapter.clear();
});

test("should capture spans for SELECT queries", async (t) => {
  // Execute real query
  const result = await client.query("SELECT * FROM test_users ORDER BY id");
  t.is(result.rows.length, 2);
  t.is(result.rows[0].name, "Alice Johnson");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pgSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "PgInstrumentation",
  );
  t.true(pgSpans.length > 0);

  const span = pgSpans[0];
  t.true((span.inputValue as PgClientInputValue).text.includes("SELECT * FROM test_users"));
  t.is((span.outputValue as PgResult).rowCount, 2);
});

test("should capture spans for parameterized queries", async (t) => {
  const result = await client.query("SELECT * FROM test_users WHERE name = $1", [
    "Alice Johnson",
  ]);
  t.is(result.rows.length, 1);
  t.is(result.rows[0].email, "alice@example.com");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pgSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "PgInstrumentation" &&
      (input.inputValue as PgClientInputValue)?.text?.includes("SELECT") &&
      (input.inputValue as PgClientInputValue)?.values?.includes("Alice Johnson"),
  );
  t.true(pgSpans.length > 0);

  const span = pgSpans[0];
  t.deepEqual((span.inputValue as PgClientInputValue).values, ["Alice Johnson"]);
  t.is((span.outputValue as PgResult).rowCount, 1);
});

test("should capture spans for INSERT operations", async (t) => {
  const result = await client.query(
    "INSERT INTO test_users (name, email) VALUES ($1, $2) RETURNING id",
    ["Charlie Brown", "charlie@example.com"],
  );
  t.is(result.rows.length, 1);
  t.truthy(result.rows[0].id);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pgSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "PgInstrumentation" &&
      (input.inputValue as PgClientInputValue)?.text?.includes("INSERT") &&
      (input.inputValue as PgClientInputValue)?.values?.includes("Charlie Brown"),
  );
  t.true(pgSpans.length > 0);

  const span = pgSpans[0];
  t.deepEqual((span.inputValue as PgClientInputValue).values, [
    "Charlie Brown",
    "charlie@example.com",
  ]);
  t.is((span.outputValue as PgResult).rowCount, 1);
});

test("should capture spans for UPDATE operations", async (t) => {
  const result = await client.query("UPDATE test_users SET email = $1 WHERE name = $2", [
    "alice.new@example.com",
    "Alice Johnson",
  ]);
  t.is(result.rowCount, 1);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pgSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "PgInstrumentation" &&
      (input.inputValue as PgClientInputValue)?.text?.includes("UPDATE") &&
      (input.inputValue as PgClientInputValue)?.values?.includes("alice.new@example.com"),
  );
  t.true(pgSpans.length > 0);

  const span = pgSpans[0];
  t.is((span.outputValue as PgResult).rowCount, 1);
});

test("should capture spans for callback-style queries", async (t) => {
  await new Promise<void>((resolve, reject) => {
    client.query("SELECT COUNT(*) as count FROM test_users", async (err, result) => {
      try {
        t.is(err, null);
        t.true(parseInt(result.rows[0].count) >= 2);

        await waitForSpans();

        const spans = spanAdapter.getAllSpans();
        const pgSpans = spans.filter(
          (input: CleanSpanData) =>
            input.instrumentationName === "PgInstrumentation" &&
            (input.inputValue as PgClientInputValue)?.text?.includes("COUNT"),
        );
        t.true(pgSpans.length > 0);

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
});

test("should handle all query() overload variations", async (t) => {
  // Test different overloads with real database
  const overloadTests = [
    {
      name: "query(text)",
      test: () => client.query("SELECT 1 as test"),
    },
    {
      name: "query(text, values)",
      test: () => client.query("SELECT $1 as test", [42]),
    },
    {
      name: "query(config)",
      test: () => client.query({ text: "SELECT 2 as test" }),
    },
    {
      name: "query(config with values)",
      test: () =>
        client.query({
          text: "SELECT $1 as test",
          values: [99],
        }),
    },
  ];

  for (const { name, test: testFn } of overloadTests) {
    console.log(`Testing ${name}`);

    const result = await testFn();
    t.truthy(result.rows);
    t.true(result.rows.length > 0);

    await waitForSpans(100);

    const spans = spanAdapter.getSpansByInstrumentation("Pg");
    t.true(spans.length > 0);

    // Clear spans for next test
    spanAdapter.clear();
  }
});

test("should capture spans even for failed queries", async (t) => {
  const error = await t.throwsAsync(
    async () => {
      await client.query("SELECT * FROM nonexistent_table");
    },
    undefined,
  );

  t.truthy(error);
  const message = error instanceof Error ? error.message : String(error);
  t.true(message.includes("does not exist"));

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pgSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "PgInstrumentation" &&
      (input.inputValue as PgClientInputValue)?.text?.includes("nonexistent_table"),
  );
  t.true(pgSpans.length > 0);
});

test("should handle concurrent queries", async (t) => {
  const queries = Array.from({ length: 5 }, (_, i) =>
    client.query(`SELECT ${i} as query_number, name FROM test_users LIMIT 1`),
  );

  const results = await Promise.all(queries);
  t.is(results.length, 5);

  await waitForSpans();

  const spans = spanAdapter.getSpansByInstrumentation("Pg");
  t.true(spans.length >= 5);

  // Each query should have its own span
  for (let i = 0; i < 5; i++) {
    const querySpans = spans.filter((input: CleanSpanData) =>
      (input.inputValue as PgClientInputValue)?.text?.includes(`SELECT ${i}`),
    );
    t.true(querySpans.length > 0);
  }
});
