import { TuskDrift } from "./tdInit.js";
import express, { Request, Response } from "express";
import { getDb, closeDb } from "./db/index.js";
import { cacheTable, usersTable } from "./db/schema.js";
// Note: Drizzle import may show red line locally due to missing package-lock.json
// This is expected for Docker-based E2E tests - dependencies are installed in container
import { sql, eq } from "drizzle-orm";
import postgres from "postgres";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize database tables
async function initializeDatabase() {
  const db = getDb();

  console.log("Initializing database tables...");

  // Create cache table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS cache (
      id SERIAL PRIMARY KEY,
      key VARCHAR(255) NOT NULL UNIQUE,
      value TEXT NOT NULL,
      expires_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // Create users table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // delete any existing users
  await db.execute(sql`
    DELETE FROM users;
  `);

  // Insert seed data for cache
  await db.execute(sql`
    INSERT INTO cache (key, value, expires_at)
    VALUES
      ('test_key_1', 'test_value_1', NOW() + INTERVAL '1 day'),
      ('test_key_2', 'test_value_2', NOW() + INTERVAL '2 days'),
      ('test_key_3', 'test_value_3', NOW() + INTERVAL '3 days')
    ON CONFLICT (key) DO NOTHING
  `);

  // Insert seed data for users
  await db.execute(sql`
    INSERT INTO users (name, email)
    VALUES
      ('Alice Johnson', 'alice@example.com'),
      ('Bob Smith', 'bob@example.com'),
      ('Charlie Brown', 'charlie@example.com')
    ON CONFLICT (email) DO NOTHING
  `);

  // Create subscriptions table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      plan_name VARCHAR(100) NOT NULL,
      status VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `);

  // Insert seed data for subscriptions
  await db.execute(sql`
    INSERT INTO subscriptions (user_id, plan_name, status)
    VALUES
      (1, 'Pro Plan', 'active'),
      (2, 'Basic Plan', 'active'),
      (3, 'Enterprise Plan', 'trial')
    ON CONFLICT DO NOTHING
  `);

  console.log("Database initialization complete");
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", ready: true });
});

// Drizzle query builder - select all from cache
app.get("/cache/all", async (req: Request, res: Response) => {
  try {
    console.log("Fetching all cache entries using Drizzle query builder...");
    const db = getDb();

    const result = await db.select().from(cacheTable);

    console.log("Cache entries:", result);

    res.json({
      message: "All cache entries retrieved",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error fetching cache entries:", error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle query builder - select with limit
app.get("/cache/sample", async (req: Request, res: Response) => {
  try {
    console.log("Fetching cache sample...");
    const db = getDb();

    // Original Drizzle query builder approach
    const drizzleResult = await db.select().from(cacheTable).limit(1);

    // Simple raw SQL query using sql template literal
    const rawResult = await db.execute(sql`
      SELECT key, value, expires_at, created_at, updated_at
      FROM cache
      ORDER BY created_at DESC
      LIMIT 3
    `);

    console.log("Cache sample drizzle result:", drizzleResult);
    console.log("Cache sample raw SQL result:", rawResult);

    res.json({
      message: "Cache sample retrieved",
      drizzleResult,
      rawResult,
    });
  } catch (error: any) {
    console.error("Error fetching cache sample:", error);
    res.status(500).json({ error: error.message });
  }
});

// Raw postgres template string query
app.get("/cache/raw", async (req: Request, res: Response) => {
  try {
    console.log("Fetching cache data using raw postgres template string...");

    // Create a postgres client instance
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // This will hit the _handleSqlQuery instrumentation method
    const result = await pgClient`
      SELECT * FROM cache
      LIMIT 2
    `;

    console.log("Raw postgres query result:", result);

    await pgClient.end();

    res.json({
      message: "Cache data retrieved using raw postgres template string",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error fetching cache data with raw postgres:", error);
    res.status(500).json({ error: error.message });
  }
});

// Execute raw SQL using drizzle session.execute
app.post("/cache/execute-raw", async (req: Request, res: Response) => {
  try {
    console.log("Executing raw SQL using drizzle session.execute...");
    const db = getDb();

    // This uses db.execute() similar to your setTransaction example
    const result = await db.execute(sql`
      SELECT key, value, expires_at, created_at, updated_at
      FROM cache
      ORDER BY created_at DESC
      LIMIT 3
    `);

    console.log("Execute result:", result);

    res.json({
      message: "Raw SQL executed using drizzle session.execute",
      rowCount: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error executing raw SQL:", error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle insert
app.post("/cache/insert", async (req: Request, res: Response) => {
  try {
    console.log("Inserting cache entry using Drizzle...");
    const db = getDb();

    const { key, value } = req.body;
    const timestamp = Date.now();

    const result = await db
      .insert(cacheTable)
      .values({
        key: key || `test_key_${timestamp}`,
        value: value || `test_value_${timestamp}`,
        expiresAt: new Date(Date.now() + 86400000), // 1 day from now
      })
      .returning();

    console.log("Insert result:", result);

    res.json({
      message: "Cache entry inserted",
      data: result,
    });
  } catch (error: any) {
    console.error("Error inserting cache entry:", error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle update
app.put("/cache/update", async (req: Request, res: Response) => {
  try {
    console.log("Updating cache entry using Drizzle...");
    const db = getDb();

    const { key, value } = req.body;

    const result = await db
      .update(cacheTable)
      .set({ value, updatedAt: new Date() })
      .where(eq(cacheTable.key, key))
      .returning();

    console.log("Update result:", result);

    res.json({
      message: "Cache entry updated",
      data: result,
    });
  } catch (error: any) {
    console.error("Error updating cache entry:", error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle delete
app.delete("/cache/delete", async (req: Request, res: Response) => {
  try {
    console.log("Deleting cache entry using Drizzle...");
    const db = getDb();

    const { key } = req.body;

    const result = await db.delete(cacheTable).where(eq(cacheTable.key, key)).returning();

    console.log("Delete result:", result);

    res.json({
      message: "Cache entry deleted",
      data: result,
    });
  } catch (error: any) {
    console.error("Error deleting cache entry:", error);
    res.status(500).json({ error: error.message });
  }
});

// Users - Drizzle select with where
app.get("/users/by-email", async (req: Request, res: Response) => {
  try {
    console.log("Fetching user by email using Drizzle...");
    const db = getDb();

    const email = (req.query.email as string) || "alice@example.com";

    const result = await db.select().from(usersTable).where(eq(usersTable.email, email));

    console.log("User result:", result);

    res.json({
      message: "User retrieved by email",
      data: result,
    });
  } catch (error: any) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Users - Insert using Drizzle
app.post("/users/insert", async (req: Request, res: Response) => {
  try {
    console.log("Inserting user using Drizzle...");
    const db = getDb();

    const { name, email } = req.body;
    const timestamp = Date.now();

    const result = await db
      .insert(usersTable)
      .values({
        name: name || `User ${timestamp}`,
        email: email || `user${timestamp}@example.com`,
      })
      .returning();

    console.log("Insert user result:", result);

    res.json({
      message: "User inserted",
      data: result,
    });
  } catch (error: any) {
    console.error("Error inserting user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test dynamic query building with sql() fragment helpers
app.get("/cache/dynamic-fragments", async (req: Request, res: Response) => {
  try {
    console.log("Testing dynamic query building with sql() fragment helpers...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Test 1: Dynamic column selection using sql() helper
    const columns = ["key", "value"];
    const result1 = await pgClient`SELECT ${pgClient(columns)} FROM cache LIMIT 2`;

    console.log("Dynamic columns result:", result1);

    // Test 2: Conditional WHERE clause using fragment
    const minId = 1;
    const useFilter = true;
    const whereClause = useFilter ? pgClient`WHERE id >= ${minId}` : pgClient``;

    const result2 = await pgClient`
      SELECT * FROM cache
      ${whereClause}
      LIMIT 2
    `;

    console.log("Conditional WHERE result:", result2);

    // Test 3: Helper function that returns sql fragment (similar to customer's where() helper)
    const buildWhereClause = (conditions: { field: string; value: any }[]) => {
      if (conditions.length === 0) return pgClient``;

      const clauses = conditions.map((c) => pgClient`${pgClient(c.field)} = ${c.value}`);

      // Combine clauses with AND
      let combined = clauses[0];
      for (let i = 1; i < clauses.length; i++) {
        combined = pgClient`${combined} AND ${clauses[i]}`;
      }

      return pgClient`WHERE ${combined}`;
    };

    const conditions = [{ field: "key", value: "test_key_1" }];
    const dynamicWhere = buildWhereClause(conditions);

    const result3 = await pgClient`
      SELECT * FROM cache
      ${dynamicWhere}
    `;

    console.log("Dynamic WHERE helper result:", result3);

    await pgClient.end();

    res.json({
      message: "Dynamic fragment queries executed successfully",
      results: {
        dynamicColumns: result1,
        conditionalWhere: result2,
        helperFunction: result3,
      },
    });
  } catch (error: any) {
    console.error("Error in dynamic fragments test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test UPDATE with dynamic fragments (mimics customer's exact pattern)
app.post("/cache/update-with-fragments", async (req: Request, res: Response) => {
  try {
    console.log("Testing UPDATE with dynamic sql() fragments...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Helper that builds WHERE clause from selectors (mimics customer's where() function)
    const where = (selectors: Record<string, any>) => {
      const keys = Object.keys(selectors);
      if (keys.length === 0) return pgClient``;

      const conditions = keys.map((key) => pgClient`${pgClient(key)} = ${selectors[key]}`);

      let combined = conditions[0];
      for (let i = 1; i < conditions.length; i++) {
        combined = pgClient`${combined} AND ${conditions[i]}`;
      }

      return combined;
    };

    // This mimics the customer's exact pattern from the screenshot
    const selectors = { key: "test_key_1" };
    const newValue = { updated: true, timestamp: Date.now() };

    const result = await pgClient`
      UPDATE cache
      SET value = ${JSON.stringify(newValue)}
      WHERE ${where(selectors)} AND value IS NOT NULL
    `;

    console.log("UPDATE with fragments result:", result);

    await pgClient.end();

    res.json({
      message: "UPDATE with dynamic fragments executed successfully",
      result: {
        count: result.count,
      },
    });
  } catch (error: any) {
    console.error("Error in UPDATE with fragments test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test complex nested fragments (advanced pattern)
app.get("/cache/complex-fragments", async (req: Request, res: Response) => {
  try {
    console.log("Testing complex nested sql() fragments...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Complex builder pattern with multiple levels of nesting
    const buildFilter = (options: { minId?: number; keyPattern?: string; hasExpiry?: boolean }) => {
      const parts = [];

      if (options.minId !== undefined) {
        parts.push(pgClient`id >= ${options.minId}`);
      }

      if (options.keyPattern) {
        parts.push(pgClient`key LIKE ${options.keyPattern}`);
      }

      if (options.hasExpiry !== undefined) {
        parts.push(
          options.hasExpiry ? pgClient`expires_at IS NOT NULL` : pgClient`expires_at IS NULL`,
        );
      }

      if (parts.length === 0) return pgClient``;

      let combined = parts[0];
      for (let i = 1; i < parts.length; i++) {
        combined = pgClient`${combined} AND ${parts[i]}`;
      }

      return pgClient`WHERE ${combined}`;
    };

    const orderBy = (column: string, direction: "ASC" | "DESC" = "ASC") => {
      return pgClient`ORDER BY ${pgClient(column)} ${pgClient.unsafe(direction)}`;
    };

    const filterOptions = { minId: 1, keyPattern: "test%", hasExpiry: true };
    const filter = buildFilter(filterOptions);
    const order = orderBy("created_at", "DESC");

    const result = await pgClient`
      SELECT * FROM cache
      ${filter}
      ${order}
      LIMIT 3
    `;

    console.log("Complex fragments result:", result);

    await pgClient.end();

    res.json({
      message: "Complex nested fragments executed successfully",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in complex fragments test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test sql.file() method
app.get("/test/sql-file", async (req: Request, res: Response) => {
  try {
    console.log("Testing sql.file() method...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Execute query from file
    const result = await pgClient.file("/app/src/test-query.sql");

    console.log("SQL file result:", result);

    await pgClient.end();

    res.json({
      message: "SQL file executed successfully",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in sql.file test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test .execute() method for immediate execution
app.get("/test/execute-method", async (req: Request, res: Response) => {
  try {
    console.log("Testing .execute() method for immediate query execution...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Using .execute() forces the query to run immediately
    const result = await pgClient`SELECT * FROM cache LIMIT 1`.execute();

    console.log("Execute method result:", result);

    await pgClient.end();

    res.json({
      message: "Execute method test completed",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in execute method test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test PendingQuery.raw() for raw buffer results
app.get("/test/pending-query-raw", async (req: Request, res: Response) => {
  try {
    console.log("Testing PendingQuery.raw() for raw buffer results...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // .raw() returns raw Buffer arrays instead of parsed objects
    const result = await pgClient`SELECT * FROM cache LIMIT 2`.raw();

    console.log("Raw buffer query result:", result);

    await pgClient.end();

    res.json({
      message: "PendingQuery.raw() test completed",
      count: result.length,
      // Convert buffers to strings for JSON response
      data: result.map((row) => row.map((buf) => (buf instanceof Buffer ? buf.toString() : buf))),
    });
  } catch (error: any) {
    console.error("Error in PendingQuery.raw test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test sql.reserve() for reserved connections
app.get("/test/sql-reserve", async (req: Request, res: Response) => {
  try {
    console.log("Testing sql.reserve() for reserved connections...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Reserve a dedicated connection from the pool
    const reserved = await pgClient.reserve();

    // Execute a query on the reserved connection
    const result = await reserved`SELECT * FROM cache LIMIT 2`;

    console.log("Reserved connection query result:", result);

    // Release the connection back to the pool
    reserved.release();

    await pgClient.end();

    res.json({
      message: "sql.reserve() test completed",
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error("Error in sql.reserve test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test sql.cursor() for cursor-based streaming
app.get("/test/sql-cursor", async (req: Request, res: Response) => {
  try {
    console.log("Testing sql.cursor() for cursor-based streaming...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // cursor() returns an async iterator for streaming results
    const cursorResults: any[] = [];
    const cursor = pgClient`SELECT * FROM cache`.cursor(2);

    for await (const rows of cursor) {
      console.log("Cursor batch:", rows);
      cursorResults.push(...rows);
    }

    console.log("Cursor complete, total rows:", cursorResults.length);

    await pgClient.end();

    res.json({
      message: "sql.cursor() test completed",
      count: cursorResults.length,
      data: cursorResults,
    });
  } catch (error: any) {
    console.error("Error in sql.cursor test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test sql.cursor() with callback function
app.get("/test/sql-cursor-callback", async (req: Request, res: Response) => {
  try {
    console.log("Testing sql.cursor() with callback function...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // cursor(rows, fn) with callback - this delegates to original and goes through .then()
    const cursorResults: any[] = [];
    await pgClient`SELECT * FROM cache`.cursor(2, (rows) => {
      console.log("Cursor callback batch:", rows);
      cursorResults.push(...rows);
    });

    console.log("Cursor with callback complete, total rows:", cursorResults.length);

    await pgClient.end();

    res.json({
      message: "sql.cursor() with callback test completed",
      count: cursorResults.length,
      data: cursorResults,
    });
  } catch (error: any) {
    console.error("Error in sql.cursor callback test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Test sql.forEach() for row-by-row processing
app.get("/test/sql-foreach", async (req: Request, res: Response) => {
  try {
    console.log("Testing sql.forEach() for row-by-row processing...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // forEach processes rows one at a time with a callback
    const forEachResults: any[] = [];
    await pgClient`SELECT * FROM cache LIMIT 3`.forEach((row) => {
      console.log("forEach row:", row);
      forEachResults.push(row);
    });

    console.log("forEach complete, total rows:", forEachResults.length);

    await pgClient.end();

    res.json({
      message: "sql.forEach() test completed",
      count: forEachResults.length,
      data: forEachResults,
    });
  } catch (error: any) {
    console.error("Error in sql.forEach test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get("/test/describe-method", async (req: Request, res: Response) => {
  try {
    console.log("Testing describe() method...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // describe() returns statement metadata without executing the query
    const result = await pgClient`SELECT id, key, value FROM cache WHERE id = ${1}`.describe();

    console.log("describe() result:", result);

    await pgClient.end();

    res.json({
      message: "describe() method test completed",
      // describe returns statement info, not rows
      statement: (result as any).statement,
      columns: (result as any).columns,
    });
  } catch (error: any) {
    console.error("Error in describe() test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get("/test/savepoint", async (req: Request, res: Response) => {
  try {
    console.log("Testing savepoint() nested transactions...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    let outerResult: any = null;
    let innerResult: any = null;

    const result = await pgClient.begin(async (sql) => {
      // Outer transaction - insert a user
      outerResult =
        await sql`INSERT INTO users (name, email) VALUES ('Outer User', 'outer@test.com') RETURNING *`;

      // Nested savepoint
      await sql.savepoint(async (sql2) => {
        // Inner savepoint - insert another user
        innerResult =
          await sql2`INSERT INTO users (name, email) VALUES ('Inner User', 'inner@test.com') RETURNING *`;
      });

      // Query both after savepoint
      const allUsers = await sql`SELECT * FROM users WHERE email LIKE '%@test.com'`;
      return allUsers;
    });

    console.log("savepoint() result:", result);

    // Cleanup
    await pgClient`DELETE FROM users WHERE email LIKE '%@test.com'`;
    await pgClient.end();

    res.json({
      message: "savepoint() test completed",
      outerResult,
      innerResult,
      finalResult: result,
    });
  } catch (error: any) {
    console.error("Error in savepoint() test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get("/test/listen-notify", async (req: Request, res: Response) => {
  try {
    console.log("Testing listen() / notify()...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    let receivedPayload: string | null = null;

    // Set up listener
    const { unlisten } = await pgClient.listen("test_channel", (payload) => {
      console.log("Received notification:", payload);
      receivedPayload = payload;
    });

    // Send notification
    await pgClient.notify("test_channel", "test_message_" + Date.now());

    // Wait a bit for the notification to be received
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Cleanup
    await unlisten();
    await pgClient.end();

    res.json({
      message: "listen()/notify() test completed",
      receivedPayload,
    });
  } catch (error: any) {
    console.error("Error in listen/notify test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.get("/test/bytea-data", async (req: Request, res: Response) => {
  try {
    console.log("Testing bytea/binary data handling...");
    const connectionString =
      process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || "testuser"}:${process.env.POSTGRES_PASSWORD || "testpass"}@${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || "5432"}/${process.env.POSTGRES_DB || "testdb"}`;

    const pgClient = postgres(connectionString);

    // Test bytea data
    const binaryData = Buffer.from("Hello Binary World!");
    const result = await pgClient`
      SELECT ${binaryData}::bytea as binary_col
    `;

    console.log("Bytea result:", result);

    await pgClient.end();

    res.json({
      message: "Bytea test completed",
      data: result[0],
      binaryAsString: result[0]?.binary_col?.toString?.() || String(result[0]?.binary_col),
    });
  } catch (error: any) {
    console.error("Error in bytea test:", error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`Server running on port ${PORT}`);
    console.log(`TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || "DISABLED"}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
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
