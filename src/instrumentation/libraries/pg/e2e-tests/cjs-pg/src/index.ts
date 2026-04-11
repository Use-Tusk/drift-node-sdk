import { TuskDrift } from "./tdInit";
import http from "http";
import { Client, Pool } from "pg";

const PORT = process.env.PORT || 3000;

// Database configuration
const dbConfig = {
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "testdb",
  user: process.env.POSTGRES_USER || "testuser",
  password: process.env.POSTGRES_PASSWORD || "testpass",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

// Small pool to reproduce Greenboard's pooling issue
const smallPoolConfig = {
  ...dbConfig,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let smallPool: Pool;

let client: Client;
let pool: Pool;

async function initializeDatabase() {
  console.log(`Connecting to database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  // Initialize client
  client = new Client(dbConfig);
  await client.connect();

  // Initialize pool
  pool = new Pool(dbConfig);

  // Initialize small pool for Greenboard-style stress testing
  smallPool = new Pool(smallPoolConfig);

  // Create test tables
  await client.query(`
    CREATE TABLE IF NOT EXISTS test_users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await client.query(`
    INSERT INTO test_users (name, email) VALUES
    ('John Doe', 'john@example.com'),
    ('Jane Smith', 'jane@example.com'),
    ('Bob Johnson', 'bob@example.com')
    ON CONFLICT (email) DO NOTHING
  `);

  // Create a larger table for cursor testing
  await client.query(`
    CREATE TABLE IF NOT EXISTS large_data (
      id SERIAL PRIMARY KEY,
      data_value VARCHAR(100),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert some test data
  for (let i = 1; i <= 10; i++) {
    await client.query(`INSERT INTO large_data (data_value) VALUES ($1) ON CONFLICT DO NOTHING`, [
      `test_data_${i}`,
    ]);
  }

  console.log("Database initialized successfully");
}

// Create HTTP server with test endpoints
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  try {
    // Health check endpoint
    if (url === "/health" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Test endpoint for basic query
    if (url === "/test/basic-query" && method === "GET") {
      const result = await client.query("SELECT * FROM test_users ORDER BY id");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: result.rows,
          rowCount: result.rowCount,
        }),
      );
      return;
    }

    // Test endpoint for parameterized query
    if (url === "/test/parameterized-query" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const { userId } = JSON.parse(body);
        const result = await client.query("SELECT * FROM test_users WHERE id = $1", [userId]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: result.rows,
            rowCount: result.rowCount,
          }),
        );
      });
      return;
    }

    // Test endpoint using client directly
    if (url === "/test/client-query" && method === "GET") {
      const result = await client.query(
        "SELECT name, email FROM test_users WHERE name ILIKE '%john%'",
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: result.rows,
          rowCount: result.rowCount,
          queryType: "client",
        }),
      );
      return;
    }

    // Test client connect
    if (url === "/test/client-connect" && method === "GET") {
      const newClient = new Client(dbConfig);
      try {
        await newClient.connect();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } finally {
        await newClient.end();
      }
      return;
    }

    // Test client close
    if (url === "/test/client-close" && method === "GET") {
      const newClient = new Client(dbConfig);
      try {
        await newClient.connect();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      } finally {
        await newClient.end();
      }
      return;
    }

    // Pool test endpoint
    if (url === "/test/pool-query" && method === "GET") {
      const result = await pool.query("SELECT * FROM test_users ORDER BY id LIMIT 5");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: result.rows,
          rowCount: result.rowCount,
          queryType: "pool",
        }),
      );
      return;
    }

    // Pool parameterized query
    if (url === "/test/pool-parameterized" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const { userId } = JSON.parse(body);
        const result = await pool.query("SELECT * FROM test_users WHERE id = $1", [userId]);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: result.rows,
            rowCount: result.rowCount,
            queryType: "pool-parameterized",
          }),
        );
      });
      return;
    }

    // Pool connect test
    if (url === "/test/pool-connect" && method === "GET") {
      let poolClient;
      try {
        poolClient = await pool.connect();
        const result = await poolClient.query("SELECT COUNT(*) as total FROM test_users");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: result.rows,
            queryType: "pool-connect",
          }),
        );
      } finally {
        if (poolClient) {
          poolClient.release();
        }
      }
      return;
    }

    // Pool transaction test
    if (url === "/test/pool-transaction" && method === "GET") {
      let poolClient;
      try {
        poolClient = await pool.connect();
        await poolClient.query("BEGIN");

        const insertResult = await poolClient.query(
          "INSERT INTO test_users (name, email) VALUES ($1, $2) RETURNING id",
          [`Test User ${Date.now()}`, `test${Date.now()}@example.com`],
        );

        const selectResult = await poolClient.query("SELECT * FROM test_users WHERE id = $1", [
          insertResult.rows[0].id,
        ]);

        await poolClient.query("ROLLBACK"); // Rollback to keep test data clean

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: selectResult.rows,
            queryType: "pool-transaction",
          }),
        );
      } catch (error) {
        if (poolClient) {
          await poolClient.query("ROLLBACK");
        }
        throw error;
      } finally {
        if (poolClient) {
          poolClient.release();
        }
      }
      return;
    }

    // Test endpoint for query with rowMode: 'array'
    if (url === "/test/query-rowmode-array" && method === "GET") {
      const result = await client.query({
        text: "SELECT id, name, email FROM test_users WHERE id = $1",
        values: [1],
        rowMode: "array",
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          data: result.rows,
          rowCount: result.rowCount,
          queryType: "query-rowmode-array",
        }),
      );
      return;
    }

    // Multi-statement queries
    if (url === "/test/multi-statement" && method === "GET") {
      // PostgreSQL pg library handles multi-statement queries and returns array of results
      const result = await client.query("SELECT 1 as num; SELECT 2 as num; SELECT 3 as num");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          success: true,
          // Multi-statement returns array of results or single result
          data: Array.isArray(result) ? result.map((r: any) => r.rows) : result.rows,
          queryType: "multi-statement",
        }),
      );
      return;
    }

    // =============================================
    // Greenboard-style pool stress tests
    // =============================================

    // Replicates Greenboard's getPool() health-check pattern:
    // Every query first does pool.connect() → query('SELECT 1') → release()
    // to validate the pool, then does the actual query.
    if (url === "/test/greenboard-health-check-query" && method === "GET") {
      // Step 1: Health check (matches Greenboard's getPool())
      const healthClient = await smallPool.connect();
      await healthClient.query('SELECT 1');
      healthClient.release();

      // Step 2: Actual query (matches Greenboard's executeQueryPG())
      const poolClient = await smallPool.connect();
      try {
        const results = await poolClient.query("SELECT * FROM test_users ORDER BY id LIMIT 5");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          data: results.rows,
          poolStats: {
            totalCount: smallPool.totalCount,
            idleCount: smallPool.idleCount,
            waitingCount: smallPool.waitingCount,
          },
        }));
      } finally {
        poolClient.release();
      }
      return;
    }

    // Concurrent pool stress test - fires N requests simultaneously
    // to reproduce pool exhaustion under load
    if (url === "/test/greenboard-concurrent-stress" && method === "GET") {
      const concurrency = 10; // more than max pool size of 5
      const results: any[] = [];
      const errors: any[] = [];

      const executeOneQuery = async (i: number) => {
        // Greenboard's getPool() health check
        const healthClient = await smallPool.connect();
        await healthClient.query('SELECT 1');
        healthClient.release();

        // Greenboard's executeQueryPG()
        const poolClient = await smallPool.connect();
        try {
          const result = await poolClient.query(
            "SELECT $1::int as query_num, pg_sleep(0.1)", [i]
          );
          return { success: true, queryNum: i, rows: result.rows };
        } finally {
          poolClient.release();
        }
      };

      // Fire all queries concurrently
      const promises = Array.from({ length: concurrency }, (_, i) =>
        executeOneQuery(i)
          .then(r => results.push(r))
          .catch(e => errors.push({ queryNum: i, error: e.message }))
      );

      await Promise.all(promises);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: errors.length === 0,
        totalQueries: concurrency,
        successCount: results.length,
        errorCount: errors.length,
        errors,
        poolStats: {
          totalCount: smallPool.totalCount,
          idleCount: smallPool.idleCount,
          waitingCount: smallPool.waitingCount,
        },
      }));
      return;
    }

    // Transaction test matching Greenboard's executeQueriesInTransactionPG
    if (url === "/test/greenboard-transaction" && method === "GET") {
      // Health check first
      const healthClient = await smallPool.connect();
      await healthClient.query('SELECT 1');
      healthClient.release();

      // Transaction
      const txClient = await smallPool.connect();
      try {
        await txClient.query("BEGIN");
        await txClient.query(
          "INSERT INTO test_users (name, email) VALUES ($1, $2)",
          [`TxUser ${Date.now()}`, `tx${Date.now()}@example.com`]
        );
        const result = await txClient.query("SELECT COUNT(*) as total FROM test_users");
        await txClient.query("ROLLBACK");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          data: result.rows,
          poolStats: {
            totalCount: smallPool.totalCount,
            idleCount: smallPool.idleCount,
            waitingCount: smallPool.waitingCount,
          },
        }));
      } catch (error) {
        try { await txClient.query("ROLLBACK"); } catch {}
        throw error;
      } finally {
        txClient.release();
      }
      return;
    }

    // Large result set test - reproduces the likely root cause of Greenboard's pool issue
    // The SDK serializes ALL rows in _addOutputAttributesToSpan, which blocks the event loop
    // while the pool connection is still held, causing pool exhaustion under load.
    if (url === "/test/greenboard-large-result-stress" && method === "GET") {
      const concurrency = 8; // more than pool max of 5
      const errors: any[] = [];
      const results: any[] = [];

      const executeOneQuery = async (i: number) => {
        // Greenboard health check pattern
        const healthClient = await smallPool.connect();
        await healthClient.query('SELECT 1');
        healthClient.release();

        // Simulate a query returning many rows (like Greenboard's compliance data)
        const poolClient = await smallPool.connect();
        try {
          const result = await poolClient.query(
            `SELECT generate_series(1, 1000) as id,
                    repeat('data-payload-', 10) as payload,
                    now() as created_at`
          );
          return { success: true, queryNum: i, rowCount: result.rowCount };
        } finally {
          poolClient.release();
        }
      };

      const promises = Array.from({ length: concurrency }, (_, i) =>
        executeOneQuery(i)
          .then(r => results.push(r))
          .catch(e => errors.push({ queryNum: i, error: e.message }))
      );

      await Promise.all(promises);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: errors.length === 0,
        totalQueries: concurrency,
        successCount: results.length,
        errorCount: errors.length,
        errors,
        poolStats: {
          totalCount: smallPool.totalCount,
          idleCount: smallPool.idleCount,
          waitingCount: smallPool.waitingCount,
        },
      }));
      return;
    }

    // Behavioral correctness test - checks that SDK doesn't change query return values
    if (url === "/test/behavioral-correctness" && method === "GET") {
      const issues: string[] = [];

      // Test 1: pool.query() should return full Result object with .rows, .rowCount, .command, .fields
      const poolResult = await pool.query("SELECT 1 as num, 'hello' as greeting");
      if (!poolResult.rows) issues.push("pool.query missing .rows");
      if (poolResult.rowCount !== 1) issues.push(`pool.query .rowCount=${poolResult.rowCount}, expected 1`);
      if (poolResult.command !== "SELECT") issues.push(`pool.query .command=${poolResult.command}, expected SELECT`);
      if (!poolResult.fields || poolResult.fields.length !== 2) issues.push(`pool.query .fields length=${poolResult.fields?.length}, expected 2`);
      if (poolResult.rows[0]?.num !== 1) issues.push(`pool.query rows[0].num=${poolResult.rows[0]?.num}, expected 1`);

      // Test 2: pool.connect() → client.query() should return full Result
      const poolClient = await pool.connect();
      try {
        const clientResult = await poolClient.query("SELECT 42 as answer");
        if (!clientResult.rows) issues.push("client.query missing .rows");
        if (clientResult.rowCount !== 1) issues.push(`client.query .rowCount=${clientResult.rowCount}`);
        if (clientResult.rows[0]?.answer !== 42) issues.push(`client.query rows[0].answer=${clientResult.rows[0]?.answer}`);

        // Test 3: Transaction queries should work
        await poolClient.query("BEGIN");
        const txResult = await poolClient.query("SELECT COUNT(*) as total FROM test_users");
        await poolClient.query("ROLLBACK");
        if (!txResult.rows) issues.push("tx query missing .rows");
        if (parseInt(txResult.rows[0]?.total) < 1) issues.push(`tx query total=${txResult.rows[0]?.total}`);
      } finally {
        poolClient.release();
      }

      // Test 4: Parameterized query
      const paramResult = await pool.query("SELECT $1::int + $2::int as sum", [10, 20]);
      if (paramResult.rows[0]?.sum !== 30) issues.push(`param query sum=${paramResult.rows[0]?.sum}, expected 30`);

      // Test 5: INSERT/UPDATE/DELETE returns correct rowCount
      await pool.query("CREATE TABLE IF NOT EXISTS behavior_test (id serial, val text)");
      const insertResult = await pool.query("INSERT INTO behavior_test (val) VALUES ('test1'), ('test2')");
      if (insertResult.rowCount !== 2) issues.push(`INSERT rowCount=${insertResult.rowCount}, expected 2`);
      if (insertResult.command !== "INSERT") issues.push(`INSERT command=${insertResult.command}`);

      const updateResult = await pool.query("UPDATE behavior_test SET val = 'updated' WHERE val = 'test1'");
      if (updateResult.rowCount !== 1) issues.push(`UPDATE rowCount=${updateResult.rowCount}, expected 1`);

      const deleteResult = await pool.query("DELETE FROM behavior_test");
      if (deleteResult.rowCount !== 2) issues.push(`DELETE rowCount=${deleteResult.rowCount}, expected 2`);

      await pool.query("DROP TABLE IF EXISTS behavior_test");

      // Test 6: Empty result set
      const emptyResult = await pool.query("SELECT * FROM test_users WHERE id = -1");
      if (emptyResult.rowCount !== 0) issues.push(`empty query rowCount=${emptyResult.rowCount}`);
      if (emptyResult.rows.length !== 0) issues.push(`empty query rows.length=${emptyResult.rows.length}`);

      // Test 7: Multiple concurrent pool.query() calls
      const [r1, r2, r3] = await Promise.all([
        pool.query("SELECT 1 as n"),
        pool.query("SELECT 2 as n"),
        pool.query("SELECT 3 as n"),
      ]);
      if (r1.rows[0]?.n !== 1 || r2.rows[0]?.n !== 2 || r3.rows[0]?.n !== 3) {
        issues.push(`concurrent queries returned wrong values: ${r1.rows[0]?.n},${r2.rows[0]?.n},${r3.rows[0]?.n}`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        success: issues.length === 0,
        issues,
        mode: process.env.TUSK_DRIFT_MODE,
      }));
      return;
    }

    // Event loop blocking test - measures event loop stalls caused by sync I/O
    if (url === "/test/event-loop-blocking" && method === "GET") {
      const stalls: number[] = [];
      let measuring = true;

      // Monitor event loop blocking by checking setImmediate timing
      const monitor = () => {
        if (!measuring) return;
        const start = Date.now();
        setImmediate(() => {
          const delay = Date.now() - start;
          if (delay > 10) stalls.push(delay); // record stalls > 10ms
          if (measuring) monitor();
        });
      };
      monitor();

      // Fire a burst of queries to generate many spans (simulates staging load)
      const promises = Array.from({ length: 50 }, (_, i) =>
        pool.query("SELECT generate_series(1, 500) as id, repeat('x', 200) as data")
      );
      await Promise.all(promises);

      // Wait for BatchSpanProcessor to flush (it fires every 2s)
      await new Promise(r => setTimeout(r, 3000));

      measuring = false;

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        mode: process.env.TUSK_DRIFT_MODE,
        stallsOver10ms: stalls.length,
        maxStallMs: stalls.length > 0 ? Math.max(...stalls) : 0,
        stalls,
        poolStats: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
        },
      }));
      return;
    }

    // Pool stats endpoint for monitoring
    if (url === "/test/pool-stats" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        smallPool: {
          totalCount: smallPool.totalCount,
          idleCount: smallPool.idleCount,
          waitingCount: smallPool.waitingCount,
        },
        mainPool: {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount,
        },
      }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error("Error handling request:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

// Start server and initialize database
server.listen(PORT, async () => {
  try {
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`PostgreSQL integration test server running on port ${PORT}`);
    console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  try {
    await client.end();
    await pool.end();
    await smallPool.end();
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await shutdown();
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  await shutdown();
});
