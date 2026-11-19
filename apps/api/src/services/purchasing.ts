/**
 * Purchasing: vendors, which vendor sells which item, the buying plan, purchase orders and
 * receiving them into stock (through inventory's receiveStock, so every receipt is a lot).
 */
import { addDaysIso, planItem, type PlanEvent } from "@ironline/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db/client.ts";
import { items, itemVendors, purchaseOrderLines, purchaseOrders, stockLots, users, vendors } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, today, type Ctx } from "../ctx.ts";
import { assertOwned, logEvent, nextNumber } from "./common.ts";
import { demandRows, receiveStock } from "./inventory.ts";

const BUYERS = [...EDITORS, "purchasing" as const];
const RECEIVERS = [...BUYERS, "quality" as const, "operator" as const];
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const OPEN_PO = ["draft", "sent", "partial"];

// ── Vendors ─────────────────────────────────────────────────────────────────

const addressSchema = z
  .object({ line1: z.string().max(200).nullish(), line2: z.string().max(200).nullish(), city: z.string().max(100).nullish(), region: z.string().max(100).nullish(), postalCode: z.string().max(30).nullish(), country: z.string().max(60).nullish() })
  .default({});
export const vendorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.email().nullish().or(z.literal("").transform(() => null)),
  phone: z.string().trim().max(40).nullish(),
  address: addressSchema,
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  notes: z.string().trim().max(2000).nullish(),
  active: z.boolean().default(true),
});

export async function listVendors(db: Db, ctx: Ctx) {
  return db
    .select({
      id: vendors.id,
      name: vendors.name,
      email: vendors.email,
      phone: vendors.phone,
      address: vendors.address,
      paymentTermsDays: vendors.paymentTermsDays,
      active: vendors.active,
      items: sql<number>`(select count(*)::int from item_vendors iv where iv.vendor_id = ${vendors.id})`,
      openOrders: sql<number>`(select count(*)::int from purchase_orders p where p.vendor_id = ${vendors.id} and p.status in ('draft', 'sent', 'partial'))`,
      openValue: sql<number>`(select coalesce(sum(p.total), 0)::float from purchase_orders p where p.vendor_id = ${vendors.id} and p.status in ('draft', 'sent', 'partial'))`,
    })
    .from(vendors)
    .where(eq(vendors.orgId, ctx.orgId))
    .orderBy(asc(vendors.name));
}

export async function saveVendor(db: Db, ctx: Ctx, input: z.infer<typeof vendorSchema>, id?: string) {
  requireRole(ctx, BUYERS);
  const [clash] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.name, input.name)));
  if (clash && clash.id !== id) throw conflict(`A vendor called ${input.name} already exists`);
  const values = { ...input, email: input.email ?? null, phone: input.phone ?? null, notes: input.notes ?? null };
  if (id) {
    const [row] = await db.update(vendors).set(values).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, id))).returning();
    if (!row) throw notFound("Vendor");
    return row;
  }
  const [row] = await db.insert(vendors).values({ ...values, orgId: ctx.orgId }).returning();
  return row!;
}

export async function getVendor(db: Db, ctx: Ctx, id: string) {
  const [v] = await db.select().from(vendors).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, id)));
  if (!v) throw notFound("Vendor");
  const [supplies, orders] = await Promise.all([
    db
      .select({ itemId: items.id, partNumber: items.partNumber, description: items.description, uom: items.uom, isPrimary: itemVendors.isPrimary, leadDays: itemVendors.leadDays, unitCost: itemVendors.unitCost, minOrder: itemVendors.minOrder, vendorPartNumber: itemVendors.vendorPartNumber })
      .from(itemVendors)
      .innerJoin(items, eq(items.id, itemVendors.itemId))
      .where(eq(itemVendors.vendorId, id))
      .orderBy(asc(items.partNumber)),
    listOrders(db, ctx, { vendorId: id }),
  ]);
  return { ...v, supplies, orders };
}

// ── Item vendors ────────────────────────────────────────────────────────────

