import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client.ts";

export const MIGRATIONS = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, pool } = createDb();
  await runMigrations(db);
  await pool.end();
  console.log("migrations applied");
}
