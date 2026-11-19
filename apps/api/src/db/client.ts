import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

export type Db = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; service functions accept either. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export const DEFAULT_DATABASE_URL = "postgresql:///ironline_dev?host=/var/run/postgresql";

export function createDb(url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

export { schema };
