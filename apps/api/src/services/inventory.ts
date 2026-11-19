/**
 * Inventory: stock locations, lots and the stock ledger.
 *
 * Every change to stock is a row in stock_transactions (signed quantity, valued at the lot's
 * cost). A lot's quantity is a cache of its ledger rows, updated in the same database
 * transaction. Picking material for a job draws from lots oldest first (FIFO); anything picked
 * beyond the stock on hand is recorded as untracked so the floor is never blocked.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db/client.ts";
import { attachments, items, jobMaterials, jobs, stockLocations, stockLots, stockTransactions, users } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { assertOwned, logEvent, nextNumber } from "./common.ts";

const STOCK_ROLES = [...EDITORS, "purchasing" as const, "quality" as const];
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const OPEN_JOBS = ["planned", "released", "in_progress"];

// ── Locations ───────────────────────────────────────────────────────────────

export const locationSchema = z.object({
  code: z.string().trim().min(1).max(24),
  name: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
});

export async function listLocations(db: Db, ctx: Ctx) {
  return db
    .select({
      id: stockLocations.id,
      code: stockLocations.code,
      name: stockLocations.name,
      active: stockLocations.active,
      lots: sql<number>`(select count(*)::int from stock_lots l where l.location_id = ${stockLocations.id} and l.quantity > 0)`,
      value: sql<number>`(select coalesce(sum(l.quantity * l.unit_cost), 0)::float from stock_lots l where l.location_id = ${stockLocations.id})`,
    })
    .from(stockLocations)
    .where(eq(stockLocations.orgId, ctx.orgId))
    .orderBy(asc(stockLocations.code));
}

export async function saveLocation(db: Db, ctx: Ctx, input: z.infer<typeof locationSchema>, id?: string) {
  requireRole(ctx, STOCK_ROLES);
  const [clash] = await db.select({ id: stockLocations.id }).from(stockLocations).where(and(eq(stockLocations.orgId, ctx.orgId), eq(stockLocations.code, input.code)));
  if (clash && clash.id !== id) throw conflict(`Location ${input.code} already exists`);
  if (id) {
    const [row] = await db.update(stockLocations).set(input).where(and(eq(stockLocations.orgId, ctx.orgId), eq(stockLocations.id, id))).returning();
    if (!row) throw notFound("Location");
    return row;
  }
  const [row] = await db.insert(stockLocations).values({ ...input, orgId: ctx.orgId }).returning();
  return row!;
}

/** The shop's first location, made on first use so receiving works out of the box. */
async function defaultLocation(tx: Tx, ctx: Ctx) {
  const [first] = await tx.select().from(stockLocations).where(and(eq(stockLocations.orgId, ctx.orgId), eq(stockLocations.active, true))).orderBy(asc(stockLocations.code)).limit(1);
  if (first) return first.id;
  const [row] = await tx.insert(stockLocations).values({ orgId: ctx.orgId, code: "MAIN", name: "Main stores" }).onConflictDoNothing().returning();
  if (row) return row.id;
  const [again] = await tx.select().from(stockLocations).where(and(eq(stockLocations.orgId, ctx.orgId), eq(stockLocations.code, "MAIN")));
  return again!.id;
}

// ── Ledger helpers ──────────────────────────────────────────────────────────

type TxRow = typeof stockTransactions.$inferInsert;
async function post(tx: Tx, ctx: Ctx, row: Omit<TxRow, "orgId" | "userId" | "value"> & { value?: number }) {
  await tx.insert(stockTransactions).values({ ...row, value: row.value ?? r4(row.quantity * (row.unitCost ?? 0)), orgId: ctx.orgId, userId: ctx.userId });
}

async function bumpLot(tx: Tx, lotId: string, delta: number) {
  const res = await tx.execute<{ quantity: number }>(sql`update stock_lots set quantity = round((quantity + ${delta})::numeric, 4) where id = ${lotId} returning quantity::float`);
  const q = res.rows[0]?.quantity;
  if (q == null) throw notFound("Lot");
  if (q < 0) throw badRequest("That would take the lot below zero");
}

// ── Receiving (also used by Purchasing) ─────────────────────────────────────

