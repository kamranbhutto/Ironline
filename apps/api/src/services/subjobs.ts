/**
 * Assemblies made from pieces you make yourself.
 *
 * When a job's materials include a part made in house, that part gets its own linked job
 * ("J-00012-1") with the part's routing and bill of materials, recursively. The assembly's
 * operations wait until every piece job is complete; a finished piece job puts its good parts
 * into stock, so the assembly picks them like any other material (at what they cost to make).
 */
import { materialCost, operationCost } from "@ironline/shared";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Tx } from "../db/client.ts";
import { bomLines, items, jobMaterials, jobOperations, jobs, laborEntries, routingOperations, stockTransactions, workCenters } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import type { Db } from "../db/client.ts";
import { logEvent } from "./common.ts";
import { receiveStock } from "./inventory.ts";

type Job = typeof jobs.$inferSelect;
const MAX_DEPTH = 6;
/** Most piece jobs one assembly job may create, at all levels together. */
export const MAX_PIECE_JOBS = 200;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const DONE = ["complete", "closed", "cancelled"];

/** Put a part's routing and bill of materials on a job for `qty` pieces. Returns the estimated cost. */
export async function buildFromItem(tx: Tx, ctx: Ctx, jobId: string, itemId: string, qty: number) {
  const ops = await tx
    .select({ workCenterId: routingOperations.workCenterId, description: routingOperations.description, setupHours: routingOperations.setupHours, runHoursPerUnit: routingOperations.runHoursPerUnit, rate: workCenters.hourlyRate })
    .from(routingOperations)
    .innerJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
    .where(and(eq(routingOperations.orgId, ctx.orgId), eq(routingOperations.itemId, itemId)))
    .orderBy(asc(routingOperations.sequence));
  const bom = await tx
    .select({ itemId: bomLines.componentItemId, partNumber: items.partNumber, description: items.description, type: items.type, quantityPer: bomLines.quantityPer, unitCost: items.unitCost, scrapPct: bomLines.scrapPct })
    .from(bomLines)
    .innerJoin(items, eq(items.id, bomLines.componentItemId))
    .where(and(eq(bomLines.orgId, ctx.orgId), eq(bomLines.parentItemId, itemId)))
    .orderBy(asc(bomLines.sequence));
  const opCosts = ops.map((o) => operationCost(o, qty));
  const mats = bom.map((b) => ({ kind: (b.type === "service" ? "service" : "material") as "material" | "service", itemId: b.itemId, description: `${b.partNumber} ${b.description}`, quantityPer: b.quantityPer, unitCost: b.unitCost, scrapPct: b.scrapPct, perLot: false }));
  const matCosts = mats.map((m) => materialCost(m, qty));
  if (ops.length) {
    await tx.insert(jobOperations).values(ops.map((o, i) => ({ orgId: ctx.orgId, jobId, sequence: (i + 1) * 10, workCenterId: o.workCenterId, description: o.description, setupHours: o.setupHours, runHoursPerUnit: o.runHoursPerUnit, rate: o.rate, estimatedCost: opCosts[i]! })));
  }
  if (mats.length) {
    await tx.insert(jobMaterials).values(
      mats.map((m, i) => ({
        orgId: ctx.orgId,
        jobId,
        sequence: (i + 1) * 10,
        kind: m.kind,
        itemId: m.itemId,
        description: m.description,
        // Made pieces come out whole: no scrap allowance on them.
        quantityRequired: r4(m.quantityPer * qty * (m.kind === "material" && bom[i]!.type !== "manufactured" ? 1 + m.scrapPct / 100 : 1)),
        unitCost: m.unitCost,
        estimatedCost: matCosts[i]!,
      })),
    );
  }
  return r4([...opCosts, ...matCosts].reduce((a, b) => a + b, 0));
}

/**
 * Give every made-in-house material line on this job its own linked job (and so on down the
 * tree). `seen` holds the part numbers above, so a part that contains itself stops.
 */
