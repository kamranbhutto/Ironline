/**
 * Recalculate the standard cost of every made part (routing + materials + made pieces), in every
 * shop. Parts update themselves when saved; run this once after upgrading, or after changing
 * work-center rates:  npm run db:recost -w @ironline/api
 */
import { eq } from "drizzle-orm";
import { createDb } from "./client.ts";
import { items } from "./schema.ts";
import { refreshStandardCost } from "../services/items.ts";

const { db, pool } = createDb(process.env.DATABASE_URL!);
const made = await db.select({ id: items.id, orgId: items.orgId }).from(items).where(eq(items.type, "manufactured"));
// Twice, so every assembly sees its pieces' new costs whatever order they come in.
for (let pass = 0; pass < 2; pass++) {
  for (const m of made) await db.transaction((tx) => refreshStandardCost(tx, { orgId: m.orgId, userId: "", role: "owner" }, m.id));
}
console.log(`Standard cost updated for ${made.length} made parts`);
await pool.end();
