process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "debug",
});
TuskDrift.markAppAsReady();

import test from "ava";
import { SpanKind } from "@opentelemetry/api";
import { SpanUtils } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../../core/types";
import { Mysql2InputValue } from "../types";

// TODO: import doesn't work
const mysql = require("mysql2");

// Check with docker-compose.test.yml!
// Use port 3307 to avoid conflicts with local MySQL instances
const TEST_MYSQL_CONFIG = {
  host: "127.0.0.1",
  port: 3307,
  database: "test_db",
  user: "test_user",
  password: "test_password",
};

async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

/** These tests don't have a root span because there's no server or anything.
 * TODO: create a proper server like http */
function withRootSpan<T>(fn: () => T): T {
  return SpanUtils.createAndExecuteSpan(
    TuskDriftMode.RECORD,
    fn,
    {
      name: "test-root-span",
      kind: SpanKind.SERVER,
      packageName: "test",
      instrumentationName: "TestInstrumentation",
      submodule: "test",
      inputValue: {},
      isPreAppStart: false,
    },
    (_spanInfo) => fn(),
  );
}

let spanAdapter: InMemorySpanAdapter;
let connection: any;
let pool: any;

test.before(async (t) => {
  spanAdapter = new InMemorySpanAdapter();
  registerInMemoryAdapter(spanAdapter);

  connection = mysql.createConnection(TEST_MYSQL_CONFIG);
  await new Promise<void>((resolve, reject) => {
    connection.connect((err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

  pool = mysql.createPool(TEST_MYSQL_CONFIG);

  // Set up test table
  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      connection.query(
        `
        CREATE TABLE IF NOT EXISTS test_users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          name VARCHAR(100),
          email VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `,
        (err: any) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  });

  // Clean and insert test data
  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      connection.query("DELETE FROM test_users", (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      connection.query(
        `
        INSERT INTO test_users (name, email) VALUES
        ('Alice Johnson', 'alice@example.com'),
        ('Bob Smith', 'bob@example.com')
      `,
        (err: any) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  });

  // Clear spans from setup
  await waitForSpans();
  spanAdapter.clear();
});

test.after.always(async () => {
  if (connection) {
    await new Promise<void>((resolve) => {
      withRootSpan(() => {
        connection.query("DROP TABLE IF EXISTS test_users", () => {
          connection.end();
          resolve();
        });
      });
    });
  }
  if (pool) {
    await new Promise<void>((resolve) => {
      pool.end(() => resolve());
    });
  }
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(async () => {
  spanAdapter.clear();

  // Reset test data to ensure consistent state between tests
  await new Promise<void>((resolve, reject) => {
    connection.query("DELETE FROM test_users", (err: any) => {
      if (err) reject(err);
      else resolve();
    });
  });

  await new Promise<void>((resolve, reject) => {
    connection.query(
      `
      INSERT INTO test_users (name, email) VALUES
      ('Alice Johnson', 'alice@example.com'),
      ('Bob Smith', 'bob@example.com')
    `,
      (err: any) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });
});

test.serial("should capture spans for SELECT queries", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      connection.query("SELECT * FROM test_users ORDER BY id", (err: any, results: any) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  });

  t.is(result.length, 2);
  t.is(result[0].name, "Alice Johnson");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "Mysql2Instrumentation",
  );
  t.true(mysql2Spans.length > 0);

  const span = mysql2Spans[0];
  t.true((span.inputValue as Mysql2InputValue).sql.includes("SELECT * FROM test_users"));
  t.is((span.outputValue as any).rowCount, 2);
});

test.serial("should capture spans for parameterized queries", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      connection.query(
        "SELECT * FROM test_users WHERE name = ?",
        ["Alice Johnson"],
        (err: any, results: any) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });

  t.is(result.length, 1);
  t.is(result[0].email, "alice@example.com");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.sql?.includes("SELECT") &&
      (input.inputValue as Mysql2InputValue)?.values?.includes("Alice Johnson"),
  );
  t.true(mysql2Spans.length > 0);

  const span = mysql2Spans[0];
  t.deepEqual((span.inputValue as Mysql2InputValue).values, ["Alice Johnson"]);
  t.is((span.outputValue as any).rowCount, 1);
});

test.serial("should capture spans for INSERT operations", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      connection.query(
        "INSERT INTO test_users (name, email) VALUES (?, ?)",
        ["Charlie Brown", "charlie@example.com"],
        (err: any, results: any) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });

  t.truthy(result.insertId);
  t.is(result.affectedRows, 1);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.sql?.includes("INSERT") &&
      (input.inputValue as Mysql2InputValue)?.values?.includes("Charlie Brown"),
  );
  t.true(mysql2Spans.length > 0);

  const span = mysql2Spans[0];
  t.deepEqual((span.inputValue as Mysql2InputValue).values, [
    "Charlie Brown",
    "charlie@example.com",
  ]);
  t.is((span.outputValue as any).affectedRows, 1);
});