export const receiveSchema = z.object({
  itemId: z.uuid(),
  locationId: z.uuid().nullable().optional(),
  quantity: z.number().positive().max(1e9),
  unitCost: z.number().min(0).max(1e9),
  dimensions: z.string().trim().max(60).nullable().optional(),
  heatNumber: z.string().trim().max(60).nullable().optional(),
  supplier: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
});
export type ReceiveInput = z.infer<typeof receiveSchema> & { sourceType?: string; sourceId?: string };

/** Put stock into a new lot. Purchasing calls this with sourceType "purchase_order". */
export async function receiveStock(tx: Tx, ctx: Ctx, input: ReceiveInput) {
  await assertOwned(tx, items, [input.itemId], ctx.orgId, "item");
  await assertOwned(tx, stockLocations, [input.locationId], ctx.orgId, "location");
  // No location given: where this item's latest lot is kept, else the shop's first location.
  const [usual] = input.locationId
    ? []
    : await tx.select({ id: stockLots.locationId }).from(stockLots).innerJoin(stockLocations, eq(stockLocations.id, stockLots.locationId)).where(and(eq(stockLots.orgId, ctx.orgId), eq(stockLots.itemId, input.itemId), eq(stockLocations.active, true))).orderBy(desc(stockLots.receivedAt)).limit(1);
  const locationId = input.locationId ?? usual?.id ?? (await defaultLocation(tx, ctx));
  const lotNumber = await nextNumber(tx, ctx.orgId, "lot");
  const [lot] = await tx
    .insert(stockLots)
    .values({
      orgId: ctx.orgId,
      itemId: input.itemId,
      locationId,
      lotNumber,
      dimensions: input.dimensions || null,
      heatNumber: input.heatNumber || null,
      supplier: input.supplier || null,
      quantity: r4(input.quantity),
      unitCost: input.unitCost,
      createdBy: ctx.userId,
    })
    .returning();
  await post(tx, ctx, { itemId: input.itemId, lotId: lot!.id, kind: "receive", quantity: r4(input.quantity), unitCost: input.unitCost, note: input.note || null, sourceType: input.sourceType ?? null, sourceId: input.sourceId ?? null });
  return lot!;
}

export async function receive(db: Db, ctx: Ctx, input: z.infer<typeof receiveSchema>) {
  requireRole(ctx, STOCK_ROLES);
  return db.transaction((tx) => receiveStock(tx, ctx, input));
}

// ── Job material: pick, return, remnant ─────────────────────────────────────

type JobMaterial = typeof jobMaterials.$inferSelect;

/** Net quantity this job material still holds from each lot it drew from (consumed − returned − remnants). */
async function heldByLot(tx: Tx, m: JobMaterial) {
  const res = await tx.execute<{ lot_id: string; held: number; unit_cost: number; received_at: string }>(sql`
    select src.id as lot_id, -sum(t.quantity)::float as held, max(src.unit_cost)::float as unit_cost, max(src.received_at)::text as received_at
    from stock_transactions t
    join stock_lots l on l.id = t.lot_id
    join stock_lots src on src.id = case when t.kind = 'remnant' then l.parent_lot_id else t.lot_id end
    where t.job_material_id = ${m.id} and t.kind in ('consume', 'return', 'remnant')
    group by src.id`);
  // Remnant rows add stock to the child lot (+), which reduces what the job holds from the parent.
  return res.rows.filter((r) => r.held > 1e-9).sort((a, b) => (a.received_at < b.received_at ? 1 : -1));
}

/**
 * Take `quantity` for a job material: oldest lots of the item first, the rest untracked.
 * Returns the cost of what was taken.
 */
export async function consumeForJob(tx: Tx, ctx: Ctx, m: JobMaterial, quantity: number) {
  let left = r4(quantity);
  let cost = 0;
  if (m.itemId) {
    const lots = await tx.execute<{ id: string; quantity: number; unit_cost: number }>(sql`
      select id, quantity::float, unit_cost::float from stock_lots
      where org_id = ${ctx.orgId} and item_id = ${m.itemId} and quantity > 0
      order by received_at, lot_number for update`);
    for (const lot of lots.rows) {
      if (left <= 0) break;
      const take = r4(Math.min(left, lot.quantity));
      await bumpLot(tx, lot.id, -take);
      await post(tx, ctx, { itemId: m.itemId, lotId: lot.id, kind: "consume", quantity: -take, unitCost: lot.unit_cost, jobId: m.jobId, jobMaterialId: m.id });
      cost += take * lot.unit_cost;
      left = r4(left - take);
    }
  }
  if (left > 0) {
    // Not enough tracked stock (or a free-text material): record it so the floor keeps moving.
    await post(tx, ctx, { itemId: m.itemId, lotId: null, kind: "consume", quantity: -left, unitCost: m.unitCost, jobId: m.jobId, jobMaterialId: m.id, note: "Untracked: picked beyond stock on hand" });
    cost += left * m.unitCost;
  }
  return r4(cost);
}

