import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db, Tx } from "../db/client.ts";
import { customers, items, jobMaterials, jobOperations, jobs, laborEntries, salesOrderLines, salesOrders, users, workCenters } from "../db/schema.ts";
import { badRequest, conflict, HttpError, notFound, type Ctx } from "../ctx.ts";
import { consumeForJob, lotsForItems, returnFromJob } from "./inventory.ts";
import { onJobComplete, openChildren } from "./subjobs.ts";
import { logEvent } from "./common.ts";
import { refreshOrderForJob } from "./salesOrders.ts";

/** Everyone who works on the floor may use these; viewers may only look. */
const FLOOR_ROLES = ["owner", "admin", "planner", "operator", "quality", "estimator"];
const canWork = (ctx: Ctx) => {
  if (!FLOOR_ROLES.includes(ctx.role)) throw new HttpError(403, "forbidden", "Your role cannot record shop-floor work");
};

export const startSchema = z.object({ kind: z.enum(["setup", "run", "labor"]).default("run") });
export const stopSchema = z.object({
  quantityGood: z.coerce.number().min(0).max(1e9).default(0),
  quantityScrap: z.coerce.number().min(0).max(1e9).default(0),
  scrapReason: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(2000).optional().nullable(),
});
export const countSchema = z
  .object({
    quantityGood: z.coerce.number().min(0).max(1e9).default(0),
    quantityScrap: z.coerce.number().min(0).max(1e9).default(0),
    scrapReason: z.string().trim().max(200).optional().nullable(),
  })
  .refine((v) => v.quantityGood > 0 || v.quantityScrap > 0, "Enter at least one part");
export const reworkSchema = z.object({
  quantity: z.coerce.number().positive().max(1e9),
  reason: z.string().trim().min(1, "Choose a reason").max(200),
});
export const pickSchema = z.object({ quantity: z.coerce.number().refine((n) => n !== 0 && Math.abs(n) < 1e9, "Enter a quantity") });

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Work centers with how many operations are waiting or running at each. */
export async function floorWorkCenters(db: Db, ctx: Ctx) {
  await autoFinish(db, ctx.orgId);
  return db
    .select({
      id: workCenters.id,
      code: workCenters.code,
      name: workCenters.name,
      kind: workCenters.kind,
      queued: sql<number>`(select count(*)::int from job_operations o join jobs j on j.id = o.job_id
        where o.work_center_id = "work_centers"."id" and o.status in ('ready','running') and j.status in ('released','in_progress'))`,
      running: sql<number>`(select count(*)::int from job_operations o where o.work_center_id = "work_centers"."id" and o.status = 'running')`,
    })
    .from(workCenters)
    .where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.active, true)))
    .orderBy(asc(workCenters.code));
}