test.serial("should capture spans for UPDATE operations", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      connection.query(
        "UPDATE test_users SET email = ? WHERE name = ?",
        ["alice.new@example.com", "Alice Johnson"],
        (err: any, results: any) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });

  t.is(result.affectedRows, 1);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.sql?.includes("UPDATE") &&
      (input.inputValue as Mysql2InputValue)?.values?.includes("alice.new@example.com"),
  );
  t.true(mysql2Spans.length > 0);

  const span = mysql2Spans[0];
  t.is((span.outputValue as any).affectedRows, 1);
});

test.serial("should capture spans for prepared statements (execute)", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      connection.execute(
        "SELECT * FROM test_users WHERE name = ?",
        ["Bob Smith"],
        (err: any, results: any) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });

  t.is(result.length, 1);
  t.is(result[0].email, "bob@example.com");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      input.name === "mysql2.connection.execute",
  );
  t.true(mysql2Spans.length > 0);

  const span = mysql2Spans[0];
  t.true((span.inputValue as Mysql2InputValue).sql.includes("SELECT"));
  t.deepEqual((span.inputValue as Mysql2InputValue).values, ["Bob Smith"]);
});

test.serial("should capture spans for pool queries", async (t) => {
  const result = await new Promise<any>((resolve, reject) => {
    withRootSpan(() => {
      pool.query("SELECT * FROM test_users ORDER BY id LIMIT 1", (err: any, results: any) => {
        if (err) reject(err);
        else resolve(results);
      });
    });
  });

  t.is(result.length, 1);
  t.is(result[0].name, "Alice Johnson");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "Mysql2Instrumentation",
  );

  // pool.query() internally calls pool.getConnection() to acquire a connection,
  // then executes the query on that poolConnection, so we expect multiple spans:
  // 1. mysql2.pool.getConnection - internal connection acquisition
  // 2. mysql2.poolConnection.query - the actual query execution
  t.true(mysql2Spans.length >= 2, "Expected at least 2 spans for pool.query");

  const getConnectionSpan = mysql2Spans.find((s: CleanSpanData) => s.name === "mysql2.pool.getConnection");
  t.truthy(getConnectionSpan, "Should have pool.getConnection span");

  const poolConnectionQuerySpan = mysql2Spans.find(
    (s: CleanSpanData) => s.name === "mysql2.poolConnection.query",
  );
  t.truthy(poolConnectionQuerySpan, "Should have poolConnection.query span");
  t.true(
    (poolConnectionQuerySpan?.inputValue as Mysql2InputValue)?.sql?.includes("SELECT * FROM test_users"),
  );
});

test.serial("should capture spans for pool.getConnection", async (t) => {
  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      pool.getConnection((err: any, poolConnection: any) => {
        if (err) {
          reject(err);
          return;
        }

        poolConnection.query("SELECT COUNT(*) as count FROM test_users", (err: any, results: any) => {
          poolConnection.release();

          if (err) {
            reject(err);
            return;
          }

          t.true(parseInt(results[0].count) >= 2);
          resolve();
        });
      });
    });
  });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const getConnectionSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      input.name === "mysql2.pool.getConnection",
  );
  t.true(getConnectionSpans.length > 0);

  const poolConnectionQuerySpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.clientType === "poolConnection",
  );
  t.true(poolConnectionQuerySpans.length > 0);
});