/** Put back `quantity` of a job material: into the lots it came from (newest first), then untracked. */
export async function returnFromJob(tx: Tx, ctx: Ctx, m: JobMaterial, quantity: number) {
  let left = r4(quantity);
  let cost = 0;
  for (const h of await heldByLot(tx, m)) {
    if (left <= 0) break;
    const back = r4(Math.min(left, h.held));
    await tx.execute(sql`select id from stock_lots where id = ${h.lot_id} for update`);
    await bumpLot(tx, h.lot_id, back);
    await post(tx, ctx, { itemId: m.itemId, lotId: h.lot_id, kind: "return", quantity: back, unitCost: h.unit_cost, jobId: m.jobId, jobMaterialId: m.id });
    cost += back * h.unit_cost;
    left = r4(left - back);
  }
  if (left > 0) {
    await post(tx, ctx, { itemId: m.itemId, lotId: null, kind: "return", quantity: left, unitCost: m.unitCost, jobId: m.jobId, jobMaterialId: m.id, note: "Untracked return" });
    cost += left * m.unitCost;
  }
  return r4(cost);
}

export const remnantSchema = z.object({
  quantity: z.number().positive().max(1e9),
  dimensions: z.string().trim().min(1).max(60),
  locationId: z.uuid().nullable().optional(),
});

/**
 * Save an off-cut from a job as a new remnant lot. It comes off the job's issued quantity and
 * keeps the parent lot's cost, heat number, supplier and certificate.
 */
export async function saveRemnant(db: Db, ctx: Ctx, jobMaterialId: string, input: z.infer<typeof remnantSchema>) {
  requireRole(ctx, [...STOCK_ROLES, "operator"]);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(jobMaterials).where(and(eq(jobMaterials.orgId, ctx.orgId), eq(jobMaterials.id, jobMaterialId))).for("update");
    if (!m) throw notFound("Material");
    if (!m.itemId) throw badRequest("Remnants can only be saved for catalogue materials");
    if (input.quantity > m.quantityIssued + 1e-9) throw badRequest(`Only ${m.quantityIssued} has been picked for this job`);
    await assertOwned(tx, stockLocations, [input.locationId], ctx.orgId, "location");
    const [held] = await heldByLot(tx, m);
    const [parent] = held ? await tx.select().from(stockLots).where(eq(stockLots.id, held.lot_id)) : [];
    const unitCost = parent?.unitCost ?? m.unitCost;
    const lotNumber = await nextNumber(tx, ctx.orgId, "lot");
    const [lot] = await tx
      .insert(stockLots)
      .values({
        orgId: ctx.orgId,
        itemId: m.itemId,
        locationId: input.locationId ?? parent?.locationId ?? (await defaultLocation(tx, ctx)),
        lotNumber,
        dimensions: input.dimensions,
        heatNumber: parent?.heatNumber ?? null,
        supplier: parent?.supplier ?? null,
        quantity: r4(input.quantity),
        unitCost,
        remnant: true,
        parentLotId: parent?.id ?? null,
        createdBy: ctx.userId,
      })
      .returning();
    await post(tx, ctx, { itemId: m.itemId, lotId: lot!.id, kind: "remnant", quantity: r4(input.quantity), unitCost, jobId: m.jobId, jobMaterialId: m.id });
    const value = r4(input.quantity * unitCost);
    await tx
      .update(jobMaterials)
      .set({ quantityIssued: r4(m.quantityIssued - input.quantity), issuedCost: r4(Math.max(0, m.issuedCost - value)) })
      .where(eq(jobMaterials.id, m.id));
    const { refreshJobActual } = await import("./floor.ts");
    await refreshJobActual(tx, m.jobId);
    await logEvent(tx, ctx, "job", m.jobId, "remnant_saved", { material: m.description, quantity: input.quantity, dimensions: input.dimensions, lot: lotNumber });
    return lot!;
  });
}