export async function spawnChildren(tx: Tx, ctx: Ctx, parent: Job, seen: Set<string>, depth = 0, budget = { left: MAX_PIECE_JOBS }) {
  if (depth >= MAX_DEPTH) return 0;
  const lines = await tx
    .select({ mat: jobMaterials, type: items.type, partNumber: items.partNumber, itemDescription: items.description })
    .from(jobMaterials)
    .innerJoin(items, eq(items.id, jobMaterials.itemId))
    .where(and(eq(jobMaterials.jobId, parent.id), eq(items.type, "manufactured")))
    .orderBy(asc(jobMaterials.sequence));
  let made = 0;
  let n = (await tx.select({ n: sql<number>`count(*)::int` }).from(jobs).where(eq(jobs.parentJobId, parent.id)))[0]?.n ?? 0;
  for (const l of lines) {
    if (seen.has(l.mat.itemId!)) continue;
    const [already] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.parentJobId, parent.id), eq(jobs.parentMaterialId, l.mat.id)));
    if (already) continue;
    if (budget.left <= 0) throw badRequest(`This assembly would need more than ${MAX_PIECE_JOBS} piece jobs. Split it into smaller assemblies.`);
    budget.left -= 1;
    n += 1;
    const [child] = await tx
      .insert(jobs)
      .values({
        orgId: ctx.orgId,
        number: `${parent.number}-${n}`,
        parentJobId: parent.id,
        parentMaterialId: l.mat.id,
        itemId: l.mat.itemId,
        description: `${l.partNumber} ${l.itemDescription} (for ${parent.number})`,
        quantity: l.mat.quantityRequired,
        dueDate: parent.dueDate,
        priority: parent.priority,
        createdBy: ctx.userId,
      })
      .returning();
    const est = await buildFromItem(tx, ctx, child!.id, l.mat.itemId!, l.mat.quantityRequired);
    await tx.update(jobs).set({ estimatedCost: est }).where(eq(jobs.id, child!.id));
    await logEvent(tx, ctx, "job", child!.id, "created", { number: child!.number, forJob: parent.number });
    made += 1;
    made += await spawnChildren(tx, ctx, child!, new Set([...seen, l.mat.itemId!]), depth + 1, budget);
  }
  if (made) await logEvent(tx, ctx, "job", parent.id, "piece_jobs_created", { count: lines.length });
  return made;
}

/** Piece jobs of this job that are not finished yet. */
export async function openChildren(tx: Tx | Db, jobId: string) {
  return tx.select({ id: jobs.id, number: jobs.number, status: jobs.status }).from(jobs).where(and(eq(jobs.parentJobId, jobId), notInArray(jobs.status, DONE)));
}

/** Release, plan or cancel the piece jobs together with their assembly. */
export async function cascadeStatus(tx: Tx, ctx: Ctx, parentId: string, to: "released" | "planned" | "cancelled") {
  const from = to === "released" ? ["planned"] : to === "planned" ? ["released"] : ["planned", "released"];
  const kids = await tx.select().from(jobs).where(and(eq(jobs.parentJobId, parentId), inArray(jobs.status, from)));
  for (const k of kids) {
    if (to === "released") {
      const [first] = await tx.select({ id: jobOperations.id }).from(jobOperations).where(eq(jobOperations.jobId, k.id)).orderBy(asc(jobOperations.sequence)).limit(1);
      if (!first) continue; // a piece with no routing cannot be released; it shows as waiting
      // Release its own pieces first; it can start only when it has none still to make.
      await cascadeStatus(tx, ctx, k.id, to);
      if (!(await openChildren(tx, k.id)).length) await tx.update(jobOperations).set({ status: "ready" }).where(and(eq(jobOperations.id, first.id), eq(jobOperations.status, "pending")));
    } else {
      await cascadeStatus(tx, ctx, k.id, to);
      if (to === "planned") await tx.update(jobOperations).set({ status: "pending" }).where(and(eq(jobOperations.jobId, k.id), eq(jobOperations.status, "ready")));
    }
    await tx.update(jobs).set({ status: to, updatedAt: new Date() }).where(eq(jobs.id, k.id));
    await logEvent(tx, ctx, "job", k.id, "status", { from: k.status, to, withJob: true });
  }
}

/**
 * A job just finished: if it makes a piece for an assembly, put its good parts into stock and,
 * when it was the last piece outstanding, let the assembly's first operation start.
 */
