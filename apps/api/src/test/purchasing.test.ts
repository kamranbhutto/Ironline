import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

describe("purchasing", () => {
  it("plans from job demand, stops recommending once ordered, receives into lots, and cancels", async () => {
    const { call } = await shop(env.app);
    const other = await shop(env.app, "Other Buyer");
    const mill = await call("POST", "/work-centers", { code: "MILL", name: "Mill", hourlyRate: 100 });
    const sheet = await call("POST", "/items", { partNumber: "SH-1", description: "Sheet", type: "material", uom: "sqft", unitCost: 5 });
    const part = await call("POST", "/items", { partNumber: "BR-1", description: "Bracket", routing: [{ workCenterId: mill.body.id, runHoursPerUnit: 0.1 }], bom: [{ componentItemId: sheet.body.id, quantityPer: 2 }] });
    const v1 = await call("POST", "/vendors", { name: "North Steel", paymentTermsDays: 30 });
    const v2 = await call("POST", "/vendors", { name: "South Metals" });
    expect((await call("POST", "/vendors", { name: "North Steel" })).status).toBe(409);
    // Exactly one primary.
    expect((await call("PUT", `/items/${sheet.body.id}/vendors`, { vendors: [{ vendorId: v1.body.id, leadDays: 5, unitCost: 4.5 }, { vendorId: v2.body.id, leadDays: 2, unitCost: 6 }] })).status).toBe(400);
    const iv = await call("PUT", `/items/${sheet.body.id}/vendors`, { vendors: [{ vendorId: v1.body.id, isPrimary: true, leadDays: 5, unitCost: 4.5, minOrder: 50 }, { vendorId: v2.body.id, leadDays: 2, unitCost: 6 }] });
    expect(iv.body[0].name).toBe("North Steel");
    expect((await other.call("PUT", `/items/${sheet.body.id}/vendors`, { vendors: [] })).status).toBe(400);

    const cust = await call("POST", "/customers", { name: "Buyer Co" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: part.body.id, description: "Bracket", quantity: 20 }] });
    await call("POST", `/quotes/${quote.body.id}/convert`, {});

    let planRes = await call("GET", "/purchasing/plan");
    let row = planRes.body.rows.find((r: { id: string }) => r.id === sheet.body.id);
    expect(row.demand).toBe(40);
    expect(row.toBuy).toBe(50); // short 40, vendor minimum 50
    expect(row.vendor.name).toBe("North Steel");
    expect(row.totalCost).toBe(225);

    const po = await call("POST", "/purchase-orders", { vendorId: v1.body.id, lines: [{ itemId: sheet.body.id, quantity: 50, unitCost: 4.5, dueDate: "2026-12-01" }] });
    expect(po.status).toBe(201);
    expect(po.body.number).toMatch(/^PO-/);
    expect(po.body.total).toBe(225);
    planRes = await call("GET", "/purchasing/plan");
    row = planRes.body.rows.find((r: { id: string }) => r.id === sheet.body.id);
    expect(row.toBuy).toBe(0);
    expect(row.drafts[0].poNumber).toBe(po.body.number);
    expect((await call("GET", "/inventory")).body.find((r: { id: string }) => r.id === sheet.body.id).onOrder).toBe(50);

    // Drafts cannot be received; sent orders can, in parts, never beyond the order.
    expect((await call("POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: 10 }] })).status).toBe(409);
    await call("POST", `/purchase-orders/${po.body.id}/status`, { status: "sent" });
    const part1 = await call("POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: 30, heatNumber: "HX-1" }] });
    expect(part1.body.status).toBe("partial");
    expect(part1.body.receipts).toHaveLength(1);
    expect((await call("POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: 21 }] })).status).toBe(400);
    expect((await call("POST", `/purchase-orders/${po.body.id}/status`, { status: "cancelled" })).status).toBe(409);
    const done = await call("POST", `/purchase-orders/${po.body.id}/receive`, { lines: [{ lineId: po.body.lines[0].id, quantity: 20 }] });
    expect(done.body.status).toBe("received");
    const stock = await call("GET", `/inventory/items/${sheet.body.id}`);
    expect(stock.body.onHand).toBe(50);
    expect(stock.body.lots[0].supplier).toBe("North Steel");
    expect(stock.body.lots[0].unitCost).toBe(4.5);
    // The part's standard cost is unchanged.
    expect((await call("GET", `/items/${sheet.body.id}`)).body.unitCost).toBe(5);

    // A cancelled draft brings the recommendation back.
    await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: part.body.id, description: "Bracket", quantity: 50 }] }).then((q) => call("POST", `/quotes/${q.body.id}/convert`, {}));
    const po2 = await call("POST", "/purchase-orders", { vendorId: v2.body.id, lines: [{ itemId: sheet.body.id, quantity: 100, unitCost: 6 }] });
    row = (await call("GET", "/purchasing/plan")).body.rows.find((r: { id: string }) => r.id === sheet.body.id);
    expect(row.toBuy).toBe(0);
    await call("POST", `/purchase-orders/${po2.body.id}/status`, { status: "cancelled" });
    row = (await call("GET", "/purchasing/plan")).body.rows.find((r: { id: string }) => r.id === sheet.body.id);
    expect(row.toBuy).toBe(90); // jobs need 40 + 100, 50 on hand
    expect((await other.call("GET", `/purchase-orders/${po.body.id}`)).status).toBe(404);
  });
});
