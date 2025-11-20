// Note: Drizzle import may show red line locally due to missing package-lock.json
// This is expected for Docker-based E2E tests - dependencies are installed in container
import { pgTable, serial, varchar, timestamp, text, integer } from "drizzle-orm/pg-core";

export const cacheTable = pgTable("cache", {
  id: serial("id").primaryKey(),
  key: varchar("key", { length: 255 }).notNull().unique(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 100 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
