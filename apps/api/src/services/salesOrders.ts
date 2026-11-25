import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db/client.ts";
import { customers, events, items, jobs, quotes, salesOrderLines, salesOrders, users } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, today, type Ctx } from "../ctx.ts";
import { like, logEvent } from "./common.ts";

/** Orders still being worked on or waiting to go out. */
const OPEN = ["confirmed", "in_production", "ready"];

export async function listSalesOrders(db: Db, ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  const where = [eq(salesOrders.orgId, ctx.orgId)];
  if (opts.status === "open") where.push(inArray(salesOrders.status, OPEN));
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
      (select count(*)::int from sales_orders where org_id = ${ctx.orgId} and status in ('confirmed','in_production','ready')) as open_orders,
      (select coalesce(sum(total_price),0)::float from sales_orders where org_id = ${ctx.orgId} and status in ('confirmed','in_production','ready')) as backlog,
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

// ── Order status follows the jobs; shipping and closing ─────────────────────

/**
 * Keep an open order's status in step with its jobs: "ready" (to ship) once every line has at
 * least one job and all of them are complete or closed (cancelled jobs are ignored); back to
 * "in_production" if a job is reopened. Shipped, closed and cancelled orders are left alone.
 */
export async function refreshOrderStatus(tx: Tx, ctx: Ctx, orderId: string) {
  const [o] = await tx.select({ id: salesOrders.id, status: salesOrders.status }).from(salesOrders).where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.id, orderId)));
  if (!o || !OPEN.includes(o.status)) return;
  const lines = await tx.select({ id: salesOrderLines.id }).from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, orderId));
  if (!lines.length) return;
  const js = await tx.select({ lineId: jobs.salesOrderLineId, status: jobs.status }).from(jobs).where(inArray(jobs.salesOrderLineId, lines.map((l) => l.id)));
  const ready = lines.every((l) => {
    const mine = js.filter((j) => j.lineId === l.id && j.status !== "cancelled");
    return mine.length > 0 && mine.every((j) => j.status === "complete" || j.status === "closed");
  });
  const next = ready ? "ready" : o.status === "ready" ? "in_production" : o.status;
  if (next === o.status) return;
  await tx.update(salesOrders).set({ status: next, updatedAt: new Date() }).where(eq(salesOrders.id, orderId));
  await logEvent(tx, ctx, "sales_order", orderId, "status", { from: o.status, to: next, auto: true });
}

/** After a job changes status, update the order it belongs to (piece jobs have none of their own). */
export async function refreshOrderForJob(tx: Tx, ctx: Ctx, jobId: string) {
  const [row] = await tx
    .select({ orderId: salesOrderLines.salesOrderId })
    .from(jobs)
    .innerJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, jobId)));
  if (row) await refreshOrderStatus(tx, ctx, row.orderId);
}

export const shipSchema = z.object({
  lines: z.array(z.object({ lineId: z.uuid(), quantity: z.number().positive().max(1e9) })).min(1).max(500),
  note: z.string().trim().max(500).nullish(),
});

/** Record a delivery: quantities per line (partial deliveries allowed). All shipped → order "shipped". */
export async function shipOrder(db: Db, ctx: Ctx, id: string, input: z.infer<typeof shipSchema>) {
  requireRole(ctx, EDITORS);
  await db.transaction(async (tx) => {
    // Lock the order and its lines so two people shipping at once cannot ship more than ordered.
    const [o] = await tx.select().from(salesOrders).where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.id, id))).for("update");
    if (!o) throw notFound("Sales order");
    if (!OPEN.includes(o.status)) throw conflict(`This order is ${o.status.replace("_", " ")}; it cannot be shipped`);
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id)).for("update");
    const shipped: { lineNo: number; quantity: number }[] = [];
    for (const s of input.lines) {
      const l = lines.find((x) => x.id === s.lineId);
      if (!l) throw badRequest("A line is not on this order");
      const left = Math.round((l.quantity - l.quantityShipped) * 10000) / 10000;
      if (s.quantity > left + 1e-9) throw badRequest(`Line ${l.lineNo}: only ${left} left to ship`);
      await tx.update(salesOrderLines).set({ quantityShipped: sql`${salesOrderLines.quantityShipped} + ${s.quantity}` }).where(eq(salesOrderLines.id, l.id));
      l.quantityShipped += s.quantity;
      shipped.push({ lineNo: l.lineNo, quantity: s.quantity });
    }
    await logEvent(tx, ctx, "sales_order", id, "shipped", { lines: shipped, note: input.note ?? undefined });
    if (lines.every((l) => l.quantityShipped >= l.quantity - 1e-9)) {
      await tx.update(salesOrders).set({ status: "shipped", updatedAt: new Date() }).where(eq(salesOrders.id, id));
      await logEvent(tx, ctx, "sales_order", id, "status", { from: o.status, to: "shipped" });
    }
  });
  return getSalesOrder(db, ctx, id);
}

export const orderStatusSchema = z.object({ status: z.enum(["closed", "cancelled"]) });

/** Close a shipped order, or cancel one that has not shipped (its jobs not yet started are cancelled too). */
export async function setOrderStatus(db: Db, ctx: Ctx, id: string, input: z.infer<typeof orderStatusSchema>) {
  requireRole(ctx, EDITORS);
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(salesOrders).where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.id, id))).for("update");
    if (!o) throw notFound("Sales order");
    const lines = await tx.select().from(salesOrderLines).where(eq(salesOrderLines.salesOrderId, id)).for("update");
    if (input.status === "closed") {
      if (o.status !== "shipped") throw conflict("Ship the order before closing it");
    } else {
      if (!["draft", ...OPEN].includes(o.status)) throw conflict(`A ${o.status} order cannot be cancelled`);
      if (lines.some((l) => l.quantityShipped > 0)) throw conflict("Part of this order has shipped; it cannot be cancelled");
      const top = lines.length ? await tx.select({ id: jobs.id, number: jobs.number, status: jobs.status }).from(jobs).where(inArray(jobs.salesOrderLineId, lines.map((l) => l.id))) : [];
      const started = top.find((j) => j.status === "in_progress");
      if (started) throw conflict(`Job ${started.number} has started; finish or cancel it first`);
      const ids = top.filter((j) => j.status === "planned" || j.status === "released").map((j) => j.id);
      if (ids.length) {
        const kids = await tx.select({ id: jobs.id }).from(jobs).where(and(inArray(jobs.parentJobId, ids), inArray(jobs.status, ["planned", "released"])));
        const all = [...ids, ...kids.map((k) => k.id)];
        await tx.update(jobs).set({ status: "cancelled", updatedAt: new Date() }).where(inArray(jobs.id, all));
        for (const j of all) await logEvent(tx, ctx, "job", j, "status", { to: "cancelled", byOrder: o.number });
      }
    }
    await tx.update(salesOrders).set({ status: input.status, updatedAt: new Date() }).where(eq(salesOrders.id, id));
    await logEvent(tx, ctx, "sales_order", id, "status", { from: o.status, to: input.status });
  });
  return getSalesOrder(db, ctx, id);
}

/** Bring every open order in step with its jobs (run at start-up, so orders finished earlier catch up). */
export async function refreshAllOpenOrders(db: Db) {
  const open = await db.select({ id: salesOrders.id, orgId: salesOrders.orgId, createdBy: salesOrders.createdBy }).from(salesOrders).where(inArray(salesOrders.status, ["confirmed", "in_production"]));
  for (const o of open) {
    await db.transaction((tx) => refreshOrderStatus(tx, { orgId: o.orgId, userId: o.createdBy as string, role: "owner" }, o.id));
  }
}
