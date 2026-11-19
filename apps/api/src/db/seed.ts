/**
 * Demo data for local development: one sample shop with work centers, parts, customers,
 * quotes, an order and jobs.  Run: npm run db:seed -w @ironline/api
 * Log in with the e-mail and password below (local development only).
 */
import { eq } from "drizzle-orm";
import type { Ctx } from "../ctx.ts";
import { signup } from "../services/auth.ts";
import { addContact, createCustomer } from "../services/customers.ts";
import { createItem, createWorkCenter } from "../services/items.ts";
import { changeQuoteStatus, convertQuote, createQuote } from "../services/quotes.ts";
import { createDb } from "./client.ts";
import { runMigrations } from "./migrate.ts";
import { users } from "./schema.ts";

export const DEMO_LOGIN = { email: "demo@ironline.local", password: "demo-shop-password" };

const { db, pool } = createDb();
await runMigrations(db);
const [existing] = await db.select().from(users).where(eq(users.email, DEMO_LOGIN.email));
if (existing) {
  console.log(`Demo shop already exists. Log in as ${DEMO_LOGIN.email}.`);
} else {
  const s = await signup(db, { orgName: "Demo Machine Works", name: "Demo Owner", ...DEMO_LOGIN });
  const ctx: Ctx = { orgId: s.orgId, userId: s.userId, role: "owner" };

  const wc = {
    saw: await createWorkCenter(db, ctx, { code: "SAW", name: "Band saw", kind: "machine", hourlyRate: 55, capacityHoursPerDay: 8, active: true }),
    mill: await createWorkCenter(db, ctx, { code: "VMC1", name: "3-axis vertical mill", kind: "machine", hourlyRate: 95, capacityHoursPerDay: 16, active: true }),
    lathe: await createWorkCenter(db, ctx, { code: "LATHE1", name: "CNC lathe with live tooling", kind: "machine", hourlyRate: 90, capacityHoursPerDay: 16, active: true }),
    laser: await createWorkCenter(db, ctx, { code: "LASER", name: "Fiber laser 3 kW", kind: "machine", hourlyRate: 150, capacityHoursPerDay: 16, active: true }),
    brake: await createWorkCenter(db, ctx, { code: "BRAKE", name: "Press brake", kind: "machine", hourlyRate: 85, capacityHoursPerDay: 8, active: true }),
    deburr: await createWorkCenter(db, ctx, { code: "DEB", name: "Deburr and finish bench", kind: "labor", hourlyRate: 45, capacityHoursPerDay: 8, active: true }),
    qc: await createWorkCenter(db, ctx, { code: "QC", name: "Final inspection", kind: "labor", hourlyRate: 65, capacityHoursPerDay: 8, active: true }),
  };

  const base = { revision: "A", uom: "ea", salePrice: 0, active: true, routing: [], bom: [] };
  const bar = await createItem(db, ctx, { ...base, partNumber: "AL6061-RD-2", description: "6061-T6 round bar 2 in, per inch", type: "material", uom: "in", unitCost: 1.85 });
  const sheet = await createItem(db, ctx, { ...base, partNumber: "SS304-16GA", description: "304 stainless sheet 16 ga, per sq ft", type: "material", uom: "sqft", unitCost: 6.4 });
  const pem = await createItem(db, ctx, { ...base, partNumber: "PEM-S-832-2", description: "Self-clinching nut 8-32", type: "purchased", unitCost: 0.18 });
  const hub = await createItem(db, ctx, {
    ...base,
    partNumber: "DMW-1040",
    description: "Drive hub, turned and milled",
    type: "manufactured",
    unitCost: 0,
    salePrice: 64,
    routing: [
      { workCenterId: wc.saw.id, description: "Cut blanks 2.25 in", setupHours: 0.25, runHoursPerUnit: 0.02 },
      { workCenterId: wc.lathe.id, description: "Turn OD, bore, face both sides", setupHours: 1.5, runHoursPerUnit: 0.18 },
      { workCenterId: wc.mill.id, description: "Mill keyway and bolt circle", setupHours: 1, runHoursPerUnit: 0.12 },
      { workCenterId: wc.deburr.id, description: "Deburr", setupHours: 0, runHoursPerUnit: 0.05 },
      { workCenterId: wc.qc.id, description: "Inspect per drawing", setupHours: 0.25, runHoursPerUnit: 0.03 },
    ],
    bom: [{ componentItemId: bar.id, quantityPer: 2.25, scrapPct: 5 }],
  });
  const cover = await createItem(db, ctx, {
    ...base,
    partNumber: "DMW-2210",
    description: "Electrical enclosure cover, 304 SS",
    type: "manufactured",
    unitCost: 0,
    salePrice: 48,
    routing: [
      { workCenterId: wc.laser.id, description: "Cut flat pattern", setupHours: 0.25, runHoursPerUnit: 0.04 },
      { workCenterId: wc.brake.id, description: "Form 4 flanges", setupHours: 0.5, runHoursPerUnit: 0.06 },
      { workCenterId: wc.deburr.id, description: "Install 4 PEM nuts, grain finish", setupHours: 0, runHoursPerUnit: 0.08 },
    ],
    bom: [
      { componentItemId: sheet.id, quantityPer: 1.6, scrapPct: 12 },
      { componentItemId: pem.id, quantityPer: 4, scrapPct: 2 },
    ],
  });

  const cust = async (name: string, contact: string, status: "active" | "prospect" = "active") => {
    const c = await createCustomer(db, ctx, { name, status, paymentTermsDays: 30, billingAddress: {}, shippingAddress: {}, email: null });
    const ct = await addContact(db, ctx, c.id, { name: contact, isPrimary: true, email: null });
    return { c, ct };
  };
  const northwind = await cust("Northwind Robotics", "Dana Okafor");
  const lakeside = await cust("Lakeside HVAC Controls", "Priya Raman");
  await cust("Summit Medical Devices", "Jordan Lee", "prospect");

  const ops = (item: Awaited<ReturnType<typeof createItem>>) =>
    item.routing.map((r) => ({ workCenterId: r.workCenterId, description: r.description, setupHours: r.setupHours, runHoursPerUnit: r.runHoursPerUnit, rate: null }));
  const mats = (item: Awaited<ReturnType<typeof createItem>>) =>
    item.bom.map((b) => ({ kind: "material" as const, itemId: b.componentItemId, description: `${b.partNumber} ${b.description}`, quantityPer: b.quantityPer, unitCost: b.unitCost, scrapPct: b.scrapPct, perLot: false }));

  const q1 = await createQuote(db, ctx, {
    customerId: northwind.c.id,
    contactId: northwind.ct.id,
    leadTimeDays: 15,
    lines: [
      { itemId: hub.id, description: "DMW-1040 rev A — Drive hub", quantity: 50, markupPct: 30, operations: ops(hub), materials: [...mats(hub), { kind: "service", itemId: null, description: "Black anodize type II", quantityPer: 1, unitCost: 175, scrapPct: 0, perLot: true }] },
    ],
  });
  await changeQuoteStatus(db, ctx, q1.id, "send");
  await convertQuote(db, ctx, q1.id, { customerPo: "NW-55102", lineIds: [], createJobs: true });

  const q2 = await createQuote(db, ctx, {
    customerId: lakeside.c.id,
    contactId: lakeside.ct.id,
    leadTimeDays: 10,
    lines: [{ itemId: cover.id, description: "DMW-2210 rev A — Enclosure cover", quantity: 120, markupPct: 28, operations: ops(cover), materials: mats(cover) }],
  });
  await changeQuoteStatus(db, ctx, q2.id, "send");

  await createQuote(db, ctx, {
    customerId: northwind.c.id,
    contactId: northwind.ct.id,
    leadTimeDays: 20,
    notes: "Prototype quantity; production pricing on request.",
    lines: [
      {
        description: "Sensor bracket per drawing NW-883 rev C",
        quantity: 10,
        markupPct: 35,
        operations: [
          { workCenterId: wc.mill.id, description: "Two setups, 5 features", setupHours: 2, runHoursPerUnit: 0.35, rate: null },
          { workCenterId: wc.deburr.id, description: "Deburr", setupHours: 0, runHoursPerUnit: 0.1, rate: null },
        ],
        materials: [{ kind: "material", itemId: null, description: "6061 plate 0.5 x 3 x 4 in", quantityPer: 1, unitCost: 7.5, scrapPct: 5, perLot: false }],
      },
    ],
  });
  console.log(`Demo shop created. Log in as ${DEMO_LOGIN.email}.`);
}
await pool.end();