// ── Adjust, move, count ─────────────────────────────────────────────────────

export const adjustSchema = z.object({ quantity: z.number().min(0).max(1e9), note: z.string().trim().min(1).max(500) });

/** Set a lot to a new quantity (found extra, damage, write-off) with a reason. */
export async function adjustLot(db: Db, ctx: Ctx, lotId: string, input: z.infer<typeof adjustSchema>) {
  requireRole(ctx, STOCK_ROLES);
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(stockLots).where(and(eq(stockLots.orgId, ctx.orgId), eq(stockLots.id, lotId))).for("update");
    if (!lot) throw notFound("Lot");
    const delta = r4(input.quantity - lot.quantity);
    if (delta === 0) return lot;
    await bumpLot(tx, lot.id, delta);
    await post(tx, ctx, { itemId: lot.itemId, lotId: lot.id, kind: "adjust", quantity: delta, unitCost: lot.unitCost, note: input.note });
    return { ...lot, quantity: input.quantity };
  });
}

export const moveSchema = z.object({ locationId: z.uuid() });

/** Move a whole lot to another location. */
export async function moveLot(db: Db, ctx: Ctx, lotId: string, input: z.infer<typeof moveSchema>) {
  requireRole(ctx, [...STOCK_ROLES, "operator"]);
  return db.transaction(async (tx) => {
    const [lot] = await tx.select().from(stockLots).where(and(eq(stockLots.orgId, ctx.orgId), eq(stockLots.id, lotId))).for("update");
    if (!lot) throw notFound("Lot");
    await assertOwned(tx, stockLocations, [input.locationId], ctx.orgId, "location");
    if (lot.locationId === input.locationId) return lot;
    const [from] = await tx.select({ code: stockLocations.code }).from(stockLocations).where(eq(stockLocations.id, lot.locationId));
    const [to] = await tx.select({ code: stockLocations.code }).from(stockLocations).where(eq(stockLocations.id, input.locationId));
    await tx.update(stockLots).set({ locationId: input.locationId }).where(eq(stockLots.id, lot.id));
    await post(tx, ctx, { itemId: lot.itemId, lotId: lot.id, kind: "move_out", quantity: -lot.quantity, unitCost: lot.unitCost, note: `To ${to!.code}` });
    await post(tx, ctx, { itemId: lot.itemId, lotId: lot.id, kind: "move_in", quantity: lot.quantity, unitCost: lot.unitCost, note: `From ${from!.code}` });
    return { ...lot, locationId: input.locationId };
  });
}

/** Every lot with stock, for the stock-take spreadsheet. */
export async function stockTakeRows(db: Db, ctx: Ctx) {
  return db
    .select({
      lotId: stockLots.id,
      partNumber: items.partNumber,
      description: items.description,
      uom: items.uom,
      location: stockLocations.code,
      lotNumber: stockLots.lotNumber,
      dimensions: stockLots.dimensions,
      quantity: stockLots.quantity,
      unitCost: stockLots.unitCost,
    })
    .from(stockLots)
    .innerJoin(items, eq(items.id, stockLots.itemId))
    .innerJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
    .where(and(eq(stockLots.orgId, ctx.orgId), gt(stockLots.quantity, 0)))
    .orderBy(asc(items.partNumber), asc(stockLots.receivedAt));
}

export const countSchema = z.object({
  /** Counted quantities by lot id; `expected` is the quantity on the downloaded sheet. */
  rows: z.array(z.object({ lotId: z.uuid(), counted: z.number().min(0).max(1e9), expected: z.number().min(0).max(1e9) })).min(1).max(20000),
  apply: z.boolean().default(false),
});

/**
 * Compare a filled-in stock-take sheet with stock now. Without `apply` it only returns the
 * preview; with `apply` it posts one count adjustment per changed lot, all together.
 */
