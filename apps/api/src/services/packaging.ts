/**
 * Packaging: the shop's library of containers, pallets and vehicles, and each part's packing
 * size and chosen packing spec. The packing maths itself is in packages/shared/src/packing.ts
 * and runs in the browser, so studies are instant; the server stores inputs and the result.
 */
import { BOARD_GRADES } from "@ironline/shared";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { items, packAssets } from "../db/schema.ts";
import { conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { logEvent } from "./common.ts";

const mm = z.coerce.number().min(0).max(100000);
const size = z.coerce.number().positive().max(100000);
const kg = z.coerce.number().min(0).max(1000000);
const price = z.coerce.number().min(0).max(1e9);

export const PACK_KINDS = ["carton", "tote", "crate", "pallet", "vehicle"] as const;
const gradeKeys = BOARD_GRADES.map((g) => g.key) as [string, ...string[]];

export const packAssetSchema = z.object({
  kind: z.enum(PACK_KINDS),
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(120),
  l: size,
  w: size,
  h: size,
  wall: mm.default(0),
  tare: kg.default(0),
  maxLoad: kg.default(0),
  maxHeight: mm.default(0),
  cost: price.default(0),
  returnable: z.boolean().default(false),
  tripCost: price.default(0),
  lifeTrips: z.coerce.number().int().min(1).max(100000).default(1),
  grade: z.enum(gradeKeys).nullable().optional(),
  active: z.boolean().default(true),
});
export type PackAssetInput = z.infer<typeof packAssetSchema>;

/**
 * A starting library so a new shop can run a study straight away. Sizes are common stock sizes;
 * prices are placeholders to replace with the shop's own.
 */
const STARTER: PackAssetInput[] = [
  { kind: "carton", code: "CTN-302015", name: "Carton 300 × 200 × 150", l: 300, w: 200, h: 150, wall: 4, tare: 0.25, maxLoad: 0, maxHeight: 0, cost: 0.7, returnable: false, tripCost: 0, lifeTrips: 1, grade: "C32", active: true },
  { kind: "carton", code: "CTN-403025", name: "Carton 400 × 300 × 250", l: 400, w: 300, h: 250, wall: 4, tare: 0.45, maxLoad: 0, maxHeight: 0, cost: 1.1, returnable: false, tripCost: 0, lifeTrips: 1, grade: "C32", active: true },
  { kind: "carton", code: "CTN-604030", name: "Carton 600 × 400 × 300", l: 600, w: 400, h: 300, wall: 4, tare: 0.8, maxLoad: 0, maxHeight: 0, cost: 1.75, returnable: false, tripCost: 0, lifeTrips: 1, grade: "C44", active: true },
  { kind: "carton", code: "CTN-12128", name: "Carton 12 × 12 × 8 in", l: 305, w: 305, h: 203, wall: 3, tare: 0.3, maxLoad: 0, maxHeight: 0, cost: 0.85, returnable: false, tripCost: 0, lifeTrips: 1, grade: "B32", active: true },
  { kind: "carton", code: "CTN-242020", name: "Carton 24 × 20 × 20 in", l: 610, w: 508, h: 508, wall: 4, tare: 1.1, maxLoad: 0, maxHeight: 0, cost: 2.4, returnable: false, tripCost: 0, lifeTrips: 1, grade: "C32", active: true },
  { kind: "tote", code: "TOTE-6428", name: "Plastic tote 600 × 400 × 280", l: 565, w: 365, h: 260, wall: 17, tare: 2.2, maxLoad: 30, maxHeight: 0, cost: 18, returnable: true, tripCost: 0.9, lifeTrips: 200, grade: null, active: true },
  { kind: "tote", code: "TOTE-4322", name: "Plastic tote 400 × 300 × 220", l: 365, w: 265, h: 200, wall: 17, tare: 1.2, maxLoad: 20, maxHeight: 0, cost: 11, returnable: true, tripCost: 0.6, lifeTrips: 200, grade: null, active: true },
  { kind: "crate", code: "CRATE-1210", name: "Wooden crate on skid 1200 × 1000", l: 1150, w: 950, h: 700, wall: 25, tare: 45, maxLoad: 800, maxHeight: 0, cost: 120, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "pallet", code: "PAL-1208", name: "Pallet 1200 × 800", l: 1200, w: 800, h: 144, wall: 0, tare: 25, maxLoad: 1000, maxHeight: 1600, cost: 12, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "pallet", code: "PAL-1210", name: "Pallet 1200 × 1000", l: 1200, w: 1000, h: 144, wall: 0, tare: 30, maxLoad: 1200, maxHeight: 1600, cost: 14, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "pallet", code: "PAL-4840", name: "Pallet 48 × 40 in", l: 1219, w: 1016, h: 140, wall: 0, tare: 20, maxLoad: 1000, maxHeight: 1600, cost: 10, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "vehicle", code: "VAN-7T", name: "7.5 t box truck", l: 6000, w: 2400, h: 2300, wall: 0, tare: 0, maxLoad: 2500, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "vehicle", code: "TRL-136", name: "Trailer 13.6 m", l: 13600, w: 2450, h: 2700, wall: 0, tare: 0, maxLoad: 24000, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "vehicle", code: "VAN-53", name: "53 ft dry van", l: 16154, w: 2489, h: 2794, wall: 0, tare: 0, maxLoad: 20000, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "vehicle", code: "CNT-20", name: "20 ft container", l: 5898, w: 2352, h: 2393, wall: 0, tare: 0, maxLoad: 28000, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
  { kind: "vehicle", code: "CNT-40", name: "40 ft container", l: 12032, w: 2352, h: 2393, wall: 0, tare: 0, maxLoad: 26500, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: null, active: true },
];

export async function listAssets(db: Db, ctx: Ctx) {
  const where = eq(packAssets.orgId, ctx.orgId);
  let rows = await db.select().from(packAssets).where(where).orderBy(asc(packAssets.kind), asc(packAssets.code));
  if (!rows.length) {
    // First visit: give the shop a starter library to edit.
    await db.insert(packAssets).values(STARTER.map((a) => ({ ...a, orgId: ctx.orgId }))).onConflictDoNothing();
    rows = await db.select().from(packAssets).where(where).orderBy(asc(packAssets.kind), asc(packAssets.code));
  }
  return rows;
}

async function codeTaken(db: Db, ctx: Ctx, code: string, exceptId?: string) {
  const rows = await db.select({ id: packAssets.id }).from(packAssets).where(and(eq(packAssets.orgId, ctx.orgId), eq(packAssets.code, code)));
  return rows.some((r) => r.id !== exceptId);
}

export async function createAsset(db: Db, ctx: Ctx, input: PackAssetInput) {
  requireRole(ctx, EDITORS);
  if (await codeTaken(db, ctx, input.code)) throw conflict(`${input.code} is already in the packaging library`);
  const [row] = await db.insert(packAssets).values({ ...input, grade: input.kind === "carton" ? input.grade ?? null : null, orgId: ctx.orgId }).returning();
  return row!;
}

export async function updateAsset(db: Db, ctx: Ctx, id: string, input: PackAssetInput) {
  requireRole(ctx, EDITORS);
  if (await codeTaken(db, ctx, input.code, id)) throw conflict(`${input.code} is already in the packaging library`);
  const [row] = await db
    .update(packAssets)
    .set({ ...input, grade: input.kind === "carton" ? input.grade ?? null : null, updatedAt: new Date() })
    .where(and(eq(packAssets.orgId, ctx.orgId), eq(packAssets.id, id)))
    .returning();
  if (!row) throw notFound("Packaging item");
  return row;
}

// ── A part's packing ────────────────────────────────────────────────────────

const specSchema = z.object({
  method: z.enum(["layers", "cells", "nest"]),
  container: z.object({ code: z.string().max(60), name: z.string().max(160), kind: z.string().max(20), l: size, w: size, h: size, grade: z.string().max(10).nullable().optional() }),
  perBox: z.number().int().positive().max(1e7),
  layers: z.number().int().min(0).max(10000),
  perLayer: z.number().int().min(0).max(1e7),
  vertical: z.enum(["h", "w", "l"]),
  boxGross: kg,
  pallet: z.object({ code: z.string().max(60), name: z.string().max(160) }),
  boxesPerPallet: z.number().int().positive().max(1e6),
  partsPerPallet: z.number().int().positive().max(1e9),
  vehicle: z.object({ code: z.string().max(60), name: z.string().max(160) }),
  palletsPerLoad: z.number().int().positive().max(1e5),
  partsPerLoad: z.number().int().positive().max(1e12),
  costPerPart: price,
  savedAt: z.string().max(40),
});
export type PackSpec = z.infer<typeof specSchema>;

export const packingSchema = z.object({
  packL: size.nullable(),
  packW: size.nullable(),
  packH: size.nullable(),
  packWeight: kg.nullable(),
  packUpright: z.boolean().default(false),
  packNestPitch: size.nullable().optional(),
  /** Study settings, kept so the next study starts where this one ended. */
  packSettings: z.record(z.string().max(40), z.union([z.number(), z.string().max(200), z.boolean(), z.array(z.string().max(60)).max(200)])).refine((r) => Object.keys(r).length <= 60, "Too many settings").nullable().optional(),
  /** null clears the spec; undefined leaves it as it is. */
  packSpec: specSchema.nullable().optional(),
});

export async function savePacking(db: Db, ctx: Ctx, itemId: string, input: z.infer<typeof packingSchema>) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(items)
      .set({
        packL: input.packL,
        packW: input.packW,
        packH: input.packH,
        packWeight: input.packWeight,
        packUpright: input.packUpright,
        packNestPitch: input.packNestPitch ?? null,
        ...(input.packSettings !== undefined && { packSettings: input.packSettings }),
        ...(input.packSpec !== undefined && { packSpec: input.packSpec }),
        updatedAt: new Date(),
        updatedBy: ctx.userId,
      })
      .where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId)))
      .returning({ id: items.id, partNumber: items.partNumber, packSpec: items.packSpec });
    if (!row) throw notFound("Item");
    if (input.packSpec) await logEvent(tx, ctx, "item", itemId, "packing set", { container: input.packSpec.container.code, perBox: input.packSpec.perBox });
    return row;
  });
}
