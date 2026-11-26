import { and, asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { priceLine, type ConvertQuoteInput, type QuoteInput, type QuoteLineInput } from "@ironline/shared";
import type { Db, Tx } from "../db/client.ts";
import {
  contacts,
  customers,
  items,
  quoteLineMaterials,
  quoteLineOperations,
  quoteLines,
  quotes,
  routingOperations,
  salesOrderLines,
  salesOrders,
  workCenters,
} from "../db/schema.ts";
import { addDays, badRequest, conflict, EDITORS, notFound, requireRole, today, type Ctx } from "../ctx.ts";
import { assertOwned, like, logEvent, nextNumber } from "./common.ts";
import { createJobForOrderLine } from "./jobs.ts";

export const EDITABLE_QUOTE = ["draft", "sent"];

export async function listQuotes(db: Db, ctx: Ctx, opts: { q?: string; status?: string; customerId?: string } = {}) {
  const where = [eq(quotes.orgId, ctx.orgId)];
  if (opts.status) where.push(eq(quotes.status, opts.status));
  if (opts.customerId) where.push(eq(quotes.customerId, opts.customerId));
  if (opts.q) where.push(or(ilike(quotes.number, like(opts.q)), ilike(customers.name, like(opts.q)))!);
  return db
    .select({
      id: quotes.id,
      number: quotes.number,
      revision: quotes.revision,
      status: quotes.status,
      customerId: quotes.customerId,
      customerName: customers.name,
      totalPrice: quotes.totalPrice,
      totalCost: quotes.totalCost,
      validUntil: quotes.validUntil,
      createdAt: quotes.createdAt,
    })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(...where))
    .orderBy(desc(quotes.createdAt))
    .limit(500);
}

export async function getQuote(db: Db | Tx, ctx: Ctx, id: string) {
  const [quote] = await db
    .select({ quote: quotes, customerName: customers.name, customerCode: customers.code })
    .from(quotes)
    .innerJoin(customers, eq(customers.id, quotes.customerId))
    .where(and(eq(quotes.orgId, ctx.orgId), eq(quotes.id, id)));
  if (!quote) throw notFound("Quote");
  const lines = await db
    .select()
    .from(quoteLines)
    .where(and(eq(quoteLines.orgId, ctx.orgId), eq(quoteLines.quoteId, id)))
    .orderBy(asc(quoteLines.lineNo));
  const lineIds = lines.map((l) => l.id);
  const [ops, mats, orders] = await Promise.all([
    lineIds.length
      ? db.select().from(quoteLineOperations).where(inArray(quoteLineOperations.quoteLineId, lineIds)).orderBy(asc(quoteLineOperations.sequence))
      : [],
    lineIds.length
      ? db.select().from(quoteLineMaterials).where(inArray(quoteLineMaterials.quoteLineId, lineIds)).orderBy(asc(quoteLineMaterials.sequence))
      : [],
    db
      .select({ id: salesOrders.id, number: salesOrders.number, status: salesOrders.status })
      .from(salesOrders)
      .where(and(eq(salesOrders.orgId, ctx.orgId), eq(salesOrders.quoteId, id))),
  ]);
  return {
    ...quote.quote,
    customerName: quote.customerName,
    customerCode: quote.customerCode,
    salesOrders: orders,
    lines: lines.map((l) => ({
      ...l,
      operations: ops.filter((o) => o.quoteLineId === l.id),
      materials: mats.filter((m) => m.quoteLineId === l.id),
    })),
  };
}

async function checkRefs(tx: Tx, ctx: Ctx, input: QuoteInput) {
  await assertOwned(tx, customers, [input.customerId], ctx.orgId, "customer");
  if (input.contactId) {
    const [c] = await tx
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.orgId, ctx.orgId), eq(contacts.id, input.contactId), eq(contacts.customerId, input.customerId)));
    if (!c) throw badRequest("The contact does not belong to this customer");
  }
  await assertOwned(tx, items, [...input.lines.map((l) => l.itemId), ...input.lines.flatMap((l) => l.materials.map((m) => m.itemId))], ctx.orgId, "item");
  await assertOwned(tx, workCenters, input.lines.flatMap((l) => l.operations.map((o) => o.workCenterId)), ctx.orgId, "work center");
}