export async function onJobComplete(tx: Tx, ctx: Ctx, jobId: string) {
  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId));
  if (!job?.parentJobId || !job.itemId) return;
  // Receive only what this job has not put into stock before (a job can be reopened and finished again).
  const [prev] = await tx
    .select({ q: sql<number>`coalesce(sum(${stockTransactions.quantity}), 0)::float` })
    .from(stockTransactions)
    .where(and(eq(stockTransactions.orgId, ctx.orgId), eq(stockTransactions.kind, "receive"), eq(stockTransactions.sourceType, "job"), eq(stockTransactions.sourceId, job.id)));
  const good = r4(job.quantityCompleted - (prev?.q ?? 0));
  if (good > 0) {
    await receiveStock(tx, ctx, {
      itemId: job.itemId,
      quantity: good,
      unitCost: r4((job.actualCost || job.estimatedCost) / good),
      note: `Made on ${job.number}`,
      sourceType: "job",
      sourceId: job.id,
    });
  }
  await logEvent(tx, ctx, "job", job.parentJobId, "piece_job_done", { job: job.number, good });
  if ((await openChildren(tx, job.parentJobId)).length) return;
  const [parent] = await tx.select().from(jobs).where(eq(jobs.id, job.parentJobId));
  if (!parent || !["released", "in_progress"].includes(parent.status)) return;
  const [first] = await tx.select().from(jobOperations).where(eq(jobOperations.jobId, parent.id)).orderBy(asc(jobOperations.sequence)).limit(1);
  if (first?.status === "pending") await tx.update(jobOperations).set({ status: "ready" }).where(eq(jobOperations.id, first.id));
  await logEvent(tx, ctx, "job", parent.id, "pieces_ready", {});
}

/**
 * Rebuild a job from its part's current routing and bill of materials (for a job made before
 * the part was set up). Only while nothing has been done on it or its piece jobs.
 */
export async function rebuildJob(db: Db, ctx: Ctx, jobId: string) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, jobId))).for("update");
    if (!job) throw notFound("Job");
    if (!job.itemId) throw badRequest("This job is not for a catalogue part, so there is no part routing to copy");
    if (!["planned", "released"].includes(job.status)) throw conflict("Work has started on this job, so its routing can no longer be replaced");
    const tree = [job.id];
    for (let i = 0; i < tree.length; i++) for (const k of await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.parentJobId, tree[i]!))) tree.push(k.id);
    const [work] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(laborEntries)
      .innerJoin(jobOperations, eq(jobOperations.id, laborEntries.jobOperationId))
      .where(inArray(jobOperations.jobId, tree));
    const [picked] = await tx.select({ n: sql<number>`count(*)::int` }).from(jobMaterials).where(and(inArray(jobMaterials.jobId, tree), sql`${jobMaterials.quantityIssued} > 0`));
    if ((work?.n ?? 0) > 0 || (picked?.n ?? 0) > 0) throw conflict("Time or material is already booked on this job, so its routing can no longer be replaced");
    await tx.delete(jobs).where(and(eq(jobs.parentJobId, job.id)));
    await tx.delete(jobOperations).where(eq(jobOperations.jobId, job.id));
    await tx.delete(jobMaterials).where(eq(jobMaterials.jobId, job.id));
    const est = await buildFromItem(tx, ctx, job.id, job.itemId, job.quantity);
    await tx.update(jobs).set({ estimatedCost: est, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    const pieces = await spawnChildren(tx, ctx, job, new Set([job.itemId]));
    if (job.status === "released") {
      await tx.update(jobs).set({ status: "planned" }).where(eq(jobs.id, job.id));
      job.status = "planned";
    }
    await logEvent(tx, ctx, "job", job.id, "rebuilt", { pieces });
    return { pieces };
  });
}

/** Jobs list helper: the piece jobs under a job, for the job page. */
export async function childrenOf(db: Db | Tx, jobId: string) {
  return db
    .select({
      id: jobs.id,
      number: jobs.number,
      description: jobs.description,
      status: jobs.status,
      quantity: jobs.quantity,
      quantityCompleted: jobs.quantityCompleted,
      dueDate: jobs.dueDate,
      itemId: jobs.itemId,
      // Written out in full: in a one-table query the column would not carry its table name.
      operationsDone: sql<number>`(select count(*)::int from job_operations o where o.job_id = "jobs"."id" and o.status = 'done')`,
      operationsTotal: sql<number>`(select count(*)::int from job_operations o where o.job_id = "jobs"."id")`,
      pieces: sql<number>`(select count(*)::int from jobs c where c.parent_job_id = "jobs"."id")`,
    })
    .from(jobs)
    .where(eq(jobs.parentJobId, jobId))
    .orderBy(asc(jobs.number));
}

