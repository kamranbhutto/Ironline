import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

async function releasedJob(call: Awaited<ReturnType<typeof shop>>["call"]) {
  const mill = await call("POST", "/work-centers", { code: "MILL", name: "Mill", hourlyRate: 100 });
  const deb = await call("POST", "/work-centers", { code: "DEB", name: "Deburr", hourlyRate: 40 });
  const cust = await call("POST", "/customers", { name: "Floor Test Co" });
  const quote = await call("POST", "/quotes", {
    customerId: cust.body.id,
    lines: [{
      description: "Block",
      quantity: 10,
      operations: [{ workCenterId: mill.body.id, setupHours: 1, runHoursPerUnit: 0.1 }, { workCenterId: deb.body.id, runHoursPerUnit: 0.05 }],
      materials: [{ description: "Bar", quantityPer: 1, unitCost: 5 }],
    }],
  });
  const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
  const so = await call("GET", `/sales-orders/${order.body.id}`);
  const jobId = so.body.lines[0].jobs[0].id;
  await call("POST", `/jobs/${jobId}/status`, { status: "released" });
  const job = await call("GET", `/jobs/${jobId}`);
  return { jobId, ops: job.body.operations, mats: job.body.materials, mill: mill.body };
}

describe("shop floor", () => {
  it("stops a timer or finishes the step at the planned time when the work center says so", async () => {
    const { call } = await shop(env.app);
    const inj = await call("POST", "/work-centers", { code: "INJ", name: "Injection", hourlyRate: 120, atPlannedTime: "complete" });
    expect(inj.body.atPlannedTime).toBe("complete");
    const oven = await call("POST", "/work-centers", { code: "OVEN", name: "Cure oven", hourlyRate: 30, atPlannedTime: "stop" });
    const pack = await call("POST", "/work-centers", { code: "PACK", name: "Pack", hourlyRate: 40 });
    const cust = await call("POST", "/customers", { name: "Timed Co" });
    // 5 pieces × 0.1 h = 30 min planned on INJ (plus 6 min setup); 20 min planned in the oven.
    const q = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ description: "Clip", quantity: 5, operations: [
      { workCenterId: inj.body.id, setupHours: 0.1, runHoursPerUnit: 0.1 },
      { workCenterId: oven.body.id, runHoursPerUnit: 0.0666667 },
      { workCenterId: pack.body.id, runHoursPerUnit: 0.01 },
    ] }] });
    const o = await call("POST", `/quotes/${q.body.id}/convert`, {});
    const so = await call("GET", `/sales-orders/${o.body.id}`);
    const jobId = so.body.lines[0].jobs[0].id;
    await call("POST", `/jobs/${jobId}/status`, { status: "released" });
    const ops = (await call("GET", `/jobs/${jobId}`)).body.operations;
    const backdate = (opId: string, minutes: number) =>
      env.db.execute(sql`update labor_entries set started_at = now() - make_interval(mins => ${minutes}) where job_operation_id = ${opId} and ended_at is null`);

    // Setup on a "finish" work center only stops the setup timer at the planned 6 minutes.
    await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "setup" });
    await backdate(ops[0].id, 9);
    let v = (await call("GET", `/floor/operations/${ops[0].id}`)).body;
    expect(v.openEntry).toBeNull();
    expect(v.operation.status).toBe("ready");
    expect(v.actual.setupSeconds).toBe(360); // ended at the plan, not 9 minutes

    // Running under plan keeps going.
    await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "run" });
    await backdate(ops[0].id, 10);
    v = (await call("GET", `/floor/operations/${ops[0].id}`)).body;
    expect(v.openEntry).not.toBeNull();

    // Past the 30 minutes: the step finishes, all 5 good, the next step is ready.
    await backdate(ops[0].id, 45);
    v = (await call("GET", `/floor/operations/${ops[0].id}`)).body;
    expect(v.openEntry).toBeNull();
    expect(v.operation).toMatchObject({ status: "done", quantityGood: 5 });
    expect(v.actual.runSeconds).toBe(1800);
    let job = (await call("GET", `/jobs/${jobId}`)).body;
    expect(job.operations[1].status).toBe("ready");
    expect(job.log.some((e: { action: string }) => e.action === "operation_auto_done")).toBe(true);
    // Cost is the planned 30 min + 6 min setup at 120/h.
    expect(job.operations[0].actualCost).toBeCloseTo(72, 1);

    // A "stop" work center stops the timer but leaves the step open.
    await call("POST", `/floor/operations/${ops[1].id}/start`, { kind: "run" });
    await backdate(ops[1].id, 30);
    await call("GET", "/floor/board");
    v = (await call("GET", `/floor/operations/${ops[1].id}`)).body;
    expect(v.openEntry).toBeNull();
    expect(v.operation.status).toBe("ready");
    expect(Math.round(v.actual.runSeconds / 60)).toBe(20);

    // A "keep running" work center never stops by itself.
    await call("POST", `/floor/operations/${ops[1].id}/complete`, { quantityGood: 5 });
    await call("POST", `/floor/operations/${ops[2].id}/start`, { kind: "run" });
    await backdate(ops[2].id, 120);
    v = (await call("GET", `/floor/operations/${ops[2].id}`)).body;
    expect(v.openEntry).not.toBeNull();
    job = (await call("GET", `/jobs/${jobId}`)).body;
    expect(job.status).toBe("in_progress");
  });

  it("lets one person run jobs on two work centers at the same time", async () => {
    const { call } = await shop(env.app);
    const cut = await call("POST", "/work-centers", { code: "CUT", name: "Cutter", hourlyRate: 60 });
    const inj = await call("POST", "/work-centers", { code: "INJ", name: "Injection molding", hourlyRate: 90 });
    const cust = await call("POST", "/customers", { name: "Parallel Co" });
    const release = async (wc: string) => {
      const q = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ description: `Part on ${wc}`, quantity: 5, operations: [{ workCenterId: wc, runHoursPerUnit: 0.1 }] }] });
      const o = await call("POST", `/quotes/${q.body.id}/convert`, {});
      const so = await call("GET", `/sales-orders/${o.body.id}`);
      const jobId = so.body.lines[0].jobs[0].id;
      await call("POST", `/jobs/${jobId}/status`, { status: "released" });
      return (await call("GET", `/jobs/${jobId}`)).body.operations[0].id as string;
    };
    const a = await release(cut.body.id);
    const b = await release(inj.body.id);

    await call("POST", `/floor/operations/${a}/start`, { kind: "run" });
    const second = await call("POST", `/floor/operations/${b}/start`, { kind: "run" });
    expect(second.status).toBe(200);
    // Starting on INJ does not pause CUT: both run, and each screen lists the other.
    const first = await call("GET", `/floor/operations/${a}`);
    expect(first.body.openEntry).not.toBeNull();
    expect(first.body.operation.status).toBe("running");
    expect(first.body.myOtherRunning.map((r: { operationId: string }) => r.operationId)).toEqual([b]);
    expect(second.body.myOtherRunning[0].workCenterCode).toBe("CUT");

    // Switching kind on the same operation replaces that timer only.
    await call("POST", `/floor/operations/${b}/start`, { kind: "labor" });
    const again = await call("GET", `/floor/operations/${b}`);
    expect(again.body.openEntry.kind).toBe("labor");
    expect(again.body.entries.filter((e: { endedAt: string | null }) => !e.endedAt)).toHaveLength(1);
    expect((await call("GET", `/floor/operations/${a}`)).body.openEntry).not.toBeNull();

    // Stopping one leaves the other running.
    await call("POST", `/floor/operations/${a}/stop`, {});
    expect((await call("GET", `/floor/operations/${b}`)).body.openEntry).not.toBeNull();
  });

  it("runs timers, records quantities, completes operations and costs the job", async () => {
    const { call } = await shop(env.app);
    const { jobId, ops, mats, mill } = await releasedJob(call);

    const wcs = await call("GET", "/floor/work-centers");
    expect(wcs.body.find((w: { code: string }) => w.code === "MILL").queued).toBe(1);
    const queue = await call("GET", `/floor/work-centers/${mill.id}/queue`);
    expect(queue.body.map((o: { id: string }) => o.id)).toEqual([ops[0].id]);
    // The second operation is not ready until the first is done.
    expect((await call("POST", `/floor/operations/${ops[1].id}/start`, { kind: "run" })).status).toBe(409);

    // No timer (setup, labor or machine) on the first step until the material is picked.
    for (const kind of ["setup", "labor", "run"]) {
      const early = await call("POST", `/floor/operations/${ops[0].id}/start`, { kind });
      expect(early.status).toBe(409);
      expect(early.body.error.message).toContain("Pick the material before starting: Bar (0 of 10 picked)");
    }
    await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: 4 });
    expect((await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "setup" })).body.error.message).toContain("Bar (4 of 10 picked)");
    await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: 6 });

    const started = await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "setup" });
    expect(started.status).toBe(200);
    expect(started.body.openEntry.kind).toBe("setup");
    expect((await call("GET", `/jobs/${jobId}`)).body.status).toBe("in_progress");

    const stopped = await call("POST", `/floor/operations/${ops[0].id}/stop`, { quantityGood: 4, quantityScrap: 1, scrapReason: "Setup piece" });
    expect(stopped.body.openEntry).toBeNull();
    expect(stopped.body.operation.quantityGood).toBe(4);
    expect(stopped.body.operation.status).toBe("ready");
    expect((await call("POST", `/floor/operations/${ops[0].id}/stop`, {})).status).toBe(400);

    await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "run" });
    const done = await call("POST", `/floor/operations/${ops[0].id}/complete`, { quantityGood: 6 });
    expect(done.body).toEqual({ nextOperationId: ops[1].id, jobComplete: false });

    const picked = await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: 0.5 });
    expect(picked.body.quantityIssued).toBe(10.5);
    await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: -0.5 });
    expect((await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: -20 })).status).toBe(400);

    const job = await call("GET", `/jobs/${jobId}`);
    expect(job.body.operations[0]).toMatchObject({ status: "done", quantityGood: 10, quantityScrap: 1 });
    expect(job.body.operations[1].status).toBe("ready");
    expect(job.body.costs.materialActual).toBe(50);
    expect(job.body.actualCost).toBeGreaterThanOrEqual(50);
    expect(job.body.log.some((e: { action: string }) => e.action === "operation_done")).toBe(true);

    const last = await call("POST", `/floor/operations/${ops[1].id}/complete`, { quantityGood: 10 });
    expect(last.body.jobComplete).toBe(true);
    const finished = await call("GET", `/jobs/${jobId}`);
    expect(finished.body).toMatchObject({ status: "complete", quantityCompleted: 10 });

    const board = await call("GET", "/floor/board");
    expect(board.status).toBe(200);
    expect(board.body.columns.length).toBe(2);
  });

  it("lets the planner edit due date, priority and notes", async () => {
    const { call } = await shop(env.app);
    const { jobId } = await releasedJob(call);
    const r = await call("PATCH", `/jobs/${jobId}`, { dueDate: "2030-01-15", priority: 90, notes: "Rush" });
    expect(r.body).toMatchObject({ dueDate: "2030-01-15", priority: 90, notes: "Rush" });
  });
});