/** Price every line with the shared formula and write lines, operations and materials. */
async function writeLines(tx: Tx, ctx: Ctx, quoteId: string, lines: QuoteLineInput[]) {
  const wcRows = await tx.select({ id: workCenters.id, rate: workCenters.hourlyRate }).from(workCenters).where(eq(workCenters.orgId, ctx.orgId));
  const wcRate = new Map(wcRows.map((w) => [w.id, w.rate]));
  let totalPrice = 0;
  let totalCost = 0;
  for (const [i, line] of lines.entries()) {
    const ops = line.operations.map((o) => ({ ...o, rate: o.rate ?? (o.workCenterId ? wcRate.get(o.workCenterId) : 0) ?? 0 }));
    const priced = priceLine({ ...line, operations: ops, materials: line.materials });
    const [row] = await tx
      .insert(quoteLines)
      .values({
        orgId: ctx.orgId,
        quoteId,
        lineNo: i + 1,
        itemId: line.itemId ?? null,
        description: line.description,
        quantity: line.quantity,
        markupPct: line.markupPct,
        unitPriceOverride: line.unitPriceOverride ?? null,
        packagingPerUnit: line.packagingPerUnit,
        unitCost: priced.unitCost,
        unitPrice: priced.unitPrice,
        totalPrice: priced.totalPrice,
        totalCost: priced.totalCost,
        totalHours: priced.totalHours,
      })
      .returning({ id: quoteLines.id });
    if (ops.length) {
      await tx.insert(quoteLineOperations).values(
        ops.map((o, j) => ({
          orgId: ctx.orgId,
          quoteLineId: row!.id,
          sequence: (j + 1) * 10,
          workCenterId: o.workCenterId ?? null,
          description: o.description ?? null,
          setupHours: o.setupHours,
          runHoursPerUnit: o.runHoursPerUnit,
          rate: o.rate,
          cost: priced.operationCosts[j]!,
        })),
      );
    }
    if (line.materials.length) {
      await tx.insert(quoteLineMaterials).values(
        line.materials.map((m, j) => ({
          ...m,
          itemId: m.itemId ?? null,
          orgId: ctx.orgId,
          quoteLineId: row!.id,
          sequence: (j + 1) * 10,
          cost: priced.materialCosts[j]!,
        })),
      );
    }
    totalPrice += priced.totalPrice;
    totalCost += priced.totalCost;
  }
  return { totalPrice: Math.round(totalPrice * 100) / 100, totalCost: Math.round(totalCost * 10000) / 10000 };
}

export async function createQuote(db: Db, ctx: Ctx, input: QuoteInput) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    await checkRefs(tx, ctx, input);
    const number = await nextNumber(tx, ctx.orgId, "quote");
    const { lines, ...header } = input;
    const [row] = await tx
      .insert(quotes)
      .values({
        ...header,
        orgId: ctx.orgId,
        number,
        validUntil: header.validUntil ?? addDays(today(), 30),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
      .returning();
    const totals = await writeLines(tx, ctx, row!.id, lines);
    await tx.update(quotes).set(totals).where(eq(quotes.id, row!.id));
    await logEvent(tx, ctx, "quote", row!.id, "created", { number });
    return getQuote(tx, ctx, row!.id);
  });
}

export async function updateQuote(db: Db, ctx: Ctx, id: string, input: QuoteInput) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(quotes).where(and(eq(quotes.orgId, ctx.orgId), eq(quotes.id, id))).for("update");
    if (!existing) throw notFound("Quote");
    if (!EDITABLE_QUOTE.includes(existing.status)) throw conflict(`A ${existing.status} quote cannot be edited`);
    await checkRefs(tx, ctx, input);
    const { lines, ...header } = input;
    await tx.delete(quoteLines).where(eq(quoteLines.quoteId, id));
    const totals = await writeLines(tx, ctx, id, lines);
    await tx
      .update(quotes)
      .set({ ...header, validUntil: header.validUntil ?? existing.validUntil, ...totals, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(eq(quotes.id, id));
    await logEvent(tx, ctx, "quote", id, "updated");
    return getQuote(tx, ctx, id);
  });
}

const TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  send: { from: ["draft"], to: "sent" },
  reopen: { from: ["sent", "lost", "expired"], to: "draft" },
  lose: { from: ["draft", "sent"], to: "lost" },
  cancel: { from: ["draft", "sent"], to: "cancelled" },
};
export type QuoteAction = keyof typeof TRANSITIONS;

