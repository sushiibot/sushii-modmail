import { BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";

export type DB = BunSQLiteDatabase;

export function getDb(dbUri: string): BunSQLiteDatabase {
  const sqlite = new Database(dbUri);
  const db = drizzle(sqlite, { casing: "snake_case" });

  migrate(db, {
    migrationsFolder: "./drizzle",
    migrationsSchema: "main",
    migrationsTable: "drizzle_migrations",
  });

  return db;
}
