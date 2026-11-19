import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { materialCost, operationCost, type JobStatus } from "@ironline/shared";
import type { Db, Tx } from "../db/client.ts";
import {
  bomLines,
  customers,
  events,
  users,
  items,
  jobMaterials,
  jobOperations,
  jobs,
  quoteLineMaterials,
  quoteLineOperations,
  routingOperations,
  salesOrderLines,
  salesOrders,
  workCenters,
} from "../db/schema.ts";
import { badRequest, conflict, EDITORS, notFound, requireRole, type Ctx } from "../ctx.ts";
import { like, logEvent, nextNumber } from "./common.ts";
import { copyPlanToJob } from "./quality.ts";

/**
 * Create a job for one sales-order line. Operations and materials come from the quote
 * line it was sold from (what was priced), or else from the item's routing and BOM.
 */
export async function createJobForOrderLine(tx: Tx, ctx: Ctx, salesOrderLineId: string) {
  const [line] = await tx
    .select()
    .from(salesOrderLines)
    .where(and(eq(salesOrderLines.orgId, ctx.orgId), eq(salesOrderLines.id, salesOrderLineId)));
  if (!line) throw notFound("Sales order line");
  const q = line.quantity;

  let ops: { workCenterId: string | null; description: string | null; setupHours: number; runHoursPerUnit: number; rate: number }[] = [];
  let mats: { kind: string; itemId: string | null; description: string; quantityPer: number; unitCost: number; scrapPct: number; perLot: boolean }[] = [];

  if (line.quoteLineId) {
    ops = await tx.select().from(quoteLineOperations).where(eq(quoteLineOperations.quoteLineId, line.quoteLineId)).orderBy(asc(quoteLineOperations.sequence));
    mats = await tx.select().from(quoteLineMaterials).where(eq(quoteLineMaterials.quoteLineId, line.quoteLineId)).orderBy(asc(quoteLineMaterials.sequence));
  }
  // A quote line for a catalogue part with no routing of its own uses the part's routing and BOM.
  if (!ops.length && !mats.length && line.itemId) {
    ops = await tx
      .select({
        workCenterId: routingOperations.workCenterId,
        description: routingOperations.description,
        setupHours: routingOperations.setupHours,
        runHoursPerUnit: routingOperations.runHoursPerUnit,
        rate: workCenters.hourlyRate,
      })
      .from(routingOperations)
      .innerJoin(workCenters, eq(workCenters.id, routingOperations.workCenterId))
      .where(eq(routingOperations.itemId, line.itemId))
      .orderBy(asc(routingOperations.sequence));
    const bom = await tx
      .select({
        itemId: bomLines.componentItemId,
        description: items.description,
        partNumber: items.partNumber,
        type: items.type,
        quantityPer: bomLines.quantityPer,
        unitCost: items.unitCost,
        scrapPct: bomLines.scrapPct,
      })
      .from(bomLines)
      .innerJoin(items, eq(items.id, bomLines.componentItemId))
      .where(eq(bomLines.parentItemId, line.itemId))
      .orderBy(asc(bomLines.sequence));
    mats = bom.map((b) => ({
      kind: b.type === "service" ? "service" : "material",
      itemId: b.itemId,
      description: `${b.partNumber} ${b.description}`,
      quantityPer: b.quantityPer,
      unitCost: b.unitCost,
      scrapPct: b.scrapPct,
      perLot: false,
    }));
  }

  const opCosts = ops.map((o) => operationCost(o, q));
  const matCosts = mats.map((m) => materialCost({ ...m, kind: m.kind as "material" | "service" }, q));
  const estimatedCost = Math.round([...opCosts, ...matCosts].reduce((a, b) => a + b, 0) * 10000) / 10000;

  const number = await nextNumber(tx, ctx.orgId, "job");
  const [job] = await tx
    .insert(jobs)
    .values({
      orgId: ctx.orgId,
      number,
      salesOrderLineId: line.id,
      itemId: line.itemId,
      description: line.description,
      quantity: q,
      dueDate: line.dueDate,
      estimatedCost,
      createdBy: ctx.userId,
    })
    .returning();
  if (ops.length) {
    await tx.insert(jobOperations).values(
      ops.map((o, i) => ({
        orgId: ctx.orgId,
        jobId: job!.id,
        sequence: (i + 1) * 10,
        workCenterId: o.workCenterId,
        description: o.description,
        setupHours: o.setupHours,
        runHoursPerUnit: o.runHoursPerUnit,
        rate: o.rate,
        estimatedCost: opCosts[i]!,
      })),
    );
  }
  if (mats.length) {
    await tx.insert(jobMaterials).values(
      mats.map((m, i) => ({
        orgId: ctx.orgId,
        jobId: job!.id,
        sequence: (i + 1) * 10,
        kind: m.kind,
        itemId: m.itemId,
        description: m.description,
        quantityRequired: m.perLot
          ? m.quantityPer
          : Math.round(m.quantityPer * q * (m.kind === "material" ? 1 + m.scrapPct / 100 : 1) * 10000) / 10000,
        unitCost: m.unitCost,
        estimatedCost: matCosts[i]!,
      })),
    );
  }
  await tx
    .update(salesOrders)
    .set({ status: "in_production", updatedAt: new Date() })
    .where(and(eq(salesOrders.id, line.salesOrderId), eq(salesOrders.status, "confirmed")));
  await copyPlanToJob(tx, ctx, job!.id, line.itemId);
  await logEvent(tx, ctx, "job", job!.id, "created", { number, salesOrderLineId: line.id });
  return job!;
}