export async function changeQuoteStatus(db: Db, ctx: Ctx, id: string, action: QuoteAction) {
  requireRole(ctx, EDITORS);
  const t = TRANSITIONS[action];
  if (!t) throw badRequest(`Unknown action ${action}`);
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.orgId, ctx.orgId), eq(quotes.id, id))).for("update");
    if (!q) throw notFound("Quote");
    if (!t.from.includes(q.status)) throw conflict(`Cannot ${action} a ${q.status} quote`);
    if (action === "send") {
      const [line] = await tx.select({ id: quoteLines.id }).from(quoteLines).where(eq(quoteLines.quoteId, id)).limit(1);
      if (!line) throw badRequest("Add at least one line before sending the quote");
    }
    await tx
      .update(quotes)
      .set({
        status: t.to,
        updatedAt: new Date(),
        updatedBy: ctx.userId,
        ...(action === "send" ? { sentAt: new Date() } : {}),
        ...(action === "lose" || action === "cancel" ? { decidedAt: new Date() } : {}),
      })
      .where(eq(quotes.id, id));
    await logEvent(tx, ctx, "quote", id, action, { from: q.status, to: t.to });
    return getQuote(tx, ctx, id);
  });
}

/** Customer accepted: mark the quote won and create a sales order (and jobs). */
export async function convertQuote(db: Db, ctx: Ctx, id: string, input: ConvertQuoteInput) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.orgId, ctx.orgId), eq(quotes.id, id))).for("update");
    if (!q) throw notFound("Quote");
    if (!EDITABLE_QUOTE.includes(q.status)) throw conflict(`A ${q.status} quote cannot be converted`);
    const allLines = await tx.select().from(quoteLines).where(eq(quoteLines.quoteId, id)).orderBy(asc(quoteLines.lineNo));
    const chosen = input.lineIds.length ? allLines.filter((l) => input.lineIds.includes(l.id)) : allLines;
    if (!chosen.length || chosen.length !== (input.lineIds.length || allLines.length)) {
      throw badRequest("Choose at least one line of this quote");
    }
    // Every ordered line becomes a real part, so its routing, drawings and 3D model follow
    // it to the job and can be reordered later.
    for (const l of chosen) {
      if (l.itemId) continue;
      const partNumber = `${q.number}-${l.lineNo}`;
      const [part] = await tx
        .insert(items)
        .values({ orgId: ctx.orgId, partNumber, description: l.description, type: "manufactured", salePrice: l.unitPrice, createdBy: ctx.userId, updatedBy: ctx.userId })
        .onConflictDoNothing()
        .returning({ id: items.id });
      const itemId = part?.id ?? (await tx.select({ id: items.id }).from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.partNumber, partNumber), eq(items.revision, "A"))))[0]!.id;
      if (part) {
        const ops = await tx.select().from(quoteLineOperations).where(eq(quoteLineOperations.quoteLineId, l.id)).orderBy(asc(quoteLineOperations.sequence));
        const routable = ops.filter((o) => o.workCenterId);
        if (routable.length) {
          await tx.insert(routingOperations).values(
            routable.map((o, i) => ({ orgId: ctx.orgId, itemId, sequence: (i + 1) * 10, workCenterId: o.workCenterId!, description: o.description, setupHours: o.setupHours, runHoursPerUnit: o.runHoursPerUnit })),
          );
        }
        await logEvent(tx, ctx, "item", itemId, "created", { partNumber, fromQuote: q.number });
      }
      await tx.update(quoteLines).set({ itemId }).where(eq(quoteLines.id, l.id));
      l.itemId = itemId;
    }
    const [customer] = await tx.select().from(customers).where(eq(customers.id, q.customerId));
    const dueDate = input.dueDate ?? addDays(today(), q.leadTimeDays);
    const number = await nextNumber(tx, ctx.orgId, "sales_order");
    const totalPrice = Math.round(chosen.reduce((a, l) => a + l.totalPrice, 0) * 100) / 100;
    const [order] = await tx
      .insert(salesOrders)
      .values({
        orgId: ctx.orgId,
        number,
        customerId: q.customerId,
        quoteId: q.id,
        customerPo: input.customerPo ?? null,
        status: "confirmed",
        shipTo: customer?.shippingAddress ?? {},
        totalPrice,
        createdBy: ctx.userId,
      })
      .returning();
    const orderLines = await tx
      .insert(salesOrderLines)
      .values(
        chosen.map((l, i) => ({
          orgId: ctx.orgId,
          salesOrderId: order!.id,
          lineNo: i + 1,
          quoteLineId: l.id,
          itemId: l.itemId,
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          dueDate,
        })),
      )
      .returning();
    await tx.update(quotes).set({ status: "won", decidedAt: new Date(), updatedAt: new Date(), updatedBy: ctx.userId }).where(eq(quotes.id, id));
    await logEvent(tx, ctx, "quote", id, "won", { salesOrder: number });
    await logEvent(tx, ctx, "sales_order", order!.id, "created", { number, fromQuote: q.number });
    if (input.createJobs) {
      for (const line of orderLines) await createJobForOrderLine(tx, ctx, line.id);
    }
    return order!;
  });
}