export const itemVendorsSchema = z.object({
  vendors: z
    .array(
      z.object({
        vendorId: z.uuid(),
        isPrimary: z.boolean().default(false),
        leadDays: z.number().int().min(0).max(730),
        unitCost: z.number().min(0).max(1e9),
        minOrder: z.number().min(0).max(1e9).nullish(),
        vendorPartNumber: z.string().trim().max(80).nullish(),
      }),
    )
    .max(50)
    .refine((v) => new Set(v.map((x) => x.vendorId)).size === v.length, { message: "A vendor is listed twice" })
    .refine((v) => v.length === 0 || v.filter((x) => x.isPrimary).length === 1, { message: "Mark exactly one vendor as primary" }),
});

export async function getItemVendors(db: Db | Tx, ctx: Ctx, itemId: string) {
  return db
    .select({ vendorId: vendors.id, name: vendors.name, city: sql<string | null>`${vendors.address}->>'city'`, isPrimary: itemVendors.isPrimary, leadDays: itemVendors.leadDays, unitCost: itemVendors.unitCost, minOrder: itemVendors.minOrder, vendorPartNumber: itemVendors.vendorPartNumber })
    .from(itemVendors)
    .innerJoin(vendors, eq(vendors.id, itemVendors.vendorId))
    .where(and(eq(itemVendors.orgId, ctx.orgId), eq(itemVendors.itemId, itemId)))
    .orderBy(desc(itemVendors.isPrimary), asc(itemVendors.leadDays));
}

export async function setItemVendors(db: Db, ctx: Ctx, itemId: string, input: z.infer<typeof itemVendorsSchema>) {
  requireRole(ctx, BUYERS);
  return db.transaction(async (tx) => {
    await assertOwned(tx, items, [itemId], ctx.orgId, "item");
    await assertOwned(tx, vendors, input.vendors.map((v) => v.vendorId), ctx.orgId, "vendor");
    await tx.delete(itemVendors).where(and(eq(itemVendors.orgId, ctx.orgId), eq(itemVendors.itemId, itemId)));
    if (input.vendors.length) await tx.insert(itemVendors).values(input.vendors.map((v) => ({ ...v, minOrder: v.minOrder ?? null, vendorPartNumber: v.vendorPartNumber ?? null, orgId: ctx.orgId, itemId })));
    return getItemVendors(tx, ctx, itemId);
  });
}

// ── Plan ────────────────────────────────────────────────────────────────────

/** Open purchase order lines still to arrive, with their PO, for the given items. */
async function incomingRows(db: Db | Tx, ctx: Ctx, itemIds?: string[]) {
  const rows = await db
    .select({
      itemId: purchaseOrderLines.itemId,
      poId: purchaseOrders.id,
      poNumber: purchaseOrders.number,
      status: purchaseOrders.status,
      vendor: vendors.name,
      dueDate: purchaseOrderLines.dueDate,
      quantity: purchaseOrderLines.quantity,
      received: purchaseOrderLines.quantityReceived,
    })
    .from(purchaseOrderLines)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseOrderLines.purchaseOrderId))
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(and(eq(purchaseOrderLines.orgId, ctx.orgId), inArray(purchaseOrders.status, OPEN_PO), itemIds ? inArray(purchaseOrderLines.itemId, itemIds.length ? itemIds : ["00000000-0000-0000-0000-000000000000"]) : undefined));
  return rows.map((r) => ({ ...r, itemId: r.itemId!, remaining: r4(Math.max(0, r.quantity - r.received)) })).filter((r) => r.itemId && r.remaining > 0);
}

/**
 * The buying plan for every bought item and raw material: what to buy, from whom, by when.
 * Drafts count as incoming (so a planned order is not recommended twice) and are named.
 */
