import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import type { ItemInput, WorkCenterInput } from "@ironline/shared";
import type { Db, Tx } from "../db/client.ts";
import { bomLines, items, routingOperations, workCenters } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { assertOwned, like, logEvent } from "./common.ts";

// ── Work centers ────────────────────────────────────────────────────────────

export async function listWorkCenters(db: Db, ctx: Ctx) {
  return db.select().from(workCenters).where(eq(workCenters.orgId, ctx.orgId)).orderBy(asc(workCenters.code));
}

async function wcCodeTaken(db: Db, ctx: Ctx, code: string, exceptId?: string) {
  const rows = await db.select({ id: workCenters.id }).from(workCenters).where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.code, code)));
  return rows.some((r) => r.id !== exceptId);
}

export async function createWorkCenter(db: Db, ctx: Ctx, input: WorkCenterInput) {
  requireRole(ctx, EDITORS);
  if (await wcCodeTaken(db, ctx, input.code)) throw conflict(`Work center ${input.code} already exists`);
  const [row] = await db.insert(workCenters).values({ ...input, orgId: ctx.orgId }).returning();
  return row!;
}

export async function updateWorkCenter(db: Db, ctx: Ctx, id: string, input: Partial<WorkCenterInput>) {
  requireRole(ctx, EDITORS);
  if (input.code && (await wcCodeTaken(db, ctx, input.code, id))) throw conflict(`Work center ${input.code} already exists`);
  const [row] = await db
    .update(workCenters)
    .set({ ...input, updatedAt: new Date() })
    .where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.id, id)))
    .returning();
  if (!row) throw notFound("Work center");
  return row;
}

// ── Items with routing and BOM ──────────────────────────────────────────────

export async function listItems(db: Db, ctx: Ctx, opts: { q?: string; type?: string } = {}) {
  const where = [eq(items.orgId, ctx.orgId)];
  if (opts.q) where.push(or(ilike(items.partNumber, like(opts.q)), ilike(items.description, like(opts.q)))!);
  if (opts.type) where.push(eq(items.type, opts.type));
  return db.select().from(items).where(and(...where)).orderBy(asc(items.partNumber), asc(items.revision)).limit(500);
}

export async function getItem(db: Db | Tx, ctx: Ctx, id: string) {
  const [item] = await db.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.id, id)));
  if (!item) throw notFound("Item");
  const [routing, bom] = await Promise.all([
    db
      .select({
        id: routingOperations.id,
        sequence: routingOperations.sequence,
        workCenterId: routingOperations.workCenterId,
        workCenterCode: workCenters.code,
        workCenterName: workCenters.name,
        rate: workCenters.hourlyRate,
        description: routingOperations.description,
        setupHours: routingOperations.setupHours,
        runHoursPerUnit: routingOperations.runHoursPerUnit,
      })
      .from(routingOperations)
      .innerJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
      .where(and(eq(routingOperations.orgId, ctx.orgId), eq(routingOperations.itemId, id)))
      .orderBy(asc(routingOperations.sequence)),
    db
      .select({
        id: bomLines.id,
        sequence: bomLines.sequence,
        componentItemId: bomLines.componentItemId,
        partNumber: items.partNumber,
        description: items.description,
        unitCost: items.unitCost,
        uom: items.uom,
        type: items.type,
        quantityPer: bomLines.quantityPer,
        scrapPct: bomLines.scrapPct,
      })
      .from(bomLines)
      .innerJoin(items, eq(items.id, bomLines.componentItemId))
      .where(and(eq(bomLines.orgId, ctx.orgId), eq(bomLines.parentItemId, id)))
      .orderBy(asc(bomLines.sequence)),
  ]);
  return { ...item, routing, bom };
}

async function writeStructure(tx: Tx, ctx: Ctx, itemId: string, input: Pick<ItemInput, "routing" | "bom">) {
  await assertOwned(tx, workCenters, input.routing.map((r) => r.workCenterId), ctx.orgId, "work center");
  await assertOwned(tx, items, input.bom.map((b) => b.componentItemId), ctx.orgId, "component item");
  if (input.bom.some((b) => b.componentItemId === itemId)) throw badRequest("An item cannot be a component of itself");
  await tx.delete(routingOperations).where(eq(routingOperations.itemId, itemId));
  await tx.delete(bomLines).where(eq(bomLines.parentItemId, itemId));
  if (input.routing.length) {
    await tx.insert(routingOperations).values(
      input.routing.map((r, i) => ({ ...r, orgId: ctx.orgId, itemId, sequence: (i + 1) * 10 })),
    );
  }
  if (input.bom.length) {
    await tx.insert(bomLines).values(
      input.bom.map((b, i) => ({ ...b, orgId: ctx.orgId, parentItemId: itemId, sequence: (i + 1) * 10 })),
    );
  }
}