export async function createJobFromOrderLine(db: Db, ctx: Ctx, salesOrderLineId: string) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ number: jobs.number })
      .from(jobs)
      .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.salesOrderLineId, salesOrderLineId), sql`${jobs.status} <> 'cancelled'`));
    if (existing.length) throw conflict(`Job ${existing[0]!.number} already exists for this line`);
    return createJobForOrderLine(tx, ctx, salesOrderLineId);
  });
}

export async function listJobs(db: Db, ctx: Ctx, opts: { q?: string; status?: string } = {}) {
  const where = [eq(jobs.orgId, ctx.orgId)];
  if (opts.status === "open") where.push(inArray(jobs.status, ["planned", "released", "in_progress"]));
  else if (opts.status) where.push(eq(jobs.status, opts.status));
  if (opts.q) where.push(or(ilike(jobs.number, like(opts.q)), ilike(jobs.description, like(opts.q)), ilike(customers.name, like(opts.q)))!);
  return db
    .select({
      id: jobs.id,
      number: jobs.number,
      description: jobs.description,
      quantity: jobs.quantity,
      quantityCompleted: jobs.quantityCompleted,
      dueDate: jobs.dueDate,
      priority: jobs.priority,
      status: jobs.status,
      estimatedCost: jobs.estimatedCost,
      actualCost: jobs.actualCost,
      salesOrderId: salesOrders.id,
      salesOrderNumber: salesOrders.number,
      customerName: customers.name,
      operationsDone: sql<number>`(select count(*)::int from job_operations o where o.job_id = ${jobs.id} and o.status = 'done')`,
      operationsTotal: sql<number>`(select count(*)::int from job_operations o where o.job_id = ${jobs.id})`,
    })
    .from(jobs)
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .where(and(...where))
    .orderBy(asc(jobs.dueDate), desc(jobs.priority))
    .limit(500);
}