export async function plan(db: Db, ctx: Ctx, opts: { endDate?: string } = {}) {
  const now = today();
  const endDate = opts.endDate ?? addDaysIso(now, 90);
  const list = await db
    .select({ id: items.id, partNumber: items.partNumber, description: items.description, type: items.type, uom: items.uom, unitCost: items.unitCost, reorderPoint: items.reorderPoint, reorderQuantity: items.reorderQuantity })
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), eq(items.active, true), inArray(items.type, ["material", "purchased"])))
    .orderBy(asc(items.partNumber));
  const ids = list.map((i) => i.id);
  const [stock, demand, incoming, sellers] = await Promise.all([
    ids.length
      ? db.select({ itemId: stockLots.itemId, qty: sql<number>`sum(${stockLots.quantity})::float` }).from(stockLots).where(and(eq(stockLots.orgId, ctx.orgId), inArray(stockLots.itemId, ids))).groupBy(stockLots.itemId)
      : [],
    demandRows(db, ctx, { itemIds: ids }),
    incomingRows(db, ctx, ids),
    ids.length
      ? db
          .select({ itemId: itemVendors.itemId, vendorId: vendors.id, name: vendors.name, isPrimary: itemVendors.isPrimary, leadDays: itemVendors.leadDays, unitCost: itemVendors.unitCost, minOrder: itemVendors.minOrder })
          .from(itemVendors)
          .innerJoin(vendors, eq(vendors.id, itemVendors.vendorId))
          .where(and(eq(itemVendors.orgId, ctx.orgId), inArray(itemVendors.itemId, ids), eq(vendors.active, true)))
      : [],
  ]);
  const rows = list.map((i) => {
    const vendor = sellers.find((s) => s.itemId === i.id && s.isPrimary) ?? sellers.find((s) => s.itemId === i.id) ?? null;
    const dem = demand.filter((d) => d.itemId === i.id);
    const inc = incoming.filter((x) => x.itemId === i.id);
    const onHand = stock.find((s) => s.itemId === i.id)?.qty ?? 0;
    const r = planItem({
      today: now,
      endDate,
      onHand,
      minOnHand: i.reorderPoint,
      demand: dem.map<PlanEvent>((d) => ({ date: d.dueDate, quantity: d.remaining, priority: d.priority, label: d.jobNumber })),
      incoming: inc.map<PlanEvent>((x) => ({ date: x.dueDate, quantity: x.remaining, label: x.poNumber })),
      leadDays: vendor?.leadDays ?? null,
      minOrder: vendor?.minOrder ?? i.reorderQuantity,
    });
    const unitCost = vendor?.unitCost ?? i.unitCost;
    const { timeline: _t, ...result } = r;
    return {
      ...i,
      onHand,
      vendor,
      vendorCount: sellers.filter((s) => s.itemId === i.id).length,
      unitCost,
      ...result,
      totalCost: r4(r.toBuy * unitCost),
      jobs: dem.length,
      drafts: inc.filter((x) => x.status === "draft").map((x) => ({ poId: x.poId, poNumber: x.poNumber })),
      bucket: r.toBuy > 0 ? (r.late ? "late" : r.urgent ? "urgent" : "buy") : "ok",
    };
  });
  const sum = (f: (x: (typeof rows)[number]) => boolean) => ({ count: rows.filter(f).length, value: r4(rows.filter(f).reduce((a, x) => a + x.totalCost, 0)) });
  return {
    endDate,
    rows,
    summary: { buy: sum((x) => x.toBuy > 0), late: sum((x) => x.toBuy > 0 && x.late), urgent: sum((x) => x.toBuy > 0 && x.urgent), ok: sum((x) => x.toBuy === 0) },
  };
}

