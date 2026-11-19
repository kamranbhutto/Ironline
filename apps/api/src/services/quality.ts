/**
 * Quality: inspection plans (numbered balloons on a part's drawing), the copy of that plan on
 * each job, and the readings the floor records against it.
 */
import { capability, CHARACTERISTIC_KINDS, inTolerance, limitsOf, piecesToCheck, SAMPLING, type Sampling } from "@ironline/shared";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db/client.ts";
import { attachments, inspectionCharacteristics, inspectionResults, items, jobCharacteristics, jobOperations, jobs, users, workCenters } from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { logEvent } from "./common.ts";

const PLANNERS = [...EDITORS, "quality" as const];
const RECORDERS = [...PLANNERS, "operator" as const];

const num = z.number().finite().nullable().optional();
const characteristicSchema = z.object({
  number: z.number().int().min(1).max(9999),
  kind: z.enum(CHARACTERISTIC_KINDS),
  attachmentId: z.uuid().nullable().optional(),
  page: z.number().int().min(1).max(9999).default(1),
  x: z.number().min(0).max(1).nullable().optional(),
  y: z.number().min(0).max(1).nullable().optional(),
  nominal: num,
  tolPlus: z.number().finite().min(0).nullable().optional(),
  tolMinus: z.number().finite().min(0).nullable().optional(),
  unit: z.string().trim().max(12).default("mm"),
  datums: z.string().trim().max(40).nullable().optional(),
  requirement: z.string().trim().max(1000).nullable().optional(),
  operationSeq: z.number().int().min(1).nullable().optional(),
  sampling: z.enum(SAMPLING).default("first"),
  everyN: z.number().int().min(1).max(100000).nullable().optional(),
  gauge: z.string().trim().max(80).nullable().optional(),
  critical: z.boolean().default(false),
});
export const planSchema = z
  .object({ characteristics: z.array(characteristicSchema).max(500) })
  .refine((p) => new Set(p.characteristics.map((c) => c.number)).size === p.characteristics.length, { message: "Each balloon needs its own number" })
  .refine((p) => p.characteristics.every((c) => c.sampling !== "every_n" || (c.everyN ?? 0) >= 1), { message: "Say how often to check (every N pieces)" })
  .refine((p) => p.characteristics.every((c) => c.kind === "note" || c.nominal != null), { message: "Every measured balloon needs a target value" });
export type PlanInput = z.infer<typeof planSchema>;

const charCols = {
  id: inspectionCharacteristics.id,
  number: inspectionCharacteristics.number,
  kind: inspectionCharacteristics.kind,
  attachmentId: inspectionCharacteristics.attachmentId,
  page: inspectionCharacteristics.page,
  x: inspectionCharacteristics.x,
  y: inspectionCharacteristics.y,
  nominal: inspectionCharacteristics.nominal,
  tolPlus: inspectionCharacteristics.tolPlus,
  tolMinus: inspectionCharacteristics.tolMinus,
  unit: inspectionCharacteristics.unit,
  datums: inspectionCharacteristics.datums,
  requirement: inspectionCharacteristics.requirement,
  operationSeq: inspectionCharacteristics.operationSeq,
  sampling: inspectionCharacteristics.sampling,
  everyN: inspectionCharacteristics.everyN,
  gauge: inspectionCharacteristics.gauge,
  critical: inspectionCharacteristics.critical,
};

async function assertItem(db: Db | Tx, ctx: Ctx, itemId: string) {
  const [it] = await db.select({ id: items.id }).from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId)));
  if (!it) throw notFound("Item");
}

export async function getPlan(db: Db, ctx: Ctx, itemId: string) {
  await assertItem(db, ctx, itemId);
  return db
    .select(charCols)
    .from(inspectionCharacteristics)
    .where(and(eq(inspectionCharacteristics.orgId, ctx.orgId), eq(inspectionCharacteristics.itemId, itemId)))
    .orderBy(asc(inspectionCharacteristics.number));
}

