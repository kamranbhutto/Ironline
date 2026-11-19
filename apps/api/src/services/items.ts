import { and, asc, eq, ilike, or } from "drizzle-orm";
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
    await logEvent(tx, ctx, "item", id, "updated");
    return getItem(tx, ctx, id);
  });
}