/** One item's plan in detail: vendors, the dated demand and incoming, and the running balance. */
export async function planDetail(db: Db, ctx: Ctx, itemId: string, opts: { endDate?: string } = {}) {
  const now = today();
  const endDate = opts.endDate ?? addDaysIso(now, 90);
  const [item] = await db.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId)));
  if (!item) throw notFound("Item");
  const [sellers, dem, inc, stock] = await Promise.all([
    getItemVendors(db, ctx, itemId),
    demandRows(db, ctx, { itemIds: [itemId] }),
    incomingRows(db, ctx, [itemId]),
    db.select({ qty: sql<number>`coalesce(sum(${stockLots.quantity}), 0)::float` }).from(stockLots).where(eq(stockLots.itemId, itemId)),
  ]);
  const vendor = sellers.find((s) => s.isPrimary) ?? sellers[0] ?? null;
  const r = planItem({
    today: now,
    endDate,
    onHand: stock[0]?.qty ?? 0,
    minOnHand: item.reorderPoint,
    demand: dem.map((d) => ({ date: d.dueDate, quantity: d.remaining, priority: d.priority, label: d.jobNumber })),
    incoming: inc.map((x) => ({ date: x.dueDate, quantity: x.remaining, label: x.poNumber })),
    leadDays: vendor?.leadDays ?? null,
    minOrder: vendor?.minOrder ?? item.reorderQuantity,
  });
  return {
    item: { id: item.id, partNumber: item.partNumber, description: item.description, uom: item.uom, reorderPoint: item.reorderPoint },
    onHand: stock[0]?.qty ?? 0,
    vendors: sellers,
    ...r,
    demandTotal: r.demand,
    incomingTotal: r.incoming,
    demand: dem.map(({ itemId: _i, ...d }) => d),
    incoming: inc.map(({ itemId: _i, ...x }) => x),
  };
}

// ── Purchase orders ─────────────────────────────────────────────────────────

const lineSchema = z.object({
  itemId: z.uuid().nullish(),
  description: z.string().trim().max(300).nullish(),
  quantity: z.number().positive().max(1e9),
  unitCost: z.number().min(0).max(1e9),
  dueDate: z.iso.date().nullish(),
});
export const poSchema = z.object({
  vendorId: z.uuid(),
  notes: z.string().trim().max(2000).nullish(),
  lines: z.array(lineSchema).min(1).max(300),
});

async function writeLines(tx: Tx, ctx: Ctx, poId: string, lines: z.infer<typeof lineSchema>[]) {
  await assertOwned(tx, items, lines.map((l) => l.itemId), ctx.orgId, "item");
  const known = lines.some((l) => l.itemId) ? await tx.select({ id: items.id, partNumber: items.partNumber, description: items.description }).from(items).where(inArray(items.id, lines.map((l) => l.itemId).filter((v): v is string => !!v))) : [];
  await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, poId));
  await tx.insert(purchaseOrderLines).values(
    lines.map((l, i) => {
      const it = known.find((k) => k.id === l.itemId);
      if (!it && !l.description) throw badRequest(`Line ${i + 1} needs an item or a description`);
      return { orgId: ctx.orgId, purchaseOrderId: poId, sequence: (i + 1) * 10, itemId: l.itemId ?? null, description: l.description || `${it!.partNumber} ${it!.description}`, quantity: r4(l.quantity), unitCost: l.unitCost, dueDate: l.dueDate ?? null };
    }),
  );
  const total = r4(lines.reduce((a, l) => a + l.quantity * l.unitCost, 0));
  await tx.update(purchaseOrders).set({ total, updatedAt: new Date() }).where(eq(purchaseOrders.id, poId));
}

export async function createOrder(db: Db, ctx: Ctx, input: z.infer<typeof poSchema>) {
  requireRole(ctx, BUYERS);
  const id = await db.transaction(async (tx) => {
    await assertOwned(tx, vendors, [input.vendorId], ctx.orgId, "vendor");
    const number = await nextNumber(tx, ctx.orgId, "purchase_order");
    const [po] = await tx.insert(purchaseOrders).values({ orgId: ctx.orgId, number, vendorId: input.vendorId, notes: input.notes ?? null, createdBy: ctx.userId }).returning();
    await writeLines(tx, ctx, po!.id, input.lines);
    await logEvent(tx, ctx, "purchase_order", po!.id, "created", { number });
    return po!.id;
  });
  return getOrder(db, ctx, id);
}

