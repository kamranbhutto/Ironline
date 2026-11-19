import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupApp, shop } from "./helpers.ts";

let env: Awaited<ReturnType<typeof setupApp>>;
beforeAll(async () => {
  env = await setupApp();
});
afterAll(async () => env.close());

describe("auth", () => {
  it("signs up, reads the session, logs out", async () => {
    const s = await shop(env.app);
    expect(s.me.role).toBe("owner");
    expect((await s.call("GET", "/auth/me")).status).toBe(200);
    expect((await env.app.inject({ method: "GET", url: "/api/v1/auth/me" })).statusCode).toBe(401);
  });

  it("rejects a wrong password and a duplicate e-mail", async () => {
    const email = `dup-${Date.now()}@example.test`;
    const body = { orgName: "Dup Shop", name: "A", email, password: "correct horse battery" };
    expect((await env.app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: body })).statusCode).toBe(201);
    expect((await env.app.inject({ method: "POST", url: "/api/v1/auth/signup", payload: body })).statusCode).toBe(409);
    const bad = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: "nope" } });
    expect(bad.statusCode).toBe(401);
    const good = await env.app.inject({ method: "POST", url: "/api/v1/auth/login", payload: { email, password: body.password } });
    expect(good.statusCode).toBe(200);
  });

  it("blocks state changes from another site", async () => {
    const r = await env.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { origin: "https://evil.example", host: "127.0.0.1:4100" },
      payload: { email: "x@example.test", password: "x" },
    });
    expect(r.statusCode).toBe(403);
  });
});