export async function getJob(db: Db | Tx, ctx: Ctx, id: string) {
  const [job] = await db
    .select({
      job: jobs,
      salesOrderId: salesOrders.id,
      salesOrderNumber: salesOrders.number,
      customerPo: salesOrders.customerPo,
      customerId: customers.id,
      customerName: customers.name,
      unitPrice: salesOrderLines.unitPrice,
      part: { partNumber: items.partNumber, revision: items.revision, name: items.description, type: items.type, uom: items.uom },
    })
    .from(jobs)
    .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
    .leftJoin(salesOrders, eq(salesOrders.id, salesOrderLines.salesOrderId))
    .leftJoin(customers, eq(customers.id, salesOrders.customerId))
    .leftJoin(items, eq(items.id, jobs.itemId))
    .where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id)));
  if (!job) throw notFound("Job");
  const [operations, materials] = await Promise.all([
    db
      .select({ op: jobOperations, workCenterCode: workCenters.code, workCenterName: workCenters.name })
      .from(jobOperations)
      .leftJoin(workCenters, eq(workCenters.id, jobOperations.workCenterId))
      .where(eq(jobOperations.jobId, id))
      .orderBy(asc(jobOperations.sequence)),
    db.select().from(jobMaterials).where(eq(jobMaterials.jobId, id)).orderBy(asc(jobMaterials.sequence)),
  ]);
  const log = await db
    .select({ id: events.id, action: events.action, data: events.data, createdAt: events.createdAt, userName: users.name })
    .from(events)
    .leftJoin(users, eq(users.id, events.userId))
    .where(and(eq(events.orgId, ctx.orgId), eq(events.entity, "job"), eq(events.entityId, id)))
    .orderBy(desc(events.createdAt))
    .limit(200);
  const opEst = operations.reduce((a, o) => a + o.op.estimatedCost, 0);
  const opAct = operations.reduce((a, o) => a + o.op.actualCost, 0);
  const matEst = materials.reduce((a, m) => a + m.estimatedCost, 0);
  const matAct = materials.reduce((a, m) => a + m.issuedCost, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const costs = { laborEstimate: r2(opEst), laborActual: r2(opAct), materialEstimate: r2(matEst), materialActual: r2(matAct) };
  const revenue = job.unitPrice != null ? Math.round(job.unitPrice * job.job.quantity * 100) / 100 : null;
  return {
    ...job.job,
    salesOrderId: job.salesOrderId,
    salesOrderNumber: job.salesOrderNumber,
    customerPo: job.customerPo,
    customerId: job.customerId,
    customerName: job.customerName,
    part: job.part?.partNumber ? job.part : null,
    revenue,
    costs,
    log,
    operations: operations.map((o) => ({ ...o.op, workCenterCode: o.workCenterCode, workCenterName: o.workCenterName })),
    materials,
  };
}

const JOB_FLOW: Record<JobStatus, JobStatus[]> = {
  planned: ["released", "cancelled"],
  released: ["planned", "in_progress", "cancelled"],
  in_progress: ["complete"],
  complete: ["in_progress", "closed"],
  closed: [],
  cancelled: [],
};

export async function setJobStatus(db: Db, ctx: Ctx, id: string, status: JobStatus) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [job] = await tx.select().from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id))).for("update");
    if (!job) throw notFound("Job");
    const from = job.status as JobStatus;
    if (!JOB_FLOW[from].includes(status)) throw conflict(`A ${from.replace("_", " ")} job cannot move to ${status.replace("_", " ")}`);
    if (status === "released") {
      const ops = await tx.select({ id: jobOperations.id }).from(jobOperations).where(eq(jobOperations.jobId, id)).orderBy(asc(jobOperations.sequence));
      if (!ops.length) throw badRequest("Add at least one operation before releasing the job");
      await tx.update(jobOperations).set({ status: "ready" }).where(and(eq(jobOperations.id, ops[0]!.id), eq(jobOperations.status, "pending")));
    }
    if (status === "planned") {
      await tx.update(jobOperations).set({ status: "pending" }).where(and(eq(jobOperations.jobId, id), eq(jobOperations.status, "ready")));
    }
    await tx.update(jobs).set({ status, updatedAt: new Date() }).where(eq(jobs.id, id));
    await logEvent(tx, ctx, "job", id, "status", { from, to: status });
    return getJob(tx, ctx, id);
  });
}

export const jobUpdateSchema = z.object({
  priority: z.coerce.number().int().min(0).max(100).optional(),
  dueDate: z.iso.date().nullable().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
});

export async function updateJob(db: Db, ctx: Ctx, id: string, input: z.infer<typeof jobUpdateSchema>) {
  requireRole(ctx, EDITORS);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(jobs).set({ ...input, updatedAt: new Date() }).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, id))).returning();
    if (!row) throw notFound("Job");
    await logEvent(tx, ctx, "job", id, "updated", input);
    return getJob(tx, ctx, id);
  });
}