export async function stockTake(db: Db, ctx: Ctx, input: z.infer<typeof countSchema>) {
  requireRole(ctx, STOCK_ROLES);
  return db.transaction(async (tx) => {
    const ids = [...new Set(input.rows.map((r) => r.lotId))];
    if (ids.length !== input.rows.length) throw badRequest("A lot appears twice in the sheet");
    const lots = await tx
      .select({ id: stockLots.id, itemId: stockLots.itemId, quantity: stockLots.quantity, unitCost: stockLots.unitCost, lotNumber: stockLots.lotNumber, partNumber: items.partNumber })
      .from(stockLots)
      .innerJoin(items, eq(items.id, stockLots.itemId))
      .where(and(eq(stockLots.orgId, ctx.orgId), inArray(stockLots.id, ids)))
      .for("update", { of: stockLots });
    if (lots.length !== ids.length) throw badRequest("The sheet has lots that are not in this shop. Download a fresh sheet.");
    const changes = input.rows
      .map((r) => {
        const lot = lots.find((l) => l.id === r.lotId)!;
        return {
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          partNumber: lot.partNumber,
          before: lot.quantity,
          counted: r4(r.counted),
          delta: r4(r.counted - lot.quantity),
          value: r4((r.counted - lot.quantity) * lot.unitCost),
          // Stock moved after the sheet was downloaded: the count may already be out of date.
          movedSinceDownload: Math.abs(lot.quantity - r.expected) > 1e-9,
          itemId: lot.itemId,
          unitCost: lot.unitCost,
        };
      })
      .filter((c) => c.delta !== 0);
    if (input.apply) {
      for (const c of changes) {
        await bumpLot(tx, c.lotId, c.delta);
        await post(tx, ctx, { itemId: c.itemId, lotId: c.lotId, kind: "count", quantity: c.delta, unitCost: c.unitCost, note: "Stock take" });
      }
      await logEvent(tx, ctx, "inventory", ctx.orgId, "stock_take", { lots: input.rows.length, changed: changes.length });
    }
    return {
      checked: input.rows.length,
      changes: changes.map(({ itemId: _i, unitCost: _u, ...c }) => c),
      valueChange: r4(changes.reduce((a, c) => a + c.value, 0)),
      applied: input.apply,
    };
  });
}

// ── Views ───────────────────────────────────────────────────────────────────

/**
 * Open-job demand: what each open job still has to pick of each catalogue item. Inventory's
 * "needed by jobs" and Purchasing's plan both use this, so the two pages agree.
 */
export async function demandRows(db: Db | Tx, ctx: Ctx, opts: { itemIds?: string[]; endDate?: string } = {}) {
  const rows = await db
    .select({
      itemId: jobMaterials.itemId,
      jobId: jobs.id,
      jobNumber: jobs.number,
      dueDate: jobs.dueDate,
      priority: jobs.priority,
      status: jobs.status,
      required: jobMaterials.quantityRequired,
      issued: jobMaterials.quantityIssued,
    })
    .from(jobMaterials)
    .innerJoin(jobs, eq(jobs.id, jobMaterials.jobId))
    .where(
      and(
        eq(jobMaterials.orgId, ctx.orgId),
        isNotNull(jobMaterials.itemId),
        inArray(jobs.status, OPEN_JOBS),
        opts.itemIds ? inArray(jobMaterials.itemId, opts.itemIds.length ? opts.itemIds : ["00000000-0000-0000-0000-000000000000"]) : undefined,
      ),
    )
    .orderBy(asc(jobs.dueDate));
  return rows
    .map((r) => ({ ...r, itemId: r.itemId!, remaining: r4(Math.max(0, r.required - r.issued)) }))
    .filter((r) => r.remaining > 0 && (!opts.endDate || !r.dueDate || r.dueDate <= opts.endDate));
}