export async function updateOrder(db: Db, ctx: Ctx, id: string, input: z.infer<typeof poSchema>) {
  requireRole(ctx, BUYERS);
  await db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.id, id))).for("update");
    if (!po) throw notFound("Purchase order");
    if (po.status !== "draft") throw conflict("Only a draft purchase order can be edited");
    await assertOwned(tx, vendors, [input.vendorId], ctx.orgId, "vendor");
    await tx.update(purchaseOrders).set({ vendorId: input.vendorId, notes: input.notes ?? null }).where(eq(purchaseOrders.id, id));
    await writeLines(tx, ctx, id, input.lines);
  });
  return getOrder(db, ctx, id);
}

export async function listOrders(db: Db, ctx: Ctx, opts: { status?: string; vendorId?: string } = {}) {
  return db
    .select({
      id: purchaseOrders.id,
      number: purchaseOrders.number,
      status: purchaseOrders.status,
      vendorId: vendors.id,
      vendorName: vendors.name,
      orderDate: purchaseOrders.orderDate,
      total: purchaseOrders.total,
      createdAt: purchaseOrders.createdAt,
      lines: sql<number>`(select count(*)::int from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id})`,
      dueDate: sql<string | null>`(select min(l.due_date)::text from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id} and l.quantity_received < l.quantity)`,
      receivedPct: sql<number>`(select coalesce(round(100 * sum(least(l.quantity_received, l.quantity)) / nullif(sum(l.quantity), 0)), 0)::int from purchase_order_lines l where l.purchase_order_id = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .where(and(eq(purchaseOrders.orgId, ctx.orgId), opts.status === "open" ? inArray(purchaseOrders.status, OPEN_PO) : opts.status ? eq(purchaseOrders.status, opts.status) : undefined, opts.vendorId ? eq(purchaseOrders.vendorId, opts.vendorId) : undefined))
    .orderBy(desc(purchaseOrders.number))
    .limit(300);
}

export async function getOrder(db: Db | Tx, ctx: Ctx, id: string) {
  const [po] = await db
    .select({ po: purchaseOrders, vendor: vendors, createdByName: users.name })
    .from(purchaseOrders)
    .innerJoin(vendors, eq(vendors.id, purchaseOrders.vendorId))
    .leftJoin(users, eq(users.id, purchaseOrders.createdBy))
    .where(and(eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.id, id)));
  if (!po) throw notFound("Purchase order");
  const lines = await db
    .select({ id: purchaseOrderLines.id, sequence: purchaseOrderLines.sequence, itemId: purchaseOrderLines.itemId, partNumber: items.partNumber, uom: items.uom, description: purchaseOrderLines.description, quantity: purchaseOrderLines.quantity, unitCost: purchaseOrderLines.unitCost, dueDate: purchaseOrderLines.dueDate, quantityReceived: purchaseOrderLines.quantityReceived })
    .from(purchaseOrderLines)
    .leftJoin(items, eq(items.id, purchaseOrderLines.itemId))
    .where(eq(purchaseOrderLines.purchaseOrderId, id))
    .orderBy(asc(purchaseOrderLines.sequence));
  const receipts = await db.execute<{ id: string; line_id: string; lot_number: string; quantity: number; location: string; created_at: string; user_name: string | null }>(sql`
    select t.id, t.source_id as line_id, l.lot_number, t.quantity::float, loc.code as location, t.created_at::text, u.name as user_name
    from stock_transactions t join stock_lots l on l.id = t.lot_id join stock_locations loc on loc.id = l.location_id left join users u on u.id = t.user_id
    where t.org_id = ${ctx.orgId} and t.source_type = 'purchase_order' and t.source_id in (select id from purchase_order_lines where purchase_order_id = ${id})
    order by t.created_at`);
  return { ...po.po, vendor: po.vendor, createdByName: po.createdByName, lines, receipts: receipts.rows };
}

export const statusSchema = z.object({ status: z.enum(["sent", "cancelled", "draft"]) });

export async function setOrderStatus(db: Db, ctx: Ctx, id: string, input: z.infer<typeof statusSchema>) {
  requireRole(ctx, BUYERS);
  await db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.id, id))).for("update");
    if (!po) throw notFound("Purchase order");
    const [rec] = await tx.select({ n: sql<number>`coalesce(sum(${purchaseOrderLines.quantityReceived}), 0)::float` }).from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
    const anyReceived = (rec?.n ?? 0) > 0;
    const ok =
      (input.status === "sent" && po.status === "draft") ||
      (input.status === "draft" && po.status === "sent" && !anyReceived) ||
      (input.status === "cancelled" && ["draft", "sent"].includes(po.status) && !anyReceived);
    if (!ok) throw conflict(input.status === "cancelled" && anyReceived ? "Part of this order has been received, so it cannot be cancelled" : `A ${po.status} order cannot be marked ${input.status}`);
    await tx
      .update(purchaseOrders)
      .set({ status: input.status, orderDate: input.status === "sent" ? (po.orderDate ?? today()) : po.orderDate, updatedAt: new Date() })
      .where(eq(purchaseOrders.id, id));
    await logEvent(tx, ctx, "purchase_order", id, "status", { from: po.status, to: input.status });
  });
  return getOrder(db, ctx, id);
}

export const receiveSchema = z.object({
  lines: z
    .array(
      z.object({
        lineId: z.uuid(),
        quantity: z.number().positive().max(1e9),
        locationId: z.uuid().nullish(),
        heatNumber: z.string().trim().max(60).nullish(),
        dimensions: z.string().trim().max(60).nullish(),
      }),
    )
    .min(1)
    .max(300),
});

/**
 * Receive some or all of a sent order. Each catalogue line becomes a new lot at the line's cost
 * with the vendor as supplier. Receiving more than ordered is refused (raise the order first).
 */
export async function receiveOrder(db: Db, ctx: Ctx, id: string, input: z.infer<typeof receiveSchema>) {
  requireRole(ctx, RECEIVERS);
  await db.transaction(async (tx) => {
    const [po] = await tx.select().from(purchaseOrders).where(and(eq(purchaseOrders.orgId, ctx.orgId), eq(purchaseOrders.id, id))).for("update");
    if (!po) throw notFound("Purchase order");
    if (!["sent", "partial"].includes(po.status)) throw conflict(po.status === "draft" ? "Mark the order as sent before receiving it" : `A ${po.status} order cannot be received`);
    const [vendor] = await tx.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, po.vendorId));
    const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id)).for("update");
    for (const r of input.lines) {
      const line = lines.find((l) => l.id === r.lineId);
      if (!line) throw badRequest("A received line is not on this order");
      const left = r4(line.quantity - line.quantityReceived);
      if (r.quantity > left + 1e-9) throw badRequest(`${line.description}: only ${left} left to receive`);
      if (line.itemId) {
        await receiveStock(tx, ctx, {
          itemId: line.itemId,
          locationId: r.locationId ?? null,
          quantity: r.quantity,
          unitCost: line.unitCost,
          supplier: vendor!.name,
          heatNumber: r.heatNumber ?? null,
          dimensions: r.dimensions ?? null,
          note: `${po.number}`,
          sourceType: "purchase_order",
          sourceId: line.id,
        });
      }
      line.quantityReceived = r4(line.quantityReceived + r.quantity);
      await tx.update(purchaseOrderLines).set({ quantityReceived: line.quantityReceived }).where(eq(purchaseOrderLines.id, line.id));
    }
    const done = lines.every((l) => l.quantityReceived >= l.quantity - 1e-9);
    await tx.update(purchaseOrders).set({ status: done ? "received" : "partial", updatedAt: new Date() }).where(eq(purchaseOrders.id, id));
    await logEvent(tx, ctx, "purchase_order", id, "received", { lines: input.lines.length, complete: done });
  });
  return getOrder(db, ctx, id);
}
