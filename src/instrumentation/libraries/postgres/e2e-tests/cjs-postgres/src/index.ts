import { TuskDrift } from './tdInit';
import express, { Request, Response } from 'express';
import { getDb, closeDb } from './db/index';
import { cacheTable, usersTable } from './db/schema';
// Note: Drizzle import may show red line locally due to missing package-lock.json
// This is expected for Docker-based E2E tests - dependencies are installed in container
import { sql, eq } from 'drizzle-orm';
import postgres from 'postgres';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize database tables
async function initializeDatabase() {
  const db = getDb();

  console.log('Initializing database tables...');

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

  console.log('Database initialization complete');
}

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', ready: true });
});

// Drizzle query builder - select all from cache
app.get('/cache/all', async (req: Request, res: Response) => {
  try {
    console.log('Fetching all cache entries using Drizzle query builder...');
    const db = getDb();

    const result = await db.select().from(cacheTable);

    console.log('Cache entries:', result);

    res.json({
      message: 'All cache entries retrieved',
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error('Error fetching cache entries:', error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle query builder - select with limit
app.get('/cache/sample', async (req: Request, res: Response) => {
  try {
    console.log('Fetching cache sample...');
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

    console.log('Cache sample drizzle result:', drizzleResult);
    console.log('Cache sample raw SQL result:', rawResult);

    res.json({
      message: 'Cache sample retrieved',
      drizzleResult,
      rawResult,
    });
  } catch (error: any) {
    console.error('Error fetching cache sample:', error);
    res.status(500).json({ error: error.message });
  }
});

// Raw postgres template string query
app.get('/cache/raw', async (req: Request, res: Response) => {
  try {
    console.log('Fetching cache data using raw postgres template string...');

    // Create a postgres client instance
    const connectionString = process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || 'testuser'}:${process.env.POSTGRES_PASSWORD || 'testpass'}@${process.env.POSTGRES_HOST || 'postgres'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'testdb'}`;

    const pgClient = postgres(connectionString);

    // This will hit the _handleSqlQuery instrumentation method
    const result = await pgClient`
      SELECT * FROM cache
      LIMIT 2
    `;

    console.log('Raw postgres query result:', result);

    await pgClient.end();

    res.json({
      message: 'Cache data retrieved using raw postgres template string',
      count: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error('Error fetching cache data with raw postgres:', error);
    res.status(500).json({ error: error.message });
  }
});

// Execute raw SQL using drizzle session.execute
app.post('/cache/execute-raw', async (req: Request, res: Response) => {
  try {
    console.log('Executing raw SQL using drizzle session.execute...');
    const db = getDb();

    // This uses db.execute() similar to your setTransaction example
    const result = await db.execute(sql`
      SELECT key, value, expires_at, created_at, updated_at
      FROM cache
      ORDER BY created_at DESC
      LIMIT 3
    `);

    console.log('Execute result:', result);

    res.json({
      message: 'Raw SQL executed using drizzle session.execute',
      rowCount: result.length,
      data: result,
    });
  } catch (error: any) {
    console.error('Error executing raw SQL:', error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle insert
app.post('/cache/insert', async (req: Request, res: Response) => {
  try {
    console.log('Inserting cache entry using Drizzle...');
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

    console.log('Insert result:', result);

    res.json({
      message: 'Cache entry inserted',
      data: result,
    });
  } catch (error: any) {
    console.error('Error inserting cache entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle update
app.put('/cache/update', async (req: Request, res: Response) => {
  try {
    console.log('Updating cache entry using Drizzle...');
    const db = getDb();

    const { key, value } = req.body;

    const result = await db
      .update(cacheTable)
      .set({ value, updatedAt: new Date() })
      .where(eq(cacheTable.key, key))
      .returning();

    console.log('Update result:', result);

    res.json({
      message: 'Cache entry updated',
      data: result,
    });
  } catch (error: any) {
    console.error('Error updating cache entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Drizzle delete
app.delete('/cache/delete', async (req: Request, res: Response) => {
  try {
    console.log('Deleting cache entry using Drizzle...');
    const db = getDb();

    const { key } = req.body;

    const result = await db
      .delete(cacheTable)
      .where(eq(cacheTable.key, key))
      .returning();

    console.log('Delete result:', result);

    res.json({
      message: 'Cache entry deleted',
      data: result,
    });
  } catch (error: any) {
    console.error('Error deleting cache entry:', error);
    res.status(500).json({ error: error.message });
  }
});

// Users - Drizzle select with where
app.get('/users/by-email', async (req: Request, res: Response) => {
  try {
    console.log('Fetching user by email using Drizzle...');
    const db = getDb();

    const email = (req.query.email as string) || 'alice@example.com';

    const result = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    console.log('User result:', result);

    res.json({
      message: 'User retrieved by email',
      data: result,
    });
  } catch (error: any) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Users - Insert using Drizzle
app.post('/users/insert', async (req: Request, res: Response) => {
  try {
    console.log('Inserting user using Drizzle...');
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

    console.log('Insert user result:', result);

    res.json({
      message: 'User inserted',
      data: result,
    });
  } catch (error: any) {
    console.error('Error inserting user:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`Server running on port ${PORT}`);
    console.log(`TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || 'DISABLED'}`);
    console.log('Available endpoints:');
    console.log('  GET  /health - Health check');
    console.log('  GET  /cache/all - Get all cache entries (Drizzle)');
    console.log('  GET  /cache/sample - Get cache sample (Drizzle + raw SQL)');
    console.log('  GET  /cache/raw - Get cache using raw postgres template');
    console.log('  POST /cache/execute-raw - Execute raw SQL via Drizzle');
    console.log('  POST /cache/insert - Insert cache entry (Drizzle)');
    console.log('  PUT  /cache/update - Update cache entry (Drizzle)');
    console.log('  DELETE /cache/delete - Delete cache entry (Drizzle)');
    console.log('  GET  /users/by-email - Get user by email (Drizzle)');
    console.log('  POST /users/insert - Insert user (Drizzle)');
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log('Shutting down gracefully...');
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught exception:', error);
  await shutdown();
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  await shutdown();
});