/** One row per stocked or watched item: on hand, value, needed by open jobs, reorder point. */
export async function overview(db: Db, ctx: Ctx, opts: { q?: string } = {}) {
  const rows = await db.execute<{
    id: string;
    part_number: string;
    revision: string;
    description: string;
    type: string;
    uom: string;
    reorder_point: number | null;
    reorder_quantity: number | null;
    on_hand: number;
    value: number;
    lots: number;
    remnants: number;
    needed: number;
    last_move: string | null;
  }>(sql`
    select i.id, i.part_number, i.revision, i.description, i.type, i.uom,
      i.reorder_point::float, i.reorder_quantity::float,
      coalesce(s.on_hand, 0)::float as on_hand, coalesce(s.value, 0)::float as value,
      coalesce(s.lots, 0)::int as lots, coalesce(s.remnants, 0)::int as remnants,
      0::float as needed,
      (select max(created_at) from stock_transactions t where t.item_id = i.id)::text as last_move
    from items i
    left join (
      select item_id, sum(quantity) as on_hand, sum(quantity * unit_cost) as value,
        count(*) filter (where quantity > 0) as lots, count(*) filter (where quantity > 0 and remnant) as remnants
      from stock_lots where org_id = ${ctx.orgId} group by item_id
    ) s on s.item_id = i.id
    where i.org_id = ${ctx.orgId} and i.active
      and (i.type in ('material', 'purchased') or s.item_id is not null or i.reorder_point is not null)
      ${opts.q ? sql`and (i.part_number ilike ${`%${opts.q}%`} or i.description ilike ${`%${opts.q}%`})` : sql``}
    order by i.type, i.part_number`);
  const needed = new Map<string, number>();
  for (const d of await demandRows(db, ctx)) needed.set(d.itemId, r4((needed.get(d.itemId) ?? 0) + d.remaining));
  const onOrder = await incomingByItem(db, ctx);
  return rows.rows.map((r) => ({ ...r, needed: needed.get(r.id) ?? 0, on_order: onOrder.get(r.id) ?? 0 })).map((r) => ({
    id: r.id,
    partNumber: r.part_number,
    revision: r.revision,
    description: r.description,
    type: r.type,
    uom: r.uom,
    reorderPoint: r.reorder_point,
    reorderQuantity: r.reorder_quantity,
    onHand: r.on_hand,
    value: r.value,
    lots: r.lots,
    remnants: r.remnants,
    needed: r.needed,
    onOrder: r.on_order,
    available: Math.round((r.on_hand - r.needed) * 10000) / 10000,
    lastMove: r.last_move,
  }));
}

/** Certificates for a set of lots, including those inherited from a remnant's parent lot. */
async function certsFor(db: Db, ctx: Ctx, lots: { id: string; parentLotId: string | null }[]) {
  const ids = [...new Set(lots.flatMap((l) => [l.id, l.parentLotId].filter((v): v is string => !!v)))];
  if (!ids.length) return new Map<string, { id: string; fileName: string; inherited: boolean }[]>();
  const files = await db
    .select({ id: attachments.id, fileName: attachments.fileName, entityId: attachments.entityId })
    .from(attachments)
    .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entity, "stock_lot"), inArray(attachments.entityId, ids)));
  const out = new Map<string, { id: string; fileName: string; inherited: boolean }[]>();
  for (const l of lots) {
    out.set(l.id, [
      ...files.filter((f) => f.entityId === l.id).map((f) => ({ id: f.id, fileName: f.fileName, inherited: false })),
      ...files.filter((f) => l.parentLotId && f.entityId === l.parentLotId).map((f) => ({ id: f.id, fileName: f.fileName, inherited: true })),
    ]);
  }
  return out;
}

