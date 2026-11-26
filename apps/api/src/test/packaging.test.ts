import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

const spec = {
  method: "layers",
  container: { code: "CTN-403025", name: "Carton 400 × 300 × 250", kind: "carton", l: 400, w: 300, h: 250, grade: "C32" },
  perBox: 60,
  layers: 5,
  perLayer: 12,
  vertical: "h",
  boxGross: 30.45,
  pallet: { code: "PAL-1208", name: "Pallet 1200 × 800" },
  boxesPerPallet: 24,
  partsPerPallet: 1440,
  vehicle: { code: "TRL-136", name: "Trailer 13.6 m" },
  palletsPerLoad: 33,
  partsPerLoad: 47520,
  costPerPart: 0.0712,
  savedAt: "2026-11-22T10:00:00.000Z",
};

describe("packaging", () => {
  it("starts each shop with its own library and keeps codes unique", async () => {
    const a = await shop(env.app);
    const b = await shop(env.app);
    const lib = await a.call("GET", "/pack-assets");
    expect(lib.status).toBe(200);
    const kinds = new Set(lib.body.map((x: { kind: string }) => x.kind));
    expect([...kinds].sort()).toEqual(["carton", "crate", "pallet", "tote", "vehicle"]);
    expect((await a.call("GET", "/pack-assets")).body).toHaveLength(lib.body.length); // seeded once

    const made = await a.call("POST", "/pack-assets", { kind: "tote", code: "BIN-1", name: "Blue bin", l: 300, w: 200, h: 150, returnable: true, cost: 9, tripCost: 0.5, lifeTrips: 150 });
    expect(made.status).toBe(201);
    expect((await a.call("POST", "/pack-assets", { kind: "tote", code: "BIN-1", name: "Again", l: 1, w: 1, h: 1 })).status).toBe(409);
    expect((await a.call("POST", "/pack-assets", { kind: "box", code: "X", name: "Bad kind", l: 1, w: 1, h: 1 })).status).toBe(400);
    const upd = await a.call("PUT", `/pack-assets/${made.body.id}`, { ...made.body, name: "Blue bin 30 L", grade: "C32" });
    expect(upd.body.name).toBe("Blue bin 30 L");
    expect(upd.body.grade).toBeNull(); // grades are for cartons only

    // Another shop cannot see or change it.
    expect((await b.call("GET", "/pack-assets")).body.some((x: { code: string }) => x.code === "BIN-1")).toBe(false);
    expect((await b.call("PUT", `/pack-assets/${made.body.id}`, { ...made.body, name: "Taken" })).status).toBe(404);
  });

  it("saves a part's packing size and spec, and shows it on its jobs", async () => {
    const { call } = await shop(env.app);
    const item = await call("POST", "/items", { partNumber: "PK-1", description: "Bracket" });
    const saved = await call("PUT", `/items/${item.body.id}/packing`, { packL: 100, packW: 50, packH: 40, packWeight: 0.5, packUpright: true, packSettings: { method: "layers", margin: 2, containers: ["a", "b"] }, packSpec: spec });
    expect(saved.status).toBe(200);
    const got = (await call("GET", `/items/${item.body.id}`)).body;
    expect(got).toMatchObject({ packL: 100, packW: 50, packH: 40, packWeight: 0.5, packUpright: true });
    expect(got.packSpec.perBox).toBe(60);
    expect(got.packSettings.margin).toBe(2);

    // Editing the part elsewhere keeps its packing.
    await call("PUT", `/items/${item.body.id}`, { partNumber: "PK-1", description: "Bracket, zinc" });
    expect((await call("GET", `/items/${item.body.id}`)).body.packSpec.container.code).toBe("CTN-403025");

    // Leaving the spec out keeps it; null clears it.
    await call("PUT", `/items/${item.body.id}/packing`, { packL: 101, packW: 50, packH: 40, packWeight: 0.5 });
    expect((await call("GET", `/items/${item.body.id}`)).body).toMatchObject({ packL: 101, packSpec: { perBox: 60 } });

    const cust = await call("POST", "/customers", { name: "Pack Co" });
    const quote = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ itemId: item.body.id, description: "Bracket", quantity: 100 }] });
    const order = await call("POST", `/quotes/${quote.body.id}/convert`, {});
    const so = await call("GET", `/sales-orders/${order.body.id}`);
    const job = await call("GET", `/jobs/${so.body.lines[0].jobs[0].id}`);
    expect(job.body.part.packSpec.perBox).toBe(60);

    await call("PUT", `/items/${item.body.id}/packing`, { packL: 101, packW: 50, packH: 40, packWeight: 0.5, packSpec: null });
    expect((await call("GET", `/items/${item.body.id}`)).body.packSpec).toBeNull();

    // Bad input is refused.
    expect((await call("PUT", `/items/${item.body.id}/packing`, { packL: -5, packW: 50, packH: 40, packWeight: 0.5 })).status).toBe(400);
    expect((await call("PUT", `/items/${item.body.id}/packing`, { packL: 1, packW: 1, packH: 1, packWeight: 1, packSpec: { ...spec, perBox: 0 } })).status).toBe(400);
  });
});

describe("packaging on quotes", () => {
  it("adds the packaging cost per part to the quote line", async () => {
    const { call } = await shop(env.app);
    const cust = await call("POST", "/customers", { name: "Packaging Co" });
    const item = await call("POST", "/items", { partNumber: "PK-2", description: "Door" });
    // The packing study keeps packaging apart from freight.
    const saved = await call("PUT", `/items/${item.body.id}/packing`, { packL: 100, packW: 50, packH: 40, packWeight: 0.5, packSpec: { ...spec, packagingPerPart: 0.05, freightPerPart: 0.0212 } });
    expect(saved.status).toBe(200);
    expect((await call("GET", `/items/${item.body.id}`)).body.packSpec.packagingPerPart).toBe(0.05);

    const line = { itemId: item.body.id, description: "PK-2 Door", quantity: 100, markupPct: 0, materials: [{ description: "Sheet", quantityPer: 1, unitCost: 2 }] };
    const q = await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ ...line, packagingPerUnit: 0.5 }] });
    expect(q.status).toBe(201);
    expect(q.body.lines[0]).toMatchObject({ packagingPerUnit: 0.5, unitCost: 2.5, totalCost: 250 });
    // Without packaging the cost is material only.
    const plain = await call("POST", "/quotes", { customerId: cust.body.id, lines: [line] });
    expect(plain.body.lines[0]).toMatchObject({ packagingPerUnit: 0, unitCost: 2 });
    expect((await call("POST", "/quotes", { customerId: cust.body.id, lines: [{ ...line, packagingPerUnit: -1 }] })).status).toBe(400);
  });
});
