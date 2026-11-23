import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { loadEnvFile } from "node:process";
import { createConnection, createPool } from "mysql2/promise";
import type { Pool, PoolOptions } from "mysql2/promise";

// This path works from both src during development and dist after a build.
const environmentFile = new URL("../.env", import.meta.url);
if (existsSync(environmentFile)) {
  loadEnvFile(environmentFile);
}

export const databaseOptions: PoolOptions = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "mealpilot",
  charset: "utf8mb4",
  timezone: "Z",
  connectionLimit: 5,
};

export function createDatabasePool(database = databaseOptions.database): Pool {
  return createPool({ ...databaseOptions, database });
}

/** Run only the trusted schema file, keeping existing accounts and tables. */
export async function initializeDatabase(database = databaseOptions.database): Promise<void> {
  const connection = await createConnection({
    host: databaseOptions.host,
    port: databaseOptions.port,
    user: databaseOptions.user,
    password: databaseOptions.password,
    multipleStatements: true,
  });

  try {
    // Identifier placeholders quote the database name safely.
    await connection.query(
      "CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
      [database],
    );
    await connection.changeUser({ database });
    const schema = await readFile(new URL("../../database/schema.sql", import.meta.url), "utf8");
    await connection.query(schema);
  } finally {
    await connection.end();
  }
}
