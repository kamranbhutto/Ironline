/**
 * Chat on a job between the floor and the office. An alert is a message with a reason
 * ("Machine down", "Drawing issue"…) and is also written to the job's log so the office sees it
 * on the job page.
 */
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client.ts";
import { attachments, jobMessages, jobs, users } from "../db/schema.ts";
import { badRequest, HttpError, notFound, type Ctx } from "../ctx.ts";
import { logEvent } from "./common.ts";

export const ALERT_REASONS = ["Drawing or model issue", "Material problem", "Machine down", "Tooling problem", "Quality concern", "Need a supervisor"] as const;

export const messageSchema = z
  .object({
    kind: z.enum(["message", "alert"]).default("message"),
    body: z.string().trim().max(4000).optional().nullable(),
    reason: z.enum(ALERT_REASONS).optional().nullable(),
    attachmentId: z.uuid().optional().nullable(),
  })
  .refine((m) => (m.kind === "alert" ? !!m.reason : !!m.body || !!m.attachmentId), { message: "Write a message, add a photo, or choose an alert reason" });

async function assertJob(db: Db, ctx: Ctx, jobId: string) {
  const [j] = await db.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, jobId)));
  if (!j) throw notFound("Job");
}

export async function listMessages(db: Db, ctx: Ctx, jobId: string) {
  await assertJob(db, ctx, jobId);
  return db
    .select({
      id: jobMessages.id,
      kind: jobMessages.kind,
      reason: jobMessages.reason,
      body: jobMessages.body,
      attachmentId: jobMessages.attachmentId,
      attachmentName: attachments.fileName,
      createdAt: jobMessages.createdAt,
      userId: jobMessages.userId,
      userName: users.name,
    })
    .from(jobMessages)
    .leftJoin(users, eq(users.id, jobMessages.userId))
    .leftJoin(attachments, eq(attachments.id, jobMessages.attachmentId))
    .where(and(eq(jobMessages.orgId, ctx.orgId), eq(jobMessages.jobId, jobId)))
    .orderBy(asc(jobMessages.createdAt))
    .limit(500);
}

export async function postMessage(db: Db, ctx: Ctx, jobId: string, input: z.infer<typeof messageSchema>) {
  if (ctx.role === "viewer") throw new HttpError(403, "forbidden", "Your role can read the chat but not post in it");
  await assertJob(db, ctx, jobId);
  if (input.attachmentId) {
    // A photo must already belong to this job (uploaded through the job's files).
    const [a] = await db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.id, input.attachmentId), eq(attachments.entity, "job"), eq(attachments.entityId, jobId)));
    if (!a) throw badRequest("That photo is not attached to this job");
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(jobMessages)
      .values({ orgId: ctx.orgId, jobId, userId: ctx.userId, kind: input.kind, reason: input.reason ?? null, body: input.body || null, attachmentId: input.attachmentId ?? null })
      .returning();
    if (input.kind === "alert") await logEvent(tx, ctx, "job", jobId, "alert", { reason: input.reason, note: input.body || undefined });
    return row!;
  });
}