describe("files", () => {
  it("uploads to a part, shows it on the job, serves it and keeps shops apart", async () => {
    const owner = await shop(env.app);
    const other = await shop(env.app, "Other Shop");
    const { jobId } = await releasedJob(owner.call);
    const itemId = (await owner.call("GET", `/jobs/${jobId}`)).body.itemId as string;
    const stl = "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n";

    const up = await owner.upload("item", itemId, "block.stl", stl);
    expect(up.status).toBe(201);
    expect(up.body.kind).toBe("mesh");
    await owner.upload("job", jobId, "setup-sheet.pdf", "%PDF-1.4 test");

    const onJob = await owner.call("GET", `/files?entity=job&entityId=${jobId}`);
    expect(onJob.body.map((f: { fileName: string; inherited: string | null }) => [f.fileName, f.inherited]).sort()).toEqual([
      ["block.stl", "part"],
      ["setup-sheet.pdf", null],
    ]);
    const served = await owner.raw(`/files/${up.body.id}`);
    expect(served.statusCode).toBe(200);
    expect(served.body).toBe(stl);
    expect(served.headers["content-disposition"]).toContain("inline");

    expect((await other.raw(`/files/${up.body.id}`)).statusCode).toBe(404);
    expect((await other.upload("job", jobId, "x.stl", stl)).status).toBe(404);
    expect((await other.call("GET", `/files?entity=job&entityId=${jobId}`)).status).toBe(404);

    expect((await owner.call("DELETE", `/files/${up.body.id}`)).status).toBe(204);
    expect((await owner.raw(`/files/${up.body.id}`)).statusCode).toBe(404);
  });

  it("counts parts while the timer runs, sends parts to rework, and splits labor from machine time", async () => {
    const { call } = await shop(env.app);
    const { jobId, ops, mats } = await releasedJob(call);
    await call("POST", `/floor/materials/${mats[0].id}/pick`, { quantity: 10 });
    await call("POST", `/floor/operations/${ops[0].id}/start`, { kind: "labor" });
    const counted = await call("POST", `/floor/operations/${ops[0].id}/count`, { quantityGood: 3 });
    expect(counted.status).toBe(200);
    expect(counted.body.operation.quantityGood).toBe(3);
    // Counting does not stop the clock.
    expect(counted.body.openEntry.kind).toBe("labor");
    const scrapped = await call("POST", `/floor/operations/${ops[0].id}/count`, { quantityScrap: 2, scrapReason: "Tool breakage" });
    expect(scrapped.body.operation.quantityScrap).toBe(2);
    expect((await call("POST", `/floor/operations/${ops[0].id}/count`, {})).status).toBe(400);
    const rw = await call("POST", `/floor/operations/${ops[0].id}/rework`, { quantity: 1, reason: "Burrs or finish" });
    expect(rw.body.operation.quantityRework).toBe(1);
    expect((await call("POST", `/floor/operations/${ops[0].id}/rework`, { quantity: 1 })).status).toBe(400);
    expect(rw.body.actual).toMatchObject({ machineSeconds: 0 });
    expect(rw.body.salesOrderNumber).toMatch(/^SO-/);
    const log = (await call("GET", `/jobs/${jobId}`)).body.log.map((e: { action: string }) => e.action);
    expect(log).toEqual(expect.arrayContaining(["parts_counted", "rework"]));
    // Another shop cannot touch this operation.
    const other = await shop(env.app, "Other Shop");
    expect((await other.call("POST", `/floor/operations/${ops[0].id}/count`, { quantityGood: 1 })).status).toBe(404);
  });

  it("keeps a job chat with alerts and photos, private to the shop", async () => {
    const { call, upload } = await shop(env.app);
    const { jobId } = await releasedJob(call);
    expect((await call("POST", `/jobs/${jobId}/messages`, { body: "Hey @Jordan the holes look off" })).status).toBe(201);
    expect((await call("POST", `/jobs/${jobId}/messages`, { kind: "alert", reason: "Machine down" })).status).toBe(201);
    expect((await call("POST", `/jobs/${jobId}/messages`, { kind: "alert" })).status).toBe(400);
    expect((await call("POST", `/jobs/${jobId}/messages`, { body: "   " })).status).toBe(400);
    const pic = await upload("job", jobId, "photo.png", "not really a png");
    expect((await call("POST", `/jobs/${jobId}/messages`, { attachmentId: pic.body.id })).status).toBe(201);
    const list = await call("GET", `/jobs/${jobId}/messages`);
    expect(list.body.map((m: { kind: string }) => m.kind)).toEqual(["message", "alert", "message"]);
    expect(list.body[2].attachmentName).toBe("photo.png");
    expect((await call("GET", `/jobs/${jobId}`)).body.log.some((e: { action: string }) => e.action === "alert")).toBe(true);

    const other = await shop(env.app, "Nosy Shop");
    expect((await other.call("GET", `/jobs/${jobId}/messages`)).status).toBe(404);
    expect((await other.call("POST", `/jobs/${jobId}/messages`, { body: "hi" })).status).toBe(404);
    // A photo from another job cannot be posted here.
    const { jobId: job2 } = await releasedJob(call);
    expect((await call("POST", `/jobs/${job2}/messages`, { attachmentId: pic.body.id })).status).toBe(400);
  });
});
