import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, extname } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attachments, customers, items, jobs, quoteLines, quotes, salesOrderLines, salesOrders, stockLots, users } from "../db/schema.ts";
import { badRequest, EDITORS, HttpError, notFound, requireRole, type Ctx } from "../ctx.ts";
import { logEvent } from "./common.ts";
import { createPreviewQueue, needsPreview, previewPath, type PreviewQueue } from "./previews.ts";

export const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(process.cwd(), "uploads");
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
export const ENTITIES = ["item", "job", "quote", "customer", "sales_order", "stock_lot"] as const;
export type Entity = (typeof ENTITIES)[number];

let previews: PreviewQueue | null = null;
/** Start the background 3D preparation queue (once per process). */
export function initPreviews(db: Db, log?: (msg: string) => void) {
  previews ??= createPreviewQueue(db, UPLOAD_DIR, log);
  return previews;
}

const TABLES = { item: items, job: jobs, quote: quotes, customer: customers, sales_order: salesOrders, stock_lot: stockLots } as const;

/** What kind of viewer the browser should use. */
export function fileKind(name: string, mime: string) {
  const ext = extname(name).toLowerCase();
  if ([".step", ".stp", ".iges", ".igs", ".brep"].includes(ext)) return "cad";
  if ([".stl", ".obj", ".glb", ".gltf", ".3mf", ".ply"].includes(ext)) return "mesh";
  if (ext === ".dxf") return "dxf";
  if (ext === ".pdf" || mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  return "other";
}

async function assertEntity(db: Db, ctx: Ctx, entity: Entity, entityId: string) {
  const t = TABLES[entity];
  const [row] = await db.select({ id: t.id }).from(t).where(and(eq(t.orgId, ctx.orgId), eq(t.id, entityId)));
  if (!row) throw notFound("Record");
}

export async function saveUpload(db: Db, ctx: Ctx, entity: Entity, entityId: string, file: { filename: string; mimetype: string; file: Readable & { truncated?: boolean } }) {
  requireRole(ctx, [...EDITORS, "operator", "quality", "purchasing"]);
  await assertEntity(db, ctx, entity, entityId);
  const name = file.filename.replace(/[/\\]/g, "_").slice(0, 200) || "file";
  const key = join(ctx.orgId, `${randomUUID()}${extname(name).toLowerCase().slice(0, 10)}`);
  const path = join(UPLOAD_DIR, key);
  await mkdir(join(UPLOAD_DIR, ctx.orgId), { recursive: true });
  await pipeline(file.file, createWriteStream(path));
  if (file.file.truncated) {
    await rm(path, { force: true });
    throw new HttpError(413, "too_large", `Files can be up to ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  const { size } = await stat(path);
  const [row] = await db
    .insert(attachments)
    .values({
      orgId: ctx.orgId,
      entity,
      entityId,
      fileName: name,
      mime: file.mimetype || "application/octet-stream",
      size,
      storageKey: key,
      previewStatus: needsPreview(name) && previews ? "pending" : null,
      createdBy: ctx.userId,
    })
    .returning();
  if (row!.previewStatus === "pending") previews!.add({ id: row!.id, storageKey: key });
  await logEvent(db, ctx, entity, entityId, "file_added", { file: name });
  return { ...row!, kind: fileKind(row!.fileName, row!.mime), preview: row!.previewStatus };
}

/**
 * Files for a record. A job also shows the files of its part and of the quote it was sold
 * from, so drawings and models attached once follow the work to the shop floor.
 */
export async function listFiles(db: Db, ctx: Ctx, entity: Entity, entityId: string) {
  await assertEntity(db, ctx, entity, entityId);
  const sources: { entity: Entity; id: string; via: string | null }[] = [{ entity, id: entityId, via: null }];
  if (entity === "job") {
    const [j] = await db
      .select({ itemId: jobs.itemId, quoteId: quoteLines.quoteId })
      .from(jobs)
      .leftJoin(salesOrderLines, eq(salesOrderLines.id, jobs.salesOrderLineId))
      .leftJoin(quoteLines, eq(quoteLines.id, salesOrderLines.quoteLineId))
      .where(eq(jobs.id, entityId));
    if (j?.itemId) sources.push({ entity: "item", id: j.itemId, via: "part" });
    if (j?.quoteId) sources.push({ entity: "quote", id: j.quoteId, via: "quote" });
  }
  if (entity === "quote") {
    const lines = await db.select({ itemId: quoteLines.itemId }).from(quoteLines).where(eq(quoteLines.quoteId, entityId));
    for (const l of lines) if (l.itemId) sources.push({ entity: "item", id: l.itemId, via: "part" });
  }
  const joined = await db
    .select({ a: attachments, uploadedBy: users.name })
    .from(attachments)
    .leftJoin(users, eq(users.id, attachments.createdBy))
    .where(and(eq(attachments.orgId, ctx.orgId), or(...sources.map((s) => and(eq(attachments.entity, s.entity), eq(attachments.entityId, s.id))))))
    .orderBy(desc(attachments.createdAt));
  return joined.map(({ a: r, uploadedBy }) => ({
    uploadedBy,
    id: r.id,
    fileName: r.fileName,
    mime: r.mime,
    size: r.size,
    createdAt: r.createdAt,
    kind: fileKind(r.fileName, r.mime),
    preview: r.previewStatus,
    previewError: r.previewError,
    inherited: sources.find((s) => s.entity === r.entity && s.id === r.entityId)?.via ?? null,
  }));
}

export async function openFile(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.id, id)));
  if (!row) throw notFound("File");
  return { row, stream: createReadStream(join(UPLOAD_DIR, row.storageKey)) };
}

/** The light GLB prepared from a CAD upload, once it is ready. */
export async function openPreview(db: Db, ctx: Ctx, id: string) {
  const [row] = await db.select().from(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.id, id)));
  if (!row) throw notFound("File");
  if (row.previewStatus !== "ready") throw new HttpError(409, "not_ready", "The 3D view is still being prepared");
  const path = previewPath(UPLOAD_DIR, row.storageKey);
  const { size } = await stat(path);
  return { row, size, stream: createReadStream(path) };
}

export async function deleteFile(db: Db, ctx: Ctx, id: string) {
  requireRole(ctx, EDITORS);
  const [row] = await db.delete(attachments).where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.id, id))).returning();
  if (!row) throw notFound("File");
  await rm(join(UPLOAD_DIR, row.storageKey), { force: true });
  await rm(previewPath(UPLOAD_DIR, row.storageKey), { force: true });
  await logEvent(db, ctx, row.entity, row.entityId, "file_removed", { file: row.fileName });
}

/** Count of files per record, for list thumbnails/badges. */
export async function fileCounts(db: Db, ctx: Ctx, entity: Entity, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await db
    .select({ entityId: attachments.entityId })
    .from(attachments)
    .where(and(eq(attachments.orgId, ctx.orgId), eq(attachments.entity, entity), inArray(attachments.entityId, ids)));
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.entityId, (m.get(r.entityId) ?? 0) + 1);
  return m;
}

export const isEntity = (v: string): v is Entity => (ENTITIES as readonly string[]).includes(v);
export { badRequest };
