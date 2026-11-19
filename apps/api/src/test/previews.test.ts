import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { initPreviews } from "../services/files.ts";
import { setupApp, shop } from "./helpers.ts";

const CUBE = readFileSync(fileURLToPath(new URL("../../../../samples/cube-10mm.stp", import.meta.url)), "latin1");

let ctx: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  ctx = await setupApp();
  initPreviews(ctx.db);
});
afterAll(() => ctx.close());

describe("CAD uploads are prepared once for fast viewing", () => {
  it("converts a STEP upload to a GLB in the background and serves it", async () => {
    const { call, upload, raw } = await shop(ctx.app);
    const part = await call("POST", "/items", { partNumber: "CUBE-10", description: "Test cube", type: "manufactured" });
    const up = await upload("item", part.body.id, "cube.stp", CUBE);
    expect(up.status).toBe(201);
    expect(up.body.preview).toBe("pending");

    // Not ready yet: the viewer is told to wait rather than given a half-written file.
    let status = "pending";
    for (let i = 0; i < 100 && status === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const list = await call("GET", `/files?entity=item&entityId=${part.body.id}`);
      status = list.body[0].preview;
    }
    expect(status).toBe("ready");

    const glb = await raw(`/files/${up.body.id}/preview`);
    expect(glb.statusCode).toBe(200);
    expect(glb.headers["content-type"]).toBe("model/gltf-binary");
    expect(glb.rawPayload.subarray(0, 4).toString()).toBe("glTF");

    // Deleting the upload removes its prepared view too.
    expect((await call("DELETE", `/files/${up.body.id}`)).status).toBe(204);
    expect((await raw(`/files/${up.body.id}/preview`)).statusCode).toBe(404);
  });

  it("marks an unreadable CAD file as failed instead of waiting forever", async () => {
    const { call, upload } = await shop(ctx.app);
    const part = await call("POST", "/items", { partNumber: "BAD-1", description: "Broken file", type: "manufactured" });
    const up = await upload("item", part.body.id, "broken.step", "this is not a STEP file");
    let row = { preview: "pending", previewError: null as string | null };
    for (let i = 0; i < 100 && row.preview === "pending"; i++) {
      await new Promise((r) => setTimeout(r, 200));
      row = (await call("GET", `/files?entity=item&entityId=${part.body.id}`)).body[0];
    }
    expect(row.preview).toBe("failed");
    expect(row.previewError).toMatch(/could not be read/);
  });

  it("does not prepare files that open quickly as they are", async () => {
    const { call, upload } = await shop(ctx.app);
    const part = await call("POST", "/items", { partNumber: "DRW-1", description: "Drawing", type: "manufactured" });
    const up = await upload("item", part.body.id, "flat.dxf", "0\nEOF\n");
    expect(up.body.preview).toBeNull();
  });
});