describe("quote to job", () => {
  it("prices a quote, converts it to a sales order and creates a job with the quoted routing", async () => {
    const { call } = await shop(env.app);

    const cust = await call("POST", "/customers", { name: "Northwind Robotics", email: "buyer@northwind.test" });
    expect(cust.status).toBe(201);
    expect(cust.body.code).toBe("C-00001");
    const contact = await call("POST", `/customers/${cust.body.id}/contacts`, { name: "Dana Buyer", isPrimary: true });
    expect(contact.status).toBe(201);

    const mill = await call("POST", "/work-centers", { code: "MILL1", name: "Haas VF-2", hourlyRate: 90 });
    const deburr = await call("POST", "/work-centers", { code: "DEB", name: "Deburr bench", kind: "labor", hourlyRate: 40 });
    expect(mill.status).toBe(201);

    const quote = await call("POST", "/quotes", {
      customerId: cust.body.id,
      contactId: contact.body.id,
      leadTimeDays: 10,
      lines: [
        {
          description: "Bracket, 6061-T6, anodized",
          quantity: 10,
          markupPct: 25,
          operations: [
            { workCenterId: mill.body.id, setupHours: 1.5, runHoursPerUnit: 0.25 }, // rate from work center
            { workCenterId: deburr.body.id, setupHours: 0.25, runHoursPerUnit: 0.05, rate: 40 },
          ],
          materials: [
            { description: "6061 bar 2x3", quantityPer: 1, unitCost: 12, scrapPct: 5 },
            { kind: "service", description: "Anodize type II", quantityPer: 1, unitCost: 150, perLot: true },
          ],
        },
      ],
    });
    expect(quote.status).toBe(201);
    expect(quote.body.number).toBe("Q-00001");
    const line = quote.body.lines[0];
    expect(line.unitCost).toBe(66.6);
    expect(line.unitPrice).toBe(83.25);
    expect(quote.body.totalPrice).toBe(832.5);
    expect(line.operations[0].rate).toBe(90);

    expect((await call("POST", `/quotes/${quote.body.id}/send`)).body.status).toBe("sent");

    const order = await call("POST", `/quotes/${quote.body.id}/convert`, { customerPo: "PO-7781" });
    expect(order.status).toBe(201);
    expect(order.body.number).toBe("SO-00001");

    const won = await call("GET", `/quotes/${quote.body.id}`);
    expect(won.body.status).toBe("won");
    expect((await call("PUT", `/quotes/${quote.body.id}`, { customerId: cust.body.id, lines: [] })).status).toBe(409);

    const so = await call("GET", `/sales-orders/${order.body.id}`);
    expect(so.body.status).toBe("in_production");
    expect(so.body.lines[0].unitPrice).toBe(83.25);
    const jobRef = so.body.lines[0].jobs[0];
    expect(jobRef.number).toBe("J-00001");

    // The one-off quote line became a real part with the quoted routing.
    const parts = await call("GET", "/items?q=Q-00001-1");
    expect(parts.body).toHaveLength(1);
    expect((await call("GET", `/items/${parts.body[0].id}`)).body.routing).toHaveLength(2);

    const job = await call("GET", `/jobs/${jobRef.id}`);
    expect(job.body.itemId).toBe(parts.body[0].id);
    expect(job.body.estimatedCost).toBe(666);
    expect(job.body.revenue).toBe(832.5);
    expect(job.body.operations.map((o: { workCenterCode: string }) => o.workCenterCode)).toEqual(["MILL1", "DEB"]);
    expect(job.body.materials[0].quantityRequired).toBe(10.5);
    expect(job.body.materials[1].quantityRequired).toBe(1);

    // A second job for the same line is refused.
    expect((await call("POST", `/sales-order-lines/${so.body.lines[0].id}/jobs`)).status).toBe(409);

    const released = await call("POST", `/jobs/${jobRef.id}/status`, { status: "released" });
    expect(released.body.status).toBe("released");
    expect(released.body.operations[0].status).toBe("ready");
    expect((await call("POST", `/jobs/${jobRef.id}/status`, { status: "closed" })).status).toBe(409);

    // Customer list counts open documents per customer.
    const custList = await call("GET", "/customers");
    expect(custList.body[0]).toMatchObject({ openQuotes: 0, openOrders: 1 });

    const dash = await call("GET", "/dashboard");
    expect(dash.body).toMatchObject({ openOrders: 1, openJobs: 1, backlog: 832.5 });
  });

  it("builds a job from the item routing and BOM when there is no quote", async () => {
    const { call } = await shop(env.app);
    const wc = await call("POST", "/work-centers", { code: "LASER", name: "Fiber laser", hourlyRate: 150 });
    const sheet = await call("POST", "/items", { partNumber: "SHT-304-16", description: "304 SS sheet 16ga", type: "material", unitCost: 4 });
    const part = await call("POST", "/items", {
      partNumber: "PNL-100",
      description: "Panel",
      routing: [{ workCenterId: wc.body.id, setupHours: 0.5, runHoursPerUnit: 0.1 }],
      bom: [{ componentItemId: sheet.body.id, quantityPer: 2, scrapPct: 10 }],
    });
    expect(part.status).toBe(201);
    expect(part.body.routing).toHaveLength(1);
    expect(part.body.bom[0].partNumber).toBe("SHT-304-16");

    const cust = await call("POST", "/customers", { name: "Lakeside HVAC" });
    const q = await call("POST", "/quotes", {
      customerId: cust.body.id,
      lines: [{ itemId: part.body.id, description: "Panel", quantity: 5 }],
    });
    const order = await call("POST", `/quotes/${q.body.id}/convert`, { createJobs: false });
    const so = await call("GET", `/sales-orders/${order.body.id}`);
    expect(so.body.lines[0].jobs).toHaveLength(0);
    expect(so.body.status).toBe("confirmed");

    // The quote line has no operations of its own, so the job uses the part's routing and BOM.
    const created = await call("POST", `/sales-order-lines/${so.body.lines[0].id}/jobs`);
    expect(created.status).toBe(201);
    const job = await call("GET", `/jobs/${created.body.id}`);
    expect(job.body.operations[0]).toMatchObject({ workCenterCode: "LASER", rate: 150 });
    expect(job.body.materials[0].quantityRequired).toBe(11); // 2 per panel x 5 x 1.10 scrap
    expect(job.body.estimatedCost).toBe(194); // (0.5 + 0.1 x 5) x 150 + 11 x 4
  });

  it("rejects parts that list themselves in their own BOM", async () => {
    const { call } = await shop(env.app);
    const p = await call("POST", "/items", { partNumber: "X1", description: "X" });
    const r = await call("PUT", `/items/${p.body.id}`, { partNumber: "X1", description: "X", bom: [{ componentItemId: p.body.id, quantityPer: 1 }] });
    expect(r.status).toBe(400);
  });
});

describe("tenant isolation", () => {
  it("never shows or links another shop's records", async () => {
    const a = await shop(env.app, "Shop A");
    const b = await shop(env.app, "Shop B");
    const cust = await a.call("POST", "/customers", { name: "Secret Customer" });
    const wc = await a.call("POST", "/work-centers", { code: "M1", name: "Mill", hourlyRate: 80 });

    expect((await b.call("GET", `/customers/${cust.body.id}`)).status).toBe(404);
    expect((await b.call("GET", "/customers")).body).toHaveLength(0);
    expect((await b.call("PATCH", `/customers/${cust.body.id}`, { name: "Hacked" })).status).toBe(404);

    // B cannot quote A's customer or use A's work center.
    const q1 = await b.call("POST", "/quotes", { customerId: cust.body.id, lines: [] });
    expect(q1.status).toBe(400);
    const own = await b.call("POST", "/customers", { name: "B's customer" });
    const q2 = await b.call("POST", "/quotes", {
      customerId: own.body.id,
      lines: [{ description: "x", quantity: 1, operations: [{ workCenterId: wc.body.id, setupHours: 1 }] }],
    });
    expect(q2.status).toBe(400);
    // Numbering is per shop.
    expect(own.body.code).toBe("C-00001");
  });
});
