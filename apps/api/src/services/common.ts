import { and, eq, inArray, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { Tx } from "../db/client.ts";
import { events } from "../db/schema.ts";
import { badRequest, type Ctx } from "../ctx.ts";

export const SEQUENCE_PREFIXES = {
  customer: "C-",
  quote: "Q-",
  sales_order: "SO-",
  lot: "L-",
  purchase_order: "PO-",
  job: "J-",
} as const;
export type SequenceKind = keyof typeof SEQUENCE_PREFIXES;

/** Next document number for this shop, e.g. "Q-00012". Atomic, safe under concurrency. */
export async function nextNumber(tx: Tx, orgId: string, kind: SequenceKind): Promise<string> {
  const prefix = SEQUENCE_PREFIXES[kind];
  const res = await tx.execute<{ prefix: string; value: number }>(sql`
    insert into number_sequences (org_id, kind, prefix, next_value)
    values (${orgId}, ${kind}, ${prefix}, 2)
    on conflict (org_id, kind) do update set next_value = number_sequences.next_value + 1
    returning prefix, next_value - 1 as value`);
  const row = res.rows[0]!;
  return `${row.prefix}${String(row.value).padStart(5, "0")}`;
}

export async function logEvent(
  tx: Tx,
  ctx: Ctx,
  entity: string,
  entityId: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  await tx.insert(events).values({ orgId: ctx.orgId, entity, entityId, action, data, userId: ctx.userId });
}

type OrgTable = PgTable & { id: PgColumn; orgId: PgColumn };

/**
 * Make sure every referenced id belongs to this shop. Stops a request from linking a
 * record in another organization by guessing its id.
 */
export async function assertOwned(tx: Tx, table: OrgTable, ids: (string | null | undefined)[], orgId: string, what: string) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return;
  const found = await tx
    .select({ id: table.id })
    .from(table as PgTable)
    .where(and(eq(table.orgId, orgId), inArray(table.id, wanted)));
  if (found.length !== wanted.length) throw badRequest(`Unknown ${what}`);
}

export const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
