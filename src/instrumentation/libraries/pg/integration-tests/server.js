const { TuskDrift } = require("tusk-drift-sdk");

TuskDrift.initialize({
  apiKey: "random-api-key",
  env: "integration-tests",
  baseDirectory: "./tmp/traces",
});

const express = require("express");
const { Client, Pool } = require("pg");
const { PostgreSqlContainer } = require("@testcontainers/postgresql");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

let client;
let pool;
let container;
let dbConfig;

async function initializeDatabase() {
  // Start PostgreSQL container
  container = await new PostgreSqlContainer("postgres:13")
    .withDatabase("testdb")
    .withUsername("testuser")
    .withPassword("testpass")
    .withExposedPorts(5432)
    .start();

  console.log(`PostgreSQL container started on port ${container.getMappedPort(5432)}`);

  // Create database configuration from container
  dbConfig = {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    database: container.getDatabase(),
    user: container.getUsername(),
    password: container.getPassword(),
    max: 10, // maximum number of connections in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  };

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

  // Insert some test data for cursor operations
  for (let i = 1; i <= 10; i++) {
    await client.query(`INSERT INTO large_data (data_value) VALUES ($1) ON CONFLICT DO NOTHING`, [
      `test_data_${i}`,
    ]);
  }

  console.log("Database initialized successfully");
}

// Test endpoint for basic query
app.get("/test/basic-query", async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM test_users ORDER BY id");
    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint for parameterized query
app.post("/test/parameterized-query", async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await client.query("SELECT * FROM test_users WHERE id = $1", [userId]);
    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Test endpoint using client directly
app.get("/test/client-query", async (req, res) => {
  try {
    const result = await client.query(
      "SELECT name, email FROM test_users WHERE name ILIKE '%john%'",
    );
    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      queryType: "client",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// add an endpoint to test client connect and close
app.get("/test/client-connect", async (req, res) => {
  // need to create a new client
  const newClient = new Client(dbConfig);
  try {
    await newClient.connect();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await newClient.end();
  }
});

app.get("/test/client-close", async (req, res) => {
  const newClient = new Client(dbConfig);
  try {
    await newClient.connect();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  } finally {
    await newClient.end();
  }
});

// Pool test endpoints
app.get("/test/pool-query", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM test_users ORDER BY id LIMIT 5");
    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      queryType: "pool",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.post("/test/pool-parameterized", async (req, res) => {
  try {
    const { userId } = req.body;
    const result = await pool.query("SELECT * FROM test_users WHERE id = $1", [userId]);
    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      queryType: "pool-parameterized",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/test/pool-connect", async (req, res) => {
  let poolClient;
  try {
    poolClient = await pool.connect();
    const result = await poolClient.query("SELECT COUNT(*) as total FROM test_users");
    res.json({
      success: true,
      data: result.rows,
      queryType: "pool-connect",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
});

app.get("/test/pool-transaction", async (req, res) => {
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

    res.json({
      success: true,
      data: selectResult.rows,
      queryType: "pool-transaction",
    });
  } catch (error) {
    if (poolClient) {
      await poolClient.query("ROLLBACK");
    }
    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
});

app.get("/health", (req, res) => {
  if (TuskDrift.isAppReady()) {
    res.json({ success: true });
  } else {
    res.status(500).json({ success: false, error: "App not ready" });
  }
});

// Start server and initialize database
app.listen(PORT, async () => {
  try {
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`PostgreSQL integration test server running on port ${PORT}`);
    console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);
    console.log(`Container host: ${container.getHost()}:${container.getMappedPort(5432)}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Handle uncaught exceptions
process.on("uncaught Exception", async (error) => {
  console.error("Uncaught exception:", error);
  await shutdown();
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  await shutdown();
});
