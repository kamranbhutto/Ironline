/**
 * Background preparation of CAD uploads. Reading a STEP file with OpenCascade can take minutes
 * for a big assembly, so it is done once, right after upload, in a separate process; the
 * browser then opens the small GLB it produces instead of re-reading the CAD file every time.
 * Jobs run one at a time to keep memory use predictable on a small server.
 */
import { fork } from "node:child_process";
import { rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { and, eq, isNull, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { attachments } from "../db/schema.ts";

const WORKER = fileURLToPath(new URL("../workers/cad-preview.mjs", import.meta.url));
const CAD_EXT = /\.(step|stp|iges|igs|brep)$/i;
/** A CAD file this large or larger would need too long; anything up to the upload limit is fine. */
const TIMEOUT_MS = 20 * 60 * 1000;

export const needsPreview = (fileName: string) => CAD_EXT.test(fileName);
export const previewPath = (uploadDir: string, storageKey: string) => join(uploadDir, `${storageKey}.glb`);

type Job = { id: string; storageKey: string };

export function createPreviewQueue(db: Db, uploadDir: string, log: (msg: string) => void = () => {}) {
  const queue: Job[] = [];
  let running = false;

  const convert = (job: Job) =>
    new Promise<void>((resolve, reject) => {
      let err = "";
      const child = fork(WORKER, [join(uploadDir, job.storageKey), previewPath(uploadDir, job.storageKey)], {
        stdio: ["ignore", "ignore", "pipe", "ipc"],
        // Plain Node: the worker is JavaScript, so the dev server's TypeScript loader is not needed.
        execArgv: [],
      });
      child.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);
      child.on("exit", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(signal === "SIGKILL" ? "Preparing the 3D view took too long" : err.trim().split("\n").pop() || "Preparing the 3D view failed"));
      });
    });

  const pump = async () => {
    if (running) return;
    running = true;
    try {
      for (let job = queue.shift(); job; job = queue.shift()) {
        const t = Date.now();
        try {
          await convert(job);
          await db.update(attachments).set({ previewStatus: "ready", previewError: null }).where(eq(attachments.id, job.id));
          log(`3D preview ready for ${job.id} in ${((Date.now() - t) / 1000).toFixed(1)}s`);
        } catch (e) {
          await rm(`${previewPath(uploadDir, job.storageKey)}.part`, { force: true });
          // The file may have been deleted while it was being prepared; that is not an error.
          await db.update(attachments).set({ previewStatus: "failed", previewError: (e as Error).message.slice(0, 300) }).where(eq(attachments.id, job.id));
          log(`3D preview failed for ${job.id}: ${(e as Error).message}`);
        }
      }
    } finally {
      running = false;
    }
  };

  return {
    add(job: Job) {
      if (!queue.some((j) => j.id === job.id)) queue.push(job);
      void pump();
    },
    /** On start-up: queue CAD files uploaded before previews existed, or interrupted by a restart. */
    async resume() {
      const rows = await db
        .select({ id: attachments.id, fileName: attachments.fileName, storageKey: attachments.storageKey, status: attachments.previewStatus })
        .from(attachments)
        .where(or(isNull(attachments.previewStatus), eq(attachments.previewStatus, "pending")));
      for (const r of rows) {
        if (!needsPreview(r.fileName)) continue;
        const ready = await stat(previewPath(uploadDir, r.storageKey)).then(() => true, () => false);
        if (ready) {
          await db.update(attachments).set({ previewStatus: "ready" }).where(and(eq(attachments.id, r.id)));
          continue;
        }
        if (r.status !== "pending") await db.update(attachments).set({ previewStatus: "pending" }).where(eq(attachments.id, r.id));
        this.add({ id: r.id, storageKey: r.storageKey });
      }
    },
  };
}

export type PreviewQueue = ReturnType<typeof createPreviewQueue>;
