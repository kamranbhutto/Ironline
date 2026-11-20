import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

describe("assemblies with pieces made in house", () => {
  it("makes a job per piece, holds the assembly until they are done, and stocks the pieces", async () => {
    const { call } = await shop(env.app);
    const laser = await call("POST", "/work-centers", { code: "LASER", name: "Laser", hourlyRate: 120 });
    const asm = await call("POST", "/work-centers", { code: "ASM", name: "Assembly bench", hourlyRate: 60 });
    const sheet = await call("POST", "/items", { partNumber: "SH", description: "Sheet", type: "material", uom: "sqft", unitCost: 4 });
    const side = await call("POST", "/items", { partNumber: "P-A", description: "Side panel", routing: [{ workCenterId: laser.body.id, setupHours: 0.5, runHoursPerUnit: 0.05 }], bom: [{ componentItemId: sheet.body.id, quantityPer: 2 }] });
    const back = await call("POST", "/items", { partNumber: "P-B", description: "Back panel", routing: [{ workCenterId: laser.body.id, runHoursPerUnit: 0.1 }] });
    const box = await call("POST", "/items", {
      partNumber: "BOX",
      description: "Enclosure",
      routing: [{ workCenterId: asm.body.id, runHoursPerUnit: 0.2 }],
      bom: [{ componentItemId: side.body.id, quantityPer: 2 }, { componentItemId: back.body.id, quantityPer: 1 }],
    });
    // Standard cost rolls up: side = 0.5h×120/10 + 0.05h×120 + 2 sqft×4 = 20; back = 0.1h×120 = 12;
    // box = 0.2h×60 + 2×20 + 12 = 64.
    expect((await call("GET", `/items/${box.body.id}`)).body.unitCost).toBe(64);
    await call("PUT", `/items/${back.body.id}`, { partNumber: "P-B", description: "Back panel", routing: [{ workCenterId: laser.body.id, runHoursPerUnit: 0.2 }] });
    expect((await call("GET", `/items/${back.body.id}`)).body.unitCost).toBe(24);
    expect((await call("GET", `/items/${box.body.id}`)).body.unitCost).toBe(76); // the assembly follows its piece
    const cust = await call("POST", "/customers", { name: "Asm Co" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: box.body.id, description: "Enclosure", quantity: 5 }] });
    const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
    const so = await call("GET", `/sales-orders/${order.body.id}`);
    const jobId = so.body.lines[0].jobs[0].id;

    let job = (await call("GET", `/jobs/${jobId}`)).body;
    expect(job.children.map((c: { number: string }) => c.number)).toEqual([`${job.number}-1`, `${job.number}-2`]);
    const sideJob = (await call("GET", `/jobs/${job.children[0].id}`)).body;
    expect(sideJob.quantity).toBe(10); // 2 per box × 5 boxes
    expect(sideJob.parent.number).toBe(job.number);
    expect(sideJob.operations).toHaveLength(1);
    expect(sideJob.materials[0].quantityRequired).toBe(20);

    // Releasing the assembly releases the pieces; the assembly step waits.
    await call("POST", `/jobs/${jobId}/status`, { status: "released" });
    job = (await call("GET", `/jobs/${jobId}`)).body;
    expect(job.operations[0].status).toBe("pending");
    expect(job.children.every((c: { status: string }) => c.status === "released")).toBe(true);
    const blocked = await call("POST", `/floor/operations/${job.operations[0].id}/start`, { kind: "run" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toMatch(/Waiting for the pieces/);

    // Finish both piece jobs.
    for (const c of job.children) {
      const cj = (await call("GET", `/jobs/${c.id}`)).body;
      await call("POST", `/floor/operations/${cj.operations[0].id}/start`, { kind: "run" });
      const done = await call("POST", `/floor/operations/${cj.operations[0].id}/complete`, { quantityGood: cj.quantity });
      expect(done.body.jobComplete).toBe(true);
    }
    job = (await call("GET", `/jobs/${jobId}`)).body;
    expect(job.operations[0].status).toBe("ready");
    const stock = await call("GET", `/inventory/items/${side.body.id}`);
    expect(stock.body.onHand).toBe(10);
    // The assembly picks the made pieces from stock at what they cost to make.
    const sideLine = job.materials.find((m: { itemId: string }) => m.itemId === side.body.id);
    await call("POST", `/floor/materials/${sideLine.id}/pick`, { quantity: 10 });
    expect((await call("GET", `/inventory/items/${side.body.id}`)).body.onHand).toBe(0);
  });

  it("rebuilds a job made before its part had a routing", async () => {
    const { call } = await shop(env.app, "Rebuild Shop");
    const wc = await call("POST", "/work-centers", { code: "MILL", name: "Mill", hourlyRate: 100 });
    const part = await call("POST", "/items", { partNumber: "R-1", description: "Bracket" });
    const cust = await call("POST", "/customers", { name: "R Co" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: part.body.id, description: "Bracket", quantity: 3 }] });
    const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
    const jobId = (await call("GET", `/sales-orders/${order.body.id}`)).body.lines[0].jobs[0].id;
    expect((await call("GET", `/jobs/${jobId}`)).body.operations).toHaveLength(0);
    await call("PUT", `/items/${part.body.id}`, { partNumber: "R-1", description: "Bracket", routing: [{ workCenterId: wc.body.id, setupHours: 1, runHoursPerUnit: 0.2 }] });
    const rebuilt = await call("POST", `/jobs/${jobId}/rebuild`);
    expect(rebuilt.status).toBe(200);
    expect(rebuilt.body.operations).toHaveLength(1);
    expect(rebuilt.body.estimatedCost).toBeGreaterThan(0);
  });
});