export async function savePlan(db: Db, ctx: Ctx, itemId: string, input: PlanInput) {
  requireRole(ctx, PLANNERS);
  await db.transaction(async (tx) => {
    await assertItem(tx, ctx, itemId);
    // A balloon may only sit on a drawing attached to this part.
    const fileIds = [...new Set(input.characteristics.map((c) => c.attachmentId).filter((v): v is string => !!v))];
    if (fileIds.length) {
      const ok = await tx
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entity, "item"), eq(attachments.entityId, itemId), inArray(attachments.id, fileIds)));
      if (ok.length !== fileIds.length) throw badRequest("A balloon points at a drawing that is not attached to this part");
    }
    await tx.delete(inspectionCharacteristics).where(and(eq(inspectionCharacteristics.orgId, ctx.orgId), eq(inspectionCharacteristics.itemId, itemId)));
    if (input.characteristics.length) {
      await tx.insert(inspectionCharacteristics).values(
        input.characteristics.map((c) => ({
          ...c,
          everyN: c.sampling === "every_n" ? c.everyN : null,
          nominal: c.kind === "note" ? null : c.nominal,
          orgId: ctx.orgId,
          itemId,
        })),
      );
    }
    await logEvent(tx, ctx, "item", itemId, "inspection_plan_saved", { balloons: input.characteristics.length });
  });
  return getPlan(db, ctx, itemId);
}

/** Copy the part's current plan onto a job. Used when the job is made and from the job page. */
export async function copyPlanToJob(tx: Tx, ctx: Ctx, jobId: string, itemId: string | null) {
  if (!itemId) return 0;
  const plan = await tx
    .select(charCols)
    .from(inspectionCharacteristics)
    .where(and(eq(inspectionCharacteristics.orgId, ctx.orgId), eq(inspectionCharacteristics.itemId, itemId)))
    .orderBy(asc(inspectionCharacteristics.number));
  if (!plan.length) return 0;
  await tx.insert(jobCharacteristics).values(plan.map(({ id: _id, ...c }) => ({ ...c, orgId: ctx.orgId, jobId })));
  return plan.length;
}

async function jobRow(db: Db | Tx, ctx: Ctx, jobId: string) {
  const [j] = await db
    .select({ id: jobs.id, number: jobs.number, itemId: jobs.itemId, quantity: jobs.quantity, description: jobs.description })
    .from(jobs)
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, jobId)));
  if (!j) throw notFound("Job");
  return j;
}

/** Replace the job's plan with the part's current plan. Refused once readings exist. */
export async function refreshJobPlan(db: Db, ctx: Ctx, jobId: string) {
  requireRole(ctx, PLANNERS);
  await db.transaction(async (tx) => {
    const j = await jobRow(tx, ctx, jobId);
    const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(inspectionResults).where(eq(inspectionResults.jobId, jobId));
    if ((r?.n ?? 0) > 0) throw conflict("This job already has readings, so its inspection plan is locked");
    await tx.delete(jobCharacteristics).where(eq(jobCharacteristics.jobId, jobId));
    const n = await copyPlanToJob(tx, ctx, jobId, j.itemId);
    if (!n) throw badRequest("The part has no inspection plan yet. Add balloons on the part's Inspection plan tab first.");
    await logEvent(tx, ctx, "job", jobId, "inspection_plan_copied", { balloons: n });
  });
  return jobInspection(db, ctx, jobId);
}

