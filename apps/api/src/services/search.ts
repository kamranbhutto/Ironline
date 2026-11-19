import { sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import type { Ctx } from "../ctx.ts";
import { like } from "./common.ts";

export type SearchHit = {
  kind: "customer" | "item" | "quote" | "sales_order" | "job";
  id: string;
  title: string;
  sub: string | null;
};

/** One search box across customers, parts, quotes, orders and jobs (top 5 of each). */
export async function search(db: Db, ctx: Ctx, q: string): Promise<SearchHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const p = like(term);
  const res = await db.execute<SearchHit>(sql`
    (select 'customer' as kind, id, name as title, code as sub from customers
      where org_id = ${ctx.orgId} and (name ilike ${p} or code ilike ${p}) order by name limit 5)
    union all
    (select 'item', id, part_number || ' rev ' || revision, description from items
      where org_id = ${ctx.orgId} and (part_number ilike ${p} or description ilike ${p}) order by part_number limit 5)
    union all
    (select 'quote', q.id, q.number, c.name from quotes q join customers c on c.id = q.customer_id
      where q.org_id = ${ctx.orgId} and (q.number ilike ${p} or c.name ilike ${p}) order by q.created_at desc limit 5)
    union all
    (select 'sales_order', s.id, s.number, c.name || coalesce(' · PO ' || s.customer_po, '') from sales_orders s join customers c on c.id = s.customer_id
      where s.org_id = ${ctx.orgId} and (s.number ilike ${p} or c.name ilike ${p} or s.customer_po ilike ${p}) order by s.created_at desc limit 5)
    union all
    (select 'job', id, number, description from jobs
      where org_id = ${ctx.orgId} and (number ilike ${p} or description ilike ${p}) order by created_at desc limit 5)`);
  return res.rows;
}