test.serial("should handle all query() overload variations", async (t) => {
  const overloadTests = [
    {
      name: "query(text)",
      test: () =>
        new Promise<any>((resolve, reject) => {
          withRootSpan(() => {
            connection.query("SELECT 1 as test", (err: any, results: any) => {
              if (err) reject(err);
              else resolve(results);
            });
          });
        }),
    },
    {
      name: "query(text, values)",
      test: () =>
        new Promise<any>((resolve, reject) => {
          withRootSpan(() => {
            connection.query("SELECT ? as test", [42], (err: any, results: any) => {
              if (err) reject(err);
              else resolve(results);
            });
          });
        }),
    },
    {
      name: "query(config)",
      test: () =>
        new Promise<any>((resolve, reject) => {
          withRootSpan(() => {
            connection.query({ sql: "SELECT 2 as test" }, (err: any, results: any) => {
              if (err) reject(err);
              else resolve(results);
            });
          });
        }),
    },
    {
      name: "query(config with values)",
      test: () =>
        new Promise<any>((resolve, reject) => {
          withRootSpan(() => {
            connection.query(
              {
                sql: "SELECT ? as test",
                values: [99],
              },
              (err: any, results: any) => {
                if (err) reject(err);
                else resolve(results);
              },
            );
          });
        }),
    },
  ];

  for (const { name, test: testFn } of overloadTests) {
    console.log(`Testing ${name}`);

    const result = await testFn();
    t.truthy(result);
    t.true(result.length > 0);

    await waitForSpans();

    const spans = spanAdapter.getSpansByInstrumentation("Mysql2");
    t.true(spans.length > 0);

    // Clear spans for next test
    spanAdapter.clear();
  }
});

test.serial("should capture spans even for failed queries", async (t) => {
  const error = await t.throwsAsync(
    async () => {
      await new Promise<void>((resolve, reject) => {
        withRootSpan(() => {
          connection.query("SELECT * FROM nonexistent_table", (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
      });
    },
    undefined,
  );

  t.truthy(error);
  const message = error instanceof Error ? error.message : String(error);
  t.true(message.includes("doesn't exist") || message.includes("does not exist"));

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.sql?.includes("nonexistent_table"),
  );
  t.true(mysql2Spans.length > 0);
});

test.serial("should handle concurrent queries", async (t) => {
  const queries = Array.from({ length: 5 }, (_, i) =>
    new Promise<any>((resolve, reject) => {
      withRootSpan(() => {
        connection.query(
          `SELECT ${i} as query_number, name FROM test_users LIMIT 1`,
          (err: any, results: any) => {
            if (err) reject(err);
            else resolve(results);
          },
        );
      });
    }),
  );

  const results = await Promise.all(queries);
  t.is(results.length, 5);

  await waitForSpans();

  const spans = spanAdapter.getSpansByInstrumentation("Mysql2");
  t.true(spans.length >= 5);

  // Each query should have its own span
  for (let i = 0; i < 5; i++) {
    const querySpans = spans.filter((input: CleanSpanData) =>
      (input.inputValue as Mysql2InputValue)?.sql?.includes(`SELECT ${i}`),
    );
    t.true(querySpans.length > 0);
  }
});

test.serial("should handle streaming queries", async (t) => {
  const rows: any[] = [];

  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      const query = connection.query("SELECT * FROM test_users ORDER BY id");

      query
        .on("error", (err: any) => {
          reject(err);
        })
        .on("result", (row: any) => {
          rows.push(row);
        })
        .on("end", () => {
          resolve();
        });
    });
  });

  t.is(rows.length, 2);
  t.is(rows[0].name, "Alice Johnson");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mysql2Spans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      (input.inputValue as Mysql2InputValue)?.sql?.includes("SELECT * FROM test_users"),
  );
  t.true(mysql2Spans.length > 0);
});

test.serial("should handle connection.ping", async (t) => {
  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      connection.ping((err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pingSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      input.name === "mysql2.connection.ping",
  );
  t.true(pingSpans.length > 0);
});

test.serial("should handle connection.connect", async (t) => {
  const newConnection = mysql.createConnection(TEST_MYSQL_CONFIG);

  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      newConnection.connect((err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const connectSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "Mysql2Instrumentation" &&
      input.name === "mysql2.connection.connect",
  );
  t.true(connectSpans.length > 0);

  // Cleanup
  await new Promise<void>((resolve) => {
    newConnection.end(() => resolve());
  });
});