/** Everything the job's Quality tab, the operator screen and the report need. */
export async function jobInspection(db: Db, ctx: Ctx, jobId: string) {
  const j = await jobRow(db, ctx, jobId);
  const [chars, results, ops, partRow] = await Promise.all([
    db.select().from(jobCharacteristics).where(and(eq(jobCharacteristics.orgId, ctx.orgId), eq(jobCharacteristics.jobId, jobId))).orderBy(asc(jobCharacteristics.number)),
    db
      .select({
        id: inspectionResults.id,
        characteristicId: inspectionResults.characteristicId,
        piece: inspectionResults.piece,
        value: inspectionResults.value,
        passed: inspectionResults.passed,
        gauge: inspectionResults.gauge,
        recordedAt: inspectionResults.recordedAt,
        userName: users.name,
      })
      .from(inspectionResults)
      .leftJoin(users, eq(users.id, inspectionResults.userId))
      .where(and(eq(inspectionResults.orgId, ctx.orgId), eq(inspectionResults.jobId, jobId)))
      .orderBy(asc(inspectionResults.piece)),
    db
      .select({ id: jobOperations.id, sequence: jobOperations.sequence, description: jobOperations.description, workCenter: workCenters.name, status: jobOperations.status })
      .from(jobOperations)
      .leftJoin(workCenters, eq(workCenters.id, jobOperations.workCenterId))
      .where(eq(jobOperations.jobId, jobId))
      .orderBy(asc(jobOperations.sequence)),
    j.itemId
      ? db.select({ partNumber: items.partNumber, revision: items.revision, description: items.description }).from(items).where(eq(items.id, j.itemId))
      : Promise.resolve([]),
  ]);
  const [partPlan] = j.itemId
    ? await db.select({ n: sql<number>`count(*)::int` }).from(inspectionCharacteristics).where(eq(inspectionCharacteristics.itemId, j.itemId))
    : [{ n: 0 }];

  const characteristics = chars.map((c) => {
    const mine = results.filter((r) => r.characteristicId === c.id);
    const values = mine.map((r) => r.value).filter((v): v is number => v != null);
    // A balloon with no step, or a step this job does not have (its routing came from the
    // quote), is checked at the job's last operation.
    const op = ops.find((o) => o.sequence === c.operationSeq) ?? ops.at(-1);
    const due = piecesToCheck(c.sampling as Sampling, c.everyN, j.quantity);
    return {
      ...c,
      ...limitsOf(c),
      operation: op ? { sequence: op.sequence, workCenter: op.workCenter, description: op.description } : null,
      due,
      ...capability(c, values),
      failures: mine.filter((r) => r.passed === false).length,
      done: mine.length,
    };
  });
  return {
    job: { id: j.id, number: j.number, quantity: j.quantity, description: j.description },
    part: partRow[0] ?? null,
    partPlanCount: partPlan?.n ?? 0,
    characteristics,
    results,
    operations: ops,
  };
}