/** Pieces per job assumed when spreading a made part's setup over its cost (same as the part page). */
export const COST_BATCH = 10;

/** Most parts one save may re-cost (the part and every assembly above it). */
const MAX_RECOST = 500;

/** A made part's cost from its routing (setup over COST_BATCH pieces) and its components' current costs. */
async function costOf(tx: Tx, itemId: string) {
  const ops = await tx
    .select({ setup: routingOperations.setupHours, run: routingOperations.runHoursPerUnit, rate: workCenters.hourlyRate })
    .from(routingOperations)
    .innerJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
    .where(eq(routingOperations.itemId, itemId));
  const mats = await tx
    .select({ per: bomLines.quantityPer, scrap: bomLines.scrapPct, cost: items.unitCost, type: items.type })
    .from(bomLines)
    .innerJoin(items, eq(items.id, bomLines.componentItemId))
    .where(eq(bomLines.parentItemId, itemId));
  const labor = ops.reduce((a, o) => a + (o.setup * o.rate) / COST_BATCH + o.run * o.rate, 0);
  const material = mats.reduce((a, m) => a + m.cost * m.per * (m.type === "material" ? 1 + m.scrap / 100 : 1), 0);
  return Math.round((labor + material) * 10000) / 10000;
}

/**
 * Keep a made part's standard cost up to date, and every assembly that uses it: routing (setup
 * spread over COST_BATCH pieces, plus run time) plus its bill of materials, where made pieces
 * use their own standard cost. The part and all assemblies above it are gathered once (capped),
 * then re-costed bottom-up in a few passes until nothing changes.
 */
export async function refreshStandardCost(tx: Tx, ctx: Ctx, itemId: string) {
  const affected = [itemId];
  const seen = new Set(affected);
  for (let i = 0; i < affected.length && affected.length < MAX_RECOST; i++) {
    const parents = await tx.select({ id: bomLines.parentItemId }).from(bomLines).where(and(eq(bomLines.orgId, ctx.orgId), eq(bomLines.componentItemId, affected[i]!)));
    for (const p of parents) if (!seen.has(p.id)) (seen.add(p.id), affected.push(p.id));
  }
  const made = await tx.select({ id: items.id, cost: items.unitCost }).from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.type, "manufactured"), inArray(items.id, affected)));
  const current = new Map(made.map((m) => [m.id, m.cost]));
  // Each pass settles one more level of the tree; deep trees are rare, so a few passes suffice.
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const id of current.keys()) {
      const cost = await costOf(tx, id);
      if (cost !== current.get(id)) {
        current.set(id, cost);
        await tx.update(items).set({ unitCost: cost }).where(eq(items.id, id));
        changed = true;
      }
    }
    if (!changed) break;
  }
}

async function partTaken(db: Db | Tx, ctx: Ctx, partNumber: string, revision: string, exceptId?: string) {
  const rows = await db
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.orgId, ctx.orgId), eq(items.partNumber, partNumber), eq(items.revision, revision)));
  return rows.some((r) => r.id !== exceptId);
}

export async function createItem(db: Db, ctx: Ctx, input: ItemInput) {
  requireRole(ctx, EDITORS);
  const { routing, bom, ...fields } = input;
  return db.transaction(async (tx) => {
    if (await partTaken(tx, ctx, fields.partNumber, fields.revision)) {
      throw conflict(`Part ${fields.partNumber} rev ${fields.revision} already exists`);
    }
    const [row] = await tx
      .insert(items)
      .values({ ...fields, orgId: ctx.orgId, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning();
    await writeStructure(tx, ctx, row!.id, { routing, bom });
    await refreshStandardCost(tx, ctx, row!.id);
    await logEvent(tx, ctx, "item", row!.id, "created", { partNumber: row!.partNumber });
    return getItem(tx, ctx, row!.id);
  });
}

export async function updateItem(db: Db, ctx: Ctx, id: string, input: ItemInput) {
  requireRole(ctx, EDITORS);
  const { routing, bom, ...fields } = input;
  return db.transaction(async (tx) => {
    if (await partTaken(tx, ctx, fields.partNumber, fields.revision, id)) {
      throw conflict(`Part ${fields.partNumber} rev ${fields.revision} already exists`);
    }
    const [row] = await tx
      .update(items)
      .set({ ...fields, updatedAt: new Date(), updatedBy: ctx.userId })
      .where(and(eq(items.orgId, ctx.orgId), eq(items.id, id)))
      .returning();
    if (!row) throw notFound("Item");
    await writeStructure(tx, ctx, id, { routing, bom });
    await refreshStandardCost(tx, ctx, id);
    await logEvent(tx, ctx, "item", id, "updated");
    return getItem(tx, ctx, id);
  });
}