/** Operations an operator can work on at a work center: ready or running, soonest due first. */
export async function queue(db: Db, ctx: Ctx, workCenterId: string) {
  await autoFinish(db, ctx.orgId);
  return db
    .select({
      id: jobOperations.id,
      sequence: jobOperations.sequence,
      description: jobOperations.description,
      status: jobOperations.status,
      setupHours: jobOperations.setupHours,
      runHoursPerUnit: jobOperations.runHoursPerUnit,
      quantityGood: jobOperations.quantityGood,
      jobId: jobs.id,
      jobNumber: jobs.number,
      jobDescription: jobs.description,
      quantity: jobs.quantity,
      dueDate: jobs.dueDate,
      priority: jobs.priority,
      customerName: customers.name,
      partNumber: items.partNumber,
    })
    .from(jobOperations)
    .innerJoin(jobs, eq(jobs.id, jobOperations.jobId))
    .leftJoin(items, eq(items.id, jobs.itemId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(
      and(
        eq(jobOperations.orgId, ctx.orgId),
        eq(jobOperations.workCenterId, workCenterId),
        inArray(jobOperations.status, ["ready", "running"]),
        inArray(jobs.status, ["released", "in_progress"]),
      ),
    )
    .orderBy(asc(jobs.dueDate), sql`${jobs.priority} desc`, asc(jobOperations.sequence));
}

async function loadOp(tx: Tx, ctx: Ctx, opId: string) {
  const [row] = await tx
    .select({ op: jobOperations, job: jobs })
    .from(jobOperations)
    .innerJoin(jobs, eq(jobs.id, jobOperations.jobId))
    .where(and(eq(jobOperations.orgId, ctx.orgId), eq(jobOperations.id, opId)));
  if (!row) throw notFound("Operation");
  return row;
}

/** Recompute a job's actual cost from operation labor and issued material. */
export async function refreshJobActual(tx: Tx, jobId: string) {
  await tx.execute(sql`
    update jobs set actual_cost = round((
      coalesce((select sum(actual_cost) from job_operations where job_id = ${jobId}), 0) +
      coalesce((select sum(issued_cost) from job_materials where job_id = ${jobId}), 0)
    )::numeric, 4), updated_at = now()
    where id = ${jobId}`);
}

/** Everything the operator screen needs for one operation. */
export async function operationView(db: Db, ctx: Ctx, opId: string) {
  await autoFinish(db, ctx.orgId);
  const { op, job } = await loadOp(db, ctx, opId);
  const [wc] = op.workCenterId ? await db.select().from(workCenters).where(eq(workCenters.id, op.workCenterId)) : [];
  const [entries, materials, allOps, partRow, custRow] = await Promise.all([
    db
      .select({
        id: laborEntries.id,
        kind: laborEntries.kind,
        startedAt: laborEntries.startedAt,
        endedAt: laborEntries.endedAt,
        quantityGood: laborEntries.quantityGood,
        quantityScrap: laborEntries.quantityScrap,
        scrapReason: laborEntries.scrapReason,
        userId: laborEntries.userId,
        userName: users.name,
      })
      .from(laborEntries)
      .innerJoin(users, eq(users.id, laborEntries.userId))
      .where(eq(laborEntries.jobOperationId, opId))
      .orderBy(asc(laborEntries.startedAt)),
    db.select().from(jobMaterials).where(eq(jobMaterials.jobId, job.id)).orderBy(asc(jobMaterials.sequence)),
    db
      .select({ id: jobOperations.id, sequence: jobOperations.sequence, status: jobOperations.status, workCenterCode: workCenters.code, description: jobOperations.description })
      .from(jobOperations)
      .leftJoin(workCenters, eq(workCenters.id, jobOperations.workCenterId))
      .where(eq(jobOperations.jobId, job.id))
      .orderBy(asc(jobOperations.sequence)),
    job.itemId ? db.select({ partNumber: items.partNumber, revision: items.revision, name: items.description }).from(items).where(eq(items.id, job.itemId)) : Promise.resolve([]),
    db
      .select({ name: customers.name, salesOrderNumber: salesOrders.number, customerPo: salesOrders.customerPo })
      .from(salesOrderLines)
      .innerJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
      .innerJoin(customers, eq(customers.id, salesOrders.customerId))
      .where(eq(salesOrderLines.id, job.salesOrderLineId ?? "00000000-0000-0000-0000-000000000000")),
  ]);
  const now = Date.now();
  const secs = (kind: string) =>
    entries.filter((e) => e.kind === kind).reduce((a, e) => a + ((e.endedAt ? e.endedAt.getTime() : now) - e.startedAt.getTime()) / 1000, 0);
  const open = entries.find((e) => !e.endedAt && e.userId === ctx.userId) ?? null;
  return {
    operation: op,
    workCenter: wc ? { id: wc.id, code: wc.code, name: wc.name, atPlannedTime: wc.atPlannedTime } : null,
    job: { id: job.id, number: job.number, description: job.description, quantity: job.quantity, dueDate: job.dueDate, status: job.status, notes: job.notes },
    part: partRow[0] ?? null,
    customerName: custRow[0]?.name ?? null,
    salesOrderNumber: custRow[0]?.salesOrderNumber ?? null,
    customerPo: custRow[0]?.customerPo ?? null,
    estimate: { setupSeconds: op.setupHours * 3600, runSeconds: op.runHoursPerUnit * job.quantity * 3600 },
    // "run" timers are machine time; "labor" timers are hands-on time. Both count against the run estimate.
    actual: {
      setupSeconds: Math.round(secs("setup")),
      runSeconds: Math.round(secs("run") + secs("labor")),
      laborSeconds: Math.round(secs("labor")),
      machineSeconds: Math.round(secs("run")),
    },
    openEntry: open,
    // This person's timers running on other operations, so they can switch to them.
    myOtherRunning: await db
      .select({ operationId: jobOperations.id, jobNumber: jobs.number, workCenterCode: workCenters.code, kind: laborEntries.kind, startedAt: laborEntries.startedAt })
      .from(laborEntries)
      .innerJoin(jobOperations, eq(jobOperations.id, laborEntries.jobOperationId))
      .innerJoin(jobs, eq(jobs.id, jobOperations.jobId))
      .leftJoin(workCenters, eq(workCenters.id, jobOperations.workCenterId))
      .where(and(eq(laborEntries.orgId, ctx.orgId), eq(laborEntries.userId, ctx.userId), isNull(laborEntries.endedAt), ne(laborEntries.jobOperationId, opId)))
      .orderBy(asc(laborEntries.startedAt)),
    othersRunning: entries.filter((e) => !e.endedAt && e.userId !== ctx.userId).map((e) => e.userName),
    entries,
    // Each material with the lots it can be picked from (oldest first).
    materials: await (async () => {
      const lots = await lotsForItems(db, ctx, materials.map((m) => m.itemId).filter((v): v is string => !!v));
      return materials.map((m) => ({ ...m, lots: m.itemId ? lots.filter((l) => l.itemId === m.itemId) : [] }));
    })(),
    route: allOps,
  };
}

async function closeOpen(tx: Tx, ctx: Ctx, where: ReturnType<typeof and>, extra: Partial<z.infer<typeof stopSchema>> = {}, endAt?: Date) {
  const open = await tx.select().from(laborEntries).where(and(eq(laborEntries.orgId, ctx.orgId), isNull(laborEntries.endedAt), where));
  for (const e of open) {
    const end = endAt ?? new Date();
    const hours = (end.getTime() - e.startedAt.getTime()) / 3_600_000;
    await tx
      .update(laborEntries)
      .set({ endedAt: end, quantityGood: extra.quantityGood ?? 0, quantityScrap: extra.quantityScrap ?? 0, scrapReason: extra.scrapReason ?? null, note: extra.note ?? null })
      .where(eq(laborEntries.id, e.id));
    await tx
      .update(jobOperations)
      .set({
        actualHours: sql`round((${jobOperations.actualHours} + ${hours})::numeric, 4)`,
        actualCost: sql`round((${jobOperations.actualCost} + ${hours * e.rate})::numeric, 4)`,
        quantityGood: sql`${jobOperations.quantityGood} + ${extra.quantityGood ?? 0}`,
        quantityScrap: sql`${jobOperations.quantityScrap} + ${extra.quantityScrap ?? 0}`,
      })
      .where(eq(jobOperations.id, e.jobOperationId));
    const [o] = await tx.select({ jobId: jobOperations.jobId }).from(jobOperations).where(eq(jobOperations.id, e.jobOperationId));
    await refreshJobActual(tx, o!.jobId);
    const stillOpen = await tx
      .select({ id: laborEntries.id })
      .from(laborEntries)
      .where(and(eq(laborEntries.jobOperationId, e.jobOperationId), isNull(laborEntries.endedAt)));
    if (!stillOpen.length) {
      await tx.update(jobOperations).set({ status: "ready" }).where(and(eq(jobOperations.id, e.jobOperationId), eq(jobOperations.status, "running")));
    }
  }
  return open.length;
}

export async function startTimer(db: Db, ctx: Ctx, opId: string, kind: "setup" | "run" | "labor") {
  canWork(ctx);
  return db.transaction(async (tx) => {
    const { op, job } = await loadOp(tx, ctx, opId);
    if (!["released", "in_progress"].includes(job.status)) throw conflict("Release the job before starting work on it");
    if (!["ready", "running"].includes(op.status)) {
      const waiting = await openChildren(tx, job.id);
      if (waiting.length && op.status === "pending") throw conflict(`Waiting for the pieces: ${waiting.map((w) => w.number).join(", ")} must be finished first`);
      throw conflict(op.status === "done" ? "This operation is already complete" : "This operation is not ready yet — the previous step is still open");
    }
    // Work cannot start on the job's first step until its material is picked: every material line
    // fully issued (the same rule as the "Material not picked" mark on the board).
    const [first] = await tx.select({ id: jobOperations.id }).from(jobOperations).where(eq(jobOperations.jobId, job.id)).orderBy(asc(jobOperations.sequence)).limit(1);
    if (first?.id === op.id) {
      const short = await tx
        .select({ description: jobMaterials.description, required: jobMaterials.quantityRequired, issued: jobMaterials.quantityIssued })
        .from(jobMaterials)
        .where(and(eq(jobMaterials.jobId, job.id), eq(jobMaterials.kind, "material"), sql`${jobMaterials.quantityIssued} < ${jobMaterials.quantityRequired}`));
      if (short.length) {
        throw conflict(`Pick the material before starting: ${short.map((m) => `${m.description} (${m.issued} of ${m.required} picked)`).join(", ")}`);
      }
    }
    // One person may run several machines or jobs at once (each timer costs its own work
    // center). Only this person's open timer on this same operation is closed, e.g. when
    // switching from setup to run.
    await closeOpen(tx, ctx, and(eq(laborEntries.userId, ctx.userId), eq(laborEntries.jobOperationId, opId)));
    await tx.insert(laborEntries).values({ orgId: ctx.orgId, jobOperationId: opId, userId: ctx.userId, kind, rate: op.rate });
    await tx.update(jobOperations).set({ status: "running" }).where(eq(jobOperations.id, opId));
    if (job.status === "released") await tx.update(jobs).set({ status: "in_progress", updatedAt: new Date() }).where(eq(jobs.id, job.id));
    await logEvent(tx, ctx, "job", job.id, "timer_started", { operation: op.sequence, kind });
  });
}

export async function stopTimer(db: Db, ctx: Ctx, opId: string, input: z.infer<typeof stopSchema>) {
  canWork(ctx);
  return db.transaction(async (tx) => {
    const { op, job } = await loadOp(tx, ctx, opId);
    const n = await closeOpen(tx, ctx, and(eq(laborEntries.userId, ctx.userId), eq(laborEntries.jobOperationId, opId)), input);
    if (!n) throw badRequest("You have no timer running on this operation");
    await logEvent(tx, ctx, "job", job.id, "timer_stopped", { operation: op.sequence, good: input.quantityGood, scrap: input.quantityScrap, reason: input.scrapReason ?? undefined });
  });
}

export async function completeOperation(db: Db, ctx: Ctx, opId: string, input: z.infer<typeof stopSchema>) {
  canWork(ctx);
  return db.transaction((tx) => finishStep(tx, ctx, opId, input));
}

/** Close the step's timers, mark it done, make the next step ready, and finish the job after the last step. */
async function finishStep(tx: Tx, ctx: Ctx, opId: string, input: z.infer<typeof stopSchema>) {
  {
    const { op, job } = await loadOp(tx, ctx, opId);
    if (op.status === "done") throw conflict("This operation is already complete");
    if (!["released", "in_progress"].includes(job.status)) throw conflict("Release the job before completing operations");
    const closed = await closeOpen(tx, ctx, eq(laborEntries.jobOperationId, opId), input);
    if (!closed && (input.quantityGood || input.quantityScrap)) {
      await tx
        .update(jobOperations)
        .set({ quantityGood: sql`${jobOperations.quantityGood} + ${input.quantityGood}`, quantityScrap: sql`${jobOperations.quantityScrap} + ${input.quantityScrap}` })
        .where(eq(jobOperations.id, opId));
    }
    await tx.update(jobOperations).set({ status: "done" }).where(eq(jobOperations.id, opId));
    const [done] = await tx.select().from(jobOperations).where(eq(jobOperations.id, opId));
    const ops = await tx.select().from(jobOperations).where(eq(jobOperations.jobId, job.id)).orderBy(asc(jobOperations.sequence));
    const next = ops.find((o) => o.sequence > op.sequence && o.status === "pending");
    if (next) {
      await tx.update(jobOperations).set({ status: "ready" }).where(eq(jobOperations.id, next.id));
    }
    const allDone = ops.every((o) => o.id === opId || o.status === "done");
    if (allDone) {
      await tx.update(jobs).set({ status: "complete", quantityCompleted: done!.quantityGood, updatedAt: new Date() }).where(eq(jobs.id, job.id));
    } else if (job.status === "released") {
      await tx.update(jobs).set({ status: "in_progress", updatedAt: new Date() }).where(eq(jobs.id, job.id));
    }
    await logEvent(tx, ctx, "job", job.id, "operation_done", { operation: op.sequence, good: done!.quantityGood, scrap: done!.quantityScrap, next: next?.sequence });
    if (allDone) {
      await onJobComplete(tx, ctx, job.id);
      await refreshOrderForJob(tx, ctx, job.id);
    }
    return { nextOperationId: next?.id ?? null, jobComplete: allDone };
  }
}

/**
 * Timers that have reached their planned time at work centers set to stop or finish there.
 * Setup timers stop at the planned setup time. Run, labor and machine timers stop at the planned
 * run time (run hours per piece × job quantity, all people together); at "complete" work centers
 * the step is then finished with the rest of the job's pieces counted good. The timer ends at the
 * exact moment the plan ran out, so it is right even when checked later. Returns how many ended.
 */
export async function autoFinish(db: Db, orgId?: string) {
  const rows = await db
    .select({ entryId: laborEntries.id, opId: jobOperations.id, kind: laborEntries.kind, mode: workCenters.atPlannedTime })
    .from(laborEntries)
    .innerJoin(jobOperations, eq(jobOperations.id, laborEntries.jobOperationId))
    .innerJoin(workCenters, eq(workCenters.id, jobOperations.workCenterId))
    .where(and(isNull(laborEntries.endedAt), inArray(workCenters.atPlannedTime, ["stop", "complete"]), orgId ? eq(laborEntries.orgId, orgId) : undefined));
  let ended = 0;
  for (const r of rows) {
    await db.transaction(async (tx) => {
      const [me] = await tx.select().from(laborEntries).where(and(eq(laborEntries.id, r.entryId), isNull(laborEntries.endedAt)));
      if (!me) return;
      const ctx: Ctx = { orgId: me.orgId, userId: me.userId, role: "operator" };
      const { op, job } = await loadOp(tx, ctx, r.opId);
      const setup = r.kind === "setup";
      const planned = (setup ? op.setupHours : op.runHoursPerUnit * job.quantity) * 3600;
      if (!(planned > 0)) return;
      const all = await tx.select().from(laborEntries).where(and(eq(laborEntries.jobOperationId, op.id), inArray(laborEntries.kind, setup ? ["setup"] : ["run", "labor"])));
      const now = Date.now();
      const used = (e: typeof me) => ((e.endedAt ? e.endedAt.getTime() : now) - e.startedAt.getTime()) / 1000;
      const before = all.filter((e) => e.id !== me.id).reduce((a, e) => a + used(e), 0);
      if (before + used(me) < planned) return;
      const endAt = new Date(Math.min(now, me.startedAt.getTime() + Math.max(0, planned - before) * 1000));
      const finish = r.mode === "complete" && !setup && ["released", "in_progress"].includes(job.status) && op.status !== "done";
      const remaining = Math.max(0, job.quantity - op.quantityGood);
      await closeOpen(tx, ctx, eq(laborEntries.id, me.id), finish ? { quantityGood: remaining } : {}, endAt);
      ended++;
      if (finish) {
        await finishStep(tx, ctx, op.id, { quantityGood: 0, quantityScrap: 0 });
        await logEvent(tx, ctx, "job", job.id, "operation_auto_done", { operation: op.sequence, good: remaining });
      } else {
        await logEvent(tx, ctx, "job", job.id, "timer_auto_stopped", { operation: op.sequence, kind: r.kind });
      }
    });
  }
  return ended;
}

/** Count finished or scrapped parts while the timer keeps running. */
export async function countParts(db: Db, ctx: Ctx, opId: string, input: z.infer<typeof countSchema>) {
  canWork(ctx);
  return db.transaction(async (tx) => {
    const { op, job } = await loadOp(tx, ctx, opId);
    if (op.status === "done") throw conflict("This operation is already complete");
    if (!["released", "in_progress"].includes(job.status)) throw conflict("Release the job before recording parts");
    await tx
      .update(jobOperations)
      .set({ quantityGood: sql`${jobOperations.quantityGood} + ${input.quantityGood}`, quantityScrap: sql`${jobOperations.quantityScrap} + ${input.quantityScrap}` })
      .where(eq(jobOperations.id, opId));
    await logEvent(tx, ctx, "job", job.id, "parts_counted", {
      operation: op.sequence,
      good: input.quantityGood || undefined,
      scrap: input.quantityScrap || undefined,
      reason: input.scrapReason ?? undefined,
    });
  });
}

/** Send parts back for rework at this operation, with the reason. */
export async function reworkParts(db: Db, ctx: Ctx, opId: string, input: z.infer<typeof reworkSchema>) {
  canWork(ctx);
  return db.transaction(async (tx) => {
    const { op, job } = await loadOp(tx, ctx, opId);
    await tx.update(jobOperations).set({ quantityRework: sql`${jobOperations.quantityRework} + ${input.quantity}` }).where(eq(jobOperations.id, opId));
    await logEvent(tx, ctx, "job", job.id, "rework", { operation: op.sequence, quantity: input.quantity, reason: input.reason });
  });
}

/** Issue material to a job (negative quantity returns it). Stock locations arrive with Inventory. */
export async function pickMaterial(db: Db, ctx: Ctx, jobMaterialId: string, quantity: number) {
  canWork(ctx);
  return db.transaction(async (tx) => {
    const [m] = await tx.select().from(jobMaterials).where(and(eq(jobMaterials.orgId, ctx.orgId), eq(jobMaterials.id, jobMaterialId))).for("update");
    if (!m) throw notFound("Material");
    const issued = r4(m.quantityIssued + quantity);
    if (issued < 0) throw badRequest(`Only ${m.quantityIssued} has been picked, so at most that can be returned`);
    // Draw from stock (oldest lots first) or put back where it came from; never blocks the floor.
    const cost = quantity > 0 ? await consumeForJob(tx, ctx, m, quantity) : -(await returnFromJob(tx, ctx, m, -quantity));
    await tx
      .update(jobMaterials)
      .set({ quantityIssued: issued, issuedCost: issued === 0 ? 0 : r4(Math.max(0, m.issuedCost + cost)) })
      .where(eq(jobMaterials.id, m.id));
    await refreshJobActual(tx, m.jobId);
    await logEvent(tx, ctx, "job", m.jobId, quantity > 0 ? "material_picked" : "material_returned", { material: m.description, quantity: Math.abs(quantity) });
    return { quantityIssued: issued };
  });
}

/** Add working days (Mon–Fri) to today; fractional days round up. */
function finishDate(days: number) {
  const d = new Date();
  let left = Math.ceil(days);
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Schedule board: one column per work center with its open operations in run order
 * (due date, then priority), remaining hours, and a finish date from daily capacity.
 */
export async function board(db: Db, ctx: Ctx) {
  await autoFinish(db, ctx.orgId);
  const wcs = await db.select().from(workCenters).where(and(eq(workCenters.orgId, ctx.orgId), eq(workCenters.active, true))).orderBy(asc(workCenters.code));
  const rows = await db
    .select({
      id: jobOperations.id,
      workCenterId: jobOperations.workCenterId,
      sequence: jobOperations.sequence,
      description: jobOperations.description,
      status: jobOperations.status,
      setupHours: jobOperations.setupHours,
      runHoursPerUnit: jobOperations.runHoursPerUnit,
      actualHours: jobOperations.actualHours,
      quantityGood: jobOperations.quantityGood,
      jobId: jobs.id,
      jobNumber: jobs.number,
      jobStatus: jobs.status,
      quantity: jobs.quantity,
      dueDate: jobs.dueDate,
      priority: jobs.priority,
      customerName: customers.name,
      partNumber: items.partNumber,
      setupLogged: sql<number>`(select count(*)::int from labor_entries l where l.job_operation_id = ${jobOperations.id} and l.kind = 'setup')`,
      materialShort: sql<boolean>`exists(select 1 from job_materials m where m.job_id = ${jobs.id} and m.kind = 'material' and m.quantity_issued < m.quantity_required)`,
      piecesOpen: sql<number>`(select count(*)::int from jobs c where c.parent_job_id = ${jobs.id} and c.status not in ('complete', 'closed', 'cancelled'))`,
    })
    .from(jobOperations)
    .innerJoin(jobs, eq(jobs.id, jobOperations.jobId))
    .leftJoin(items, eq(items.id, jobs.itemId))
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(eq(jobOperations.orgId, ctx.orgId), inArray(jobOperations.status, ["pending", "ready", "running"]), inArray(jobs.status, ["planned", "released", "in_progress"])))
    .orderBy(asc(jobs.dueDate), sql`${jobs.priority} desc`, asc(jobOperations.sequence));
  const today = new Date().toISOString().slice(0, 10);
  const cards = rows.map((r) => {
    const planned = r.setupHours + r.runHoursPerUnit * r.quantity;
    const remainingHours = Math.max(0, Math.round((planned - r.actualHours) * 100) / 100);
    const state =
      r.jobStatus === "planned" ? "planned"
      : r.status === "running" ? "running"
      : r.status === "pending" ? (r.piecesOpen > 0 ? "pieces" : "waiting")
      : r.actualHours > 0 ? "paused"
      : r.setupHours > 0 && !r.setupLogged ? "setup_pending"
      : "ready";
    return { ...r, remainingHours, state, late: !!r.dueDate && r.dueDate < today };
  });
  const columns = wcs.map((w) => {
    const list = cards.filter((c) => c.workCenterId === w.id);
    const backlogHours = Math.round(list.reduce((a, c) => a + c.remainingHours, 0) * 10) / 10;
    return {
      id: w.id,
      code: w.code,
      name: w.name,
      capacityHoursPerDay: w.capacityHoursPerDay,
      backlogHours,
      finishDate: backlogHours && w.capacityHoursPerDay > 0 ? finishDate(backlogHours / w.capacityHoursPerDay) : null,
      cards: list,
    };
  });
  const lateCount = new Set(cards.filter((c) => c.late).map((c) => c.jobId)).size;
  const jobCount = new Set(cards.map((c) => c.jobId)).size;
  return { columns, latePct: jobCount ? Math.round((lateCount / jobCount) * 100) : 0, updatedAt: new Date().toISOString() };
}