export const readingsSchema = z.object({
  piece: z.number().int().min(1).max(1_000_000),
  readings: z
    .array(
      z.object({
        characteristicId: z.uuid(),
        value: z.number().finite().nullable().optional(),
        passed: z.boolean().nullable().optional(),
        gauge: z.string().trim().max(80).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

/** Save readings for one piece. An empty reading (no value and no pass/fail) removes the earlier one. */
export async function recordReadings(db: Db, ctx: Ctx, jobId: string, input: z.infer<typeof readingsSchema>) {
  requireRole(ctx, RECORDERS);
  const j = await jobRow(db, ctx, jobId);
  if (input.piece > Math.max(1, Math.ceil(j.quantity))) throw badRequest(`This job makes ${j.quantity} pieces`);
  const ids = input.readings.map((r) => r.characteristicId);
  const chars = await db.select().from(jobCharacteristics).where(and(eq(jobCharacteristics.jobId, jobId), inArray(jobCharacteristics.id, ids)));
  if (chars.length !== new Set(ids).size) throw badRequest("A reading points at a balloon that is not on this job");
  let failed = 0;
  await db.transaction(async (tx) => {
    for (const r of input.readings) {
      const c = chars.find((x) => x.id === r.characteristicId)!;
      const empty = r.value == null && r.passed == null;
      if (empty) {
        await tx.delete(inspectionResults).where(and(eq(inspectionResults.characteristicId, c.id), eq(inspectionResults.piece, input.piece)));
        continue;
      }
      if (c.kind !== "note" && r.value == null) throw badRequest(`Balloon ${c.number} needs a measured value`);
      // The server decides pass/fail for numbers so a client cannot mark a bad part good.
      const passed = c.kind === "note" ? (r.passed ?? null) : inTolerance(c, r.value);
      if (passed === false) failed += 1;
      const values = {
        orgId: ctx.orgId,
        jobId,
        characteristicId: c.id,
        piece: input.piece,
        value: c.kind === "note" ? null : r.value!,
        passed,
        gauge: r.gauge || c.gauge || null,
        userId: ctx.userId,
        recordedAt: new Date(),
      };
      await tx
        .insert(inspectionResults)
        .values(values)
        .onConflictDoUpdate({ target: [inspectionResults.characteristicId, inspectionResults.piece], set: { value: values.value, passed, gauge: values.gauge, userId: ctx.userId, recordedAt: values.recordedAt } });
    }
    if (failed) await logEvent(tx, ctx, "job", jobId, "inspection_failed", { piece: input.piece, count: failed });
  });
  return jobInspection(db, ctx, jobId);
}

/** Shop-wide quality picture for the Quality page. */
export async function overview(db: Db, ctx: Ctx) {
  const weekAgo = new Date(Date.now() - 7 * 864e5);
  const [plans, counts, failures, active] = await Promise.all([
    db
      .select({
        itemId: items.id,
        partNumber: items.partNumber,
        revision: items.revision,
        description: items.description,
        balloons: sql<number>`count(*)::int`,
        critical: sql<number>`count(*) filter (where ${inspectionCharacteristics.critical})::int`,
      })
      .from(inspectionCharacteristics)
      .innerJoin(items, eq(items.id, inspectionCharacteristics.itemId))
      .where(eq(inspectionCharacteristics.orgId, ctx.orgId))
      .groupBy(items.id)
      .orderBy(asc(items.partNumber)),
    db
      .select({
        week: sql<number>`count(*) filter (where ${inspectionResults.recordedAt} >= ${weekAgo})::int`,
        weekFailed: sql<number>`count(*) filter (where ${inspectionResults.recordedAt} >= ${weekAgo} and ${inspectionResults.passed} = false)::int`,
        total: sql<number>`count(*)::int`,
        totalFailed: sql<number>`count(*) filter (where ${inspectionResults.passed} = false)::int`,
      })
      .from(inspectionResults)
      .where(eq(inspectionResults.orgId, ctx.orgId)),
    db
      .select({
        id: inspectionResults.id,
        jobId: jobs.id,
        jobNumber: jobs.number,
        number: jobCharacteristics.number,
        kind: jobCharacteristics.kind,
        nominal: jobCharacteristics.nominal,
        tolPlus: jobCharacteristics.tolPlus,
        tolMinus: jobCharacteristics.tolMinus,
        unit: jobCharacteristics.unit,
        requirement: jobCharacteristics.requirement,
        piece: inspectionResults.piece,
        value: inspectionResults.value,
        recordedAt: inspectionResults.recordedAt,
        userName: users.name,
      })
      .from(inspectionResults)
      .innerJoin(jobCharacteristics, eq(jobCharacteristics.id, inspectionResults.characteristicId))
      .innerJoin(jobs, eq(jobs.id, inspectionResults.jobId))
      .leftJoin(users, eq(users.id, inspectionResults.userId))
      .where(and(eq(inspectionResults.orgId, ctx.orgId), eq(inspectionResults.passed, false)))
      .orderBy(desc(inspectionResults.recordedAt))
      .limit(50),
    db
      .select({
        jobId: jobs.id,
        jobNumber: jobs.number,
        description: jobs.description,
        status: jobs.status,
        quantity: jobs.quantity,
        balloons: sql<number>`count(distinct ${jobCharacteristics.id})::int`,
        readings: sql<number>`count(${inspectionResults.id})::int`,
        failed: sql<number>`count(${inspectionResults.id}) filter (where ${inspectionResults.passed} = false)::int`,
      })
      .from(jobCharacteristics)
      .innerJoin(jobs, eq(jobs.id, jobCharacteristics.jobId))
      .leftJoin(inspectionResults, eq(inspectionResults.characteristicId, jobCharacteristics.id))
      .where(and(eq(jobCharacteristics.orgId, ctx.orgId), inArray(jobs.status, ["planned", "released", "in_progress", "complete"])))
      .groupBy(jobs.id)
      .orderBy(desc(jobs.number))
      .limit(50),
  ]);
  return { plans, counts: counts[0]!, failures: failures.map((f) => ({ ...f, ...limitsOf(f) })), active };
}
