process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../core/TuskDrift";
TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "debug",
});

import { Client } from "pg";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../core/types";
import { PgClientInputValue, PgResult } from "./types";

// Check with docker-compose.test.yml!
// don't use 5432 because it'll probably conflict with some other db
// don't use 5000 because apparently it's used by airdrop
const TEST_POSTGRES_URL = "postgresql://test_user:test_password@127.0.0.1:5001/test_db";

async function waitForSpans(timeoutMs: number = 500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

describe("PostgreSQL Integration Tests (Docker)", () => {
  let spanAdapter: InMemorySpanAdapter;
  let client: Client;
  TuskDrift.markAppAsReady();

  beforeAll(async () => {
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
  }, 20_000);

  afterAll(async () => {
    if (client) {
      await client.query("DROP TABLE IF EXISTS test_users");
      await client.end();
    }
    clearRegisteredInMemoryAdapters();
  });

  beforeEach(() => {
    spanAdapter.clear();
  });

  describe("Basic PostgreSQL Operations", () => {
    it("should capture spans for SELECT queries", async () => {
      // Execute real query
      const result = await client.query("SELECT * FROM test_users ORDER BY id");
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe("Alice Johnson");

      await waitForSpans();

      const spans = spanAdapter.getAllSpans();
      const pgSpans = spans.filter(
        (input: CleanSpanData) => input.instrumentationName === "PgInstrumentation",
      );
      expect(pgSpans.length).toBeGreaterThan(0);

      const span = pgSpans[0];
      expect((span.inputValue as PgClientInputValue).text).toContain("SELECT * FROM test_users");
      expect((span.outputValue as PgResult).rowCount).toBe(2);
    });

    it("should capture spans for parameterized queries", async () => {
      const result = await client.query("SELECT * FROM test_users WHERE name = $1", [
        "Alice Johnson",
      ]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].email).toBe("alice@example.com");

      await waitForSpans();

      const spans = spanAdapter.getAllSpans();
      const pgSpans = spans.filter(
        (input: CleanSpanData) =>
          input.instrumentationName === "PgInstrumentation" &&
          (input.inputValue as PgClientInputValue)?.text?.includes("SELECT") &&
          (input.inputValue as PgClientInputValue)?.values?.includes("Alice Johnson"),
      );
      expect(pgSpans.length).toBeGreaterThan(0);

      const span = pgSpans[0];
      expect((span.inputValue as PgClientInputValue).values).toEqual(["Alice Johnson"]);
      expect((span.outputValue as PgResult).rowCount).toBe(1);
    });

    it("should capture spans for INSERT operations", async () => {
      const result = await client.query(
        "INSERT INTO test_users (name, email) VALUES ($1, $2) RETURNING id",
        ["Charlie Brown", "charlie@example.com"],
      );
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].id).toBeDefined();

      await waitForSpans();

      const spans = spanAdapter.getAllSpans();
      const pgSpans = spans.filter(
        (input: CleanSpanData) =>
          input.instrumentationName === "PgInstrumentation" &&
          (input.inputValue as PgClientInputValue)?.text?.includes("INSERT") &&
          (input.inputValue as PgClientInputValue)?.values?.includes("Charlie Brown"),
      );
      expect(pgSpans.length).toBeGreaterThan(0);

      const span = pgSpans[0];
      expect((span.inputValue as PgClientInputValue).values).toEqual([
        "Charlie Brown",
        "charlie@example.com",
      ]);
      expect((span.outputValue as PgResult).rowCount).toBe(1);
    });

    it("should capture spans for UPDATE operations", async () => {
      const result = await client.query("UPDATE test_users SET email = $1 WHERE name = $2", [
        "alice.new@example.com",
        "Alice Johnson",
      ]);
      expect(result.rowCount).toBe(1);

      await waitForSpans();

      const spans = spanAdapter.getAllSpans();
      const pgSpans = spans.filter(
        (input: CleanSpanData) =>
          input.instrumentationName === "PgInstrumentation" &&
          (input.inputValue as PgClientInputValue)?.text?.includes("UPDATE") &&
          (input.inputValue as PgClientInputValue)?.values?.includes("alice.new@example.com"),
      );
      expect(pgSpans.length).toBeGreaterThan(0);

      const span = pgSpans[0];
      expect((span.outputValue as PgResult).rowCount).toBe(1);
    });

    it("should capture spans for callback-style queries", (done) => {
      client.query("SELECT COUNT(*) as count FROM test_users", async (err, result) => {
        expect(err).toBeNull();
        expect(parseInt(result.rows[0].count)).toBeGreaterThanOrEqual(2);

        await waitForSpans();

        const spans = spanAdapter.getAllSpans();
        const pgSpans = spans.filter(
          (input: CleanSpanData) =>
            input.instrumentationName === "PgInstrumentation" &&
            (input.inputValue as PgClientInputValue)?.text?.includes("COUNT"),
        );
        expect(pgSpans.length).toBeGreaterThan(0);

        done();
      });
    });
  });

  describe("Function Overloads", () => {
    it("should handle all query() overload variations", async () => {
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

      for (const { name, test } of overloadTests) {
        console.log(`Testing ${name}`);

        const result = await test();
        expect(result.rows).toBeDefined();
        expect(result.rows.length).toBeGreaterThan(0);

        await waitForSpans(100);

        const spans = spanAdapter.getSpansByInstrumentation("Pg");
        expect(spans.length).toBeGreaterThan(0);

        // Clear spans for next test
        spanAdapter.clear();
      }
    });
  });

  describe("Error Handling", () => {
    it("should capture spans even for failed queries", async () => {
      try {
        await client.query("SELECT * FROM nonexistent_table");
        fail("Query should have failed");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        expect(message).toContain("does not exist");
      }

      await waitForSpans();

      const spans = spanAdapter.getAllSpans();
      const pgSpans = spans.filter(
        (input: CleanSpanData) =>
          input.instrumentationName === "PgInstrumentation" &&
          (input.inputValue as PgClientInputValue)?.text?.includes("nonexistent_table"),
      );
      expect(pgSpans.length).toBeGreaterThan(0);
    });
  });

  describe("Performance", () => {
    it("should handle concurrent queries", async () => {
      const queries = Array.from({ length: 5 }, (_, i) =>
        client.query(`SELECT ${i} as query_number, name FROM test_users LIMIT 1`),
      );

      const results = await Promise.all(queries);
      expect(results).toHaveLength(5);

      await waitForSpans();

      const spans = spanAdapter.getSpansByInstrumentation("Pg");
      expect(spans.length).toBeGreaterThanOrEqual(5);

      // Each query should have its own span
      for (let i = 0; i < 5; i++) {
        const querySpans = spans.filter((input: CleanSpanData) =>
          (input.inputValue as PgClientInputValue)?.text?.includes(`SELECT ${i}`),
        );
        expect(querySpans.length).toBeGreaterThan(0);
      }
    });
  });
});
