import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { customers, events, items, jobs, quotes, salesOrderLines, salesOrders, users } from "../db/schema.ts";
import { notFound, today, type Ctx } from "../ctx.ts";
import { like } from "./common.ts";

export async function listSalesOrders(db: Db, ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  const where = [eq(salesOrders.orgId, ctx.orgId)];
  if (opts.status === "open") where.push(inArray(salesOrders.status, ["confirmed", "in_production"]));
  else if (opts.status) where.push(eq(salesOrders.status, opts.status));
  if (opts.q) {
    where.push(or(ilike(salesOrders.number, like(opts.q)), ilike(customers.name, like(opts.q)), ilike(salesOrders.customerPo, like(opts.q)))!);
  }
  return db
    .select({
      id: salesOrders.id,
      number: salesOrders.number,
      status: salesOrders.status,
      customerId: salesOrders.customerId,
      customerName: customers.name,
      customerPo: salesOrders.customerPo,
      orderDate: salesOrders.orderDate,
      totalPrice: salesOrders.totalPrice,
      dueDate: sql<string | null>`(select min(l.due_date)::text from sales_order_lines l where l.sales_order_id = ${salesOrders.id})`,
    })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...where))
    .orderBy(desc(salesOrders.createdAt))
    .limit(500);
}

export async function getSalesOrder(db: Db, ctx: Ctx, id: string) {
  const [row] = await db
    .select({ order: salesOrders, customerName: customers.name, quoteNumber: quotes.number })
    .from(salesOrders)
    .innerJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(quotes, eq(quotes.id, salesOrders.quoteId))
    .where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.id, id)));
  if (!row) throw notFound("Sales order");
  const lineRows = await db
    .select({ line: salesOrderLines, partNumber: items.partNumber, revision: items.revision })
    .from(salesOrderLines)
    .leftJoin(items, eq(items.id, salesOrderLines.itemId))
    .where(eq(salesOrderLines.salesOrderId, id))
    .orderBy(asc(salesOrderLines.lineNo));
  const lines = lineRows.map((r) => ({ ...r.line, partNumber: r.partNumber, revision: r.revision }));
  const jobRows = lines.length
    ? await db
        .select({ id: jobs.id, number: jobs.number, status: jobs.status, salesOrderLineId: jobs.salesOrderLineId, dueDate: jobs.dueDate, quantity: jobs.quantity, quantityCompleted: jobs.quantityCompleted })
        .from(jobs)
        .where(inArray(jobs.salesOrderLineId, lines.map((l) => l.id)))
    : [];
  // The order's own history plus what happened on its jobs, newest first.
  const jobIds = jobRows.map((j) => j.id);
  const log = await db
    .select({ id: events.id, entity: events.entity, entityId: events.entityId, action: events.action, data: events.data, createdAt: events.createdAt, userName: users.name })
    .from(events)
    .leftJoin(users, eq(users.id, events.userId))
    .where(
      and(
        eq(events.orgId, ctx.orgId),
        or(and(eq(events.entity, "sales_order"), eq(events.entityId, id)), jobIds.length ? and(eq(events.entity, "job"), inArray(events.entityId, jobIds), inArray(events.action, ["created", "status"])) : undefined),
      ),
    )
    .orderBy(desc(events.createdAt))
    .limit(200);
  return {
    ...row.order,
    log: log.map((e) => ({ ...e, jobNumber: e.entity === "job" ? jobRows.find((j) => j.id === e.entityId)?.number ?? null : null })),
    customerName: row.customerName,
    quoteNumber: row.quoteNumber,
    lines: lines.map((l) => ({ ...l, jobs: jobRows.filter((j) => j.salesOrderLineId === l.id) })),
  };
}

/** Numbers for the home dashboard. */
export async function dashboard(db: Db, ctx: Ctx) {
  const t = today();
  const res = await db.execute<Record<string, number>>(sql`
    select
      (select count(*)::int from quotes where org_id = ${ctx.orgId} and status in ('draft','sent')) as open_quotes,
      (select coalesce(sum(total_price),0)::float from quotes where org_id = ${ctx.orgId} and status = 'sent') as quoted_value,
      (select count(*)::int from quotes where org_id = ${ctx.orgId} and status = 'won' and decided_at > now() - interval '90 days') as won_90,
      (select count(*)::int from quotes where org_id = ${ctx.orgId} and status in ('won','lost') and decided_at > now() - interval '90 days') as decided_90,
      (select count(*)::int from sales_orders where org_id = ${ctx.orgId} and status in ('confirmed','in_production')) as open_orders,
      (select coalesce(sum(total_price),0)::float from sales_orders where org_id = ${ctx.orgId} and status in ('confirmed','in_production')) as backlog,
      (select count(*)::int from jobs where org_id = ${ctx.orgId} and status in ('planned','released','in_progress')) as open_jobs,
      (select count(*)::int from jobs where org_id = ${ctx.orgId} and status in ('planned','released','in_progress') and due_date < ${t}) as late_jobs`);
  const r = res.rows[0]!;
  return {
    openQuotes: r.open_quotes!,
    quotedValue: r.quoted_value!,
    winRate90: r.decided_90 ? Math.round((r.won_90! / r.decided_90!) * 1000) / 10 : null,
    openOrders: r.open_orders!,
    backlog: r.backlog!,
    openJobs: r.open_jobs!,
    lateJobs: r.late_jobs!,
  };
}
