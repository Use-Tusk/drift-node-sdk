// Note: Drizzle import may show red line locally due to missing package-lock.json
// This is expected for Docker-based E2E tests - dependencies are installed in container
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle> | null = null;
let connection: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL ||
      `postgres://${process.env.POSTGRES_USER || 'testuser'}:${process.env.POSTGRES_PASSWORD || 'testpass'}@${process.env.POSTGRES_HOST || 'postgres'}:${process.env.POSTGRES_PORT || '5432'}/${process.env.POSTGRES_DB || 'testdb'}`;

    connection = postgres(connectionString);
    db = drizzle(connection, { schema });
  }
  return db;
}

export async function closeDb() {
  if (connection) {
    await connection.end();
    connection = null;
    db = null;
  }
}

export { schema };
