import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

/** Every lot's cached quantity must equal the sum of its ledger rows. */
async function ledgerMatches() {
  const r = await env.db.execute<{ bad: number }>(sql`
    select count(*)::int as bad from stock_lots l
    where l.quantity <> coalesce((select sum(t.quantity) from stock_transactions t where t.lot_id = l.id and t.kind not in ('move_out', 'move_in')), 0)`);
  return r.rows[0]!.bad;
}

describe("inventory", () => {
  it("receives lots, picks oldest first, records shortfalls, returns, saves remnants and counts", async () => {
    const { call } = await shop(env.app);
    const other = await shop(env.app, "Other Stock Shop");
    const mill = await call("POST", "/work-centers", { code: "MILL", name: "Mill", hourlyRate: 100 });
    const bar = await call("POST", "/items", { partNumber: "BAR-1", description: "Round bar, per inch", type: "material", uom: "in", unitCost: 2 });
    const part = await call("POST", "/items", {
      partNumber: "P-1",
      description: "Pin",
      routing: [{ workCenterId: mill.body.id, setupHours: 0, runHoursPerUnit: 0.1 }],
      bom: [{ componentItemId: bar.body.id, quantityPer: 3 }],
    });
    const rack = await call("POST", "/inventory/locations", { code: "R1", name: "Rack 1" });
    expect(rack.status).toBe(201);

    const lotA = await call("POST", "/inventory/receive", { itemId: bar.body.id, locationId: rack.body.id, quantity: 10, unitCost: 1.5, heatNumber: "H-100" });
    const lotB = await call("POST", "/inventory/receive", { itemId: bar.body.id, quantity: 10, unitCost: 2.5 });
    expect(lotA.status).toBe(201);
    expect(lotA.body.lotNumber).toMatch(/^L-/);
    expect((await other.call("POST", "/inventory/receive", { itemId: bar.body.id, quantity: 1, unitCost: 1 })).status).toBe(400);
    expect((await other.call("GET", `/inventory/items/${bar.body.id}`)).status).toBe(404);

    const cust = await call("POST", "/customers", { name: "Stock Co" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: part.body.id, description: "Pin", quantity: 10 }] });
    const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
    const jobId = (await call("GET", `/sales-orders/${order.body.id}`)).body.lines[0].jobs[0].id;
    const job = await call("GET", `/jobs/${jobId}`);
    const mat = job.body.materials[0];
    expect(mat.quantityRequired).toBe(30);

    let stock = await call("GET", `/inventory/items/${bar.body.id}`);
    expect(stock.body.onHand).toBe(20);
    expect(stock.body.needed).toBe(30);
    expect(stock.body.available).toBe(-10);

    // 12 in: all 10 of lot A (1.50) then 2 of lot B (2.50) = 20.
    await call("POST", `/floor/materials/${mat.id}/pick`, { quantity: 12 });
    let j = await call("GET", `/jobs/${jobId}`);
    expect(j.body.materials[0].issuedCost).toBe(20);
    // 12 more: 8 left in lot B (20) + 4 untracked at the job's unit cost (2 each) = 28.
    await call("POST", `/floor/materials/${mat.id}/pick`, { quantity: 12 });
    j = await call("GET", `/jobs/${jobId}`);
    expect(j.body.materials[0].quantityIssued).toBe(24);
    expect(j.body.materials[0].issuedCost).toBe(48);
    stock = await call("GET", `/inventory/items/${bar.body.id}`);
    expect(stock.body.onHand).toBe(0);
    expect(stock.body.lots.find((l: { id: string }) => l.id === lotA.body.id).usedOn[0].quantity).toBe(10);

    // Return 6: lot B gets back what it gave (newest first), never more than the job took from it.
    await call("POST", `/floor/materials/${mat.id}/pick`, { quantity: -6 });
    stock = await call("GET", `/inventory/items/${bar.body.id}`);
    expect(stock.body.onHand).toBe(6);
    expect(stock.body.lots.find((l: { id: string }) => l.id === lotB.body.id).quantity).toBe(6);
    expect((await call("POST", `/floor/materials/${mat.id}/pick`, { quantity: -100 })).status).toBe(400);

    // A remnant comes off the job and keeps its parent's cost and heat number.
    const rem = await call("POST", `/floor/materials/${mat.id}/remnant`, { quantity: 3, dimensions: "3 in off-cut" });
    expect(rem.status).toBe(201);
    expect(rem.body.remnant).toBe(true);
    expect(rem.body.unitCost).toBeGreaterThan(0);
    j = await call("GET", `/jobs/${jobId}`);
    expect(j.body.materials[0].quantityIssued).toBe(15);
    expect((await call("POST", `/floor/materials/${mat.id}/remnant`, { quantity: 100, dimensions: "x" })).status).toBe(400);

    // Stock take: preview, then apply; a row changed since download is flagged.
    const sheet = await call("GET", "/inventory/stock-take");
    const rowB = sheet.body.find((r: { lotId: string }) => r.lotId === lotB.body.id);
    const preview = await call("POST", "/inventory/stock-take", { rows: [{ lotId: rowB.lotId, counted: 5, expected: 7 }] });
    expect(preview.body.applied).toBe(false);
    expect(preview.body.changes[0]).toMatchObject({ delta: -1, movedSinceDownload: true });
    expect((await call("GET", `/inventory/items/${bar.body.id}`)).body.lots.find((l: { id: string }) => l.id === lotB.body.id).quantity).toBe(6);
    const applied = await call("POST", "/inventory/stock-take", { rows: [{ lotId: rowB.lotId, counted: 5, expected: 6 }], apply: true });
    expect(applied.body.changes[0].movedSinceDownload).toBe(false);
    expect((await other.call("POST", "/inventory/stock-take", { rows: [{ lotId: rowB.lotId, counted: 1, expected: 1 }] })).status).toBe(400);

    // Adjust and move.
    expect((await call("POST", `/inventory/lots/${lotB.body.id}/adjust`, { quantity: 4, note: "Damaged end" })).status).toBe(200);
    expect((await call("POST", `/inventory/lots/${lotB.body.id}/move`, { locationId: rack.body.id })).status).toBe(200);
    expect((await call("POST", `/inventory/lots/${lotB.body.id}/adjust`, { quantity: -1, note: "x" })).status).toBe(400);

    const ov = await call("GET", "/inventory");
    const row = ov.body.find((r: { id: string }) => r.id === bar.body.id);
    expect(row.onHand).toBe(7); // lot B 4 + remnant 3
    expect(row.remnants).toBe(1);
    expect(await ledgerMatches()).toBe(0);
  });
});