/** Stock detail for one item: lots, ledger, demand from open jobs and where lots were used. */
export async function itemStock(db: Db, ctx: Ctx, itemId: string) {
  const [item] = await db
    .select({ id: items.id, partNumber: items.partNumber, revision: items.revision, description: items.description, uom: items.uom, type: items.type, unitCost: items.unitCost, reorderPoint: items.reorderPoint, reorderQuantity: items.reorderQuantity })
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId)));
  if (!item) throw notFound("Item");
  const [lots, ledger, demand] = await Promise.all([
    db
      .select({
        id: stockLots.id,
        lotNumber: stockLots.lotNumber,
        locationId: stockLots.locationId,
        location: stockLocations.code,
        dimensions: stockLots.dimensions,
        heatNumber: stockLots.heatNumber,
        supplier: stockLots.supplier,
        quantity: stockLots.quantity,
        unitCost: stockLots.unitCost,
        remnant: stockLots.remnant,
        parentLotId: stockLots.parentLotId,
        receivedAt: stockLots.receivedAt,
      })
      .from(stockLots)
      .innerJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
      .where(and(eq(stockLots.orgId, ctx.orgId), eq(stockLots.itemId, itemId)))
      .orderBy(desc(stockLots.receivedAt)),
    db
      .select({
        id: stockTransactions.id,
        kind: stockTransactions.kind,
        quantity: stockTransactions.quantity,
        unitCost: stockTransactions.unitCost,
        value: stockTransactions.value,
        note: stockTransactions.note,
        createdAt: stockTransactions.createdAt,
        userName: users.name,
        lotId: stockTransactions.lotId,
        lotNumber: stockLots.lotNumber,
        dimensions: stockLots.dimensions,
        location: stockLocations.code,
        jobId: stockTransactions.jobId,
        jobNumber: jobs.number,
        sourceType: stockTransactions.sourceType,
      })
      .from(stockTransactions)
      .leftJoin(stockLots, eq(stockLots.id, stockTransactions.lotId))
      .leftJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
      .leftJoin(jobs, eq(jobs.id, stockTransactions.jobId))
      .leftJoin(users, eq(users.id, stockTransactions.userId))
      .where(and(eq(stockTransactions.orgId, ctx.orgId), eq(stockTransactions.itemId, itemId)))
      .orderBy(desc(stockTransactions.createdAt))
      .limit(300),
    demandRows(db, ctx, { itemIds: [itemId] }),
  ]);
  // Traceability: which jobs each lot went into.
  const used = lots.length
    ? await db
        .select({ lotId: stockTransactions.lotId, jobId: jobs.id, jobNumber: jobs.number, quantity: sql<number>`-sum(${stockTransactions.quantity})::float` })
        .from(stockTransactions)
        .innerJoin(jobs, eq(jobs.id, stockTransactions.jobId))
        .where(and(isNotNull(stockTransactions.lotId), inArray(stockTransactions.lotId, lots.map((l) => l.id)), inArray(stockTransactions.kind, ["consume", "return"])))
        .groupBy(stockTransactions.lotId, jobs.id)
    : [];
  const certs = await certsFor(db, ctx, lots);
  const onHand = lots.reduce((a, l) => a + l.quantity, 0);
  const needed = demand.reduce((a, d) => a + d.remaining, 0);
  return {
    item,
    onHand: r4(onHand),
    value: r4(lots.reduce((a, l) => a + l.quantity * l.unitCost, 0)),
    needed: r4(needed),
    available: r4(onHand - needed),
    lots: lots.map((l) => ({ ...l, certs: certs.get(l.id) ?? [], usedOn: used.filter((u) => u.lotId === l.id && u.quantity > 0).map(({ lotId: _l, ...u }) => u) })),
    ledger,
    demand: demand.map(({ itemId: _i, ...d }) => d),
    onOrder: (await incomingByItem(db, ctx)).get(itemId) ?? 0,
  };
}

/** Lots a job material can be picked from, oldest first (what the operator sees). */
export async function lotsForItems(db: Db | Tx, ctx: Ctx, itemIds: string[]) {
  if (!itemIds.length) return [];
  return db
    .select({ id: stockLots.id, itemId: stockLots.itemId, lotNumber: stockLots.lotNumber, location: stockLocations.code, dimensions: stockLots.dimensions, quantity: stockLots.quantity, remnant: stockLots.remnant })
    .from(stockLots)
    .innerJoin(stockLocations, eq(stockLocations.id, stockLots.locationId))
    .where(and(eq(stockLots.orgId, ctx.orgId), inArray(stockLots.itemId, itemIds), gt(stockLots.quantity, 0)))
    .orderBy(asc(stockLots.receivedAt), asc(stockLots.lotNumber));
}

export const reorderSchema = z.object({ reorderPoint: z.number().min(0).max(1e9).nullable(), reorderQuantity: z.number().min(0).max(1e9).nullable() });

export async function setReorder(db: Db, ctx: Ctx, itemId: string, input: z.infer<typeof reorderSchema>) {
  requireRole(ctx, STOCK_ROLES);
  const [row] = await db.update(items).set({ ...input, updatedAt: new Date() }).where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId))).returning({ id: items.id });
  if (!row) throw notFound("Item");
  return itemStock(db, ctx, itemId);
}

/** Quantity still to arrive on open purchase orders (draft, sent or partly received), per item. */
export async function incomingByItem(db: Db | Tx, ctx: Ctx) {
  const res = await db.execute<{ item_id: string; qty: number }>(sql`
    select l.item_id, sum(greatest(l.quantity - l.quantity_received, 0))::float as qty
    from purchase_order_lines l join purchase_orders p on p.id = l.purchase_order_id
    where l.org_id = ${ctx.orgId} and l.item_id is not null and p.status in ('draft', 'sent', 'partial')
    group by l.item_id`);
  return new Map(res.rows.map((r) => [r.item_id, r.qty]));
}
