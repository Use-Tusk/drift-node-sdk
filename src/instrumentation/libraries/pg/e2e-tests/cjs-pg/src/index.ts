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

let client: Client;
let pool: Pool;

async function initializeDatabase() {
  console.log(`Connecting to database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  // Initialize client
  client = new Client(dbConfig);
  await client.connect();

  // Initialize pool
  pool = new Pool(dbConfig);

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
