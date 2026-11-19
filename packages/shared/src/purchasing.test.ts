import { describe, expect, it } from "vitest";
import { planItem } from "./purchasing.ts";

const base = { today: "2026-11-20", endDate: "2027-02-20", onHand: 100, minOnHand: null, demand: [], incoming: [], leadDays: 10, minOrder: null };

describe("planItem", () => {
  it("needs nothing when stock covers demand", () => {
    const r = planItem({ ...base, demand: [{ date: "2026-12-01", quantity: 60 }] });
    expect(r).toMatchObject({ toBuy: 0, shortageDate: null, late: false, urgent: false, projected: 40 });
  });
  it("buys the shortfall plus the minimum, rounded up to the minimum order", () => {
    const r = planItem({ ...base, minOnHand: 20, demand: [{ date: "2026-12-15", quantity: 150 }], minOrder: 100 });
    expect(r.toBuy).toBe(100); // short 50 + keep 20 = 70, vendor sells 100
    expect(r.shortageDate).toBe("2026-12-15");
    expect(r.late).toBe(false); // arrives 11-30
  });
  it("counts incoming orders and flags when an order today cannot arrive in time", () => {
    const r = planItem({ ...base, leadDays: 30, demand: [{ date: "2026-11-25", quantity: 130 }, { date: "2027-01-10", quantity: 50 }], incoming: [{ date: "2026-12-30", quantity: 40 }] });
    expect(r.toBuy).toBe(40);
    expect(r.shortageDate).toBe("2026-11-25");
    expect(r.late).toBe(true);
    expect(r.urgent).toBe(true);
    expect(r.timeline.at(-1)!.balance).toBe(-40);
  });
  it("treats undated demand as needed now and ignores events after the end date", () => {
    const r = planItem({ ...base, onHand: 0, demand: [{ date: null, quantity: 5, priority: 90 }, { date: "2027-06-01", quantity: 999 }] });
    expect(r.demand).toBe(5);
    expect(r.shortageDate).toBe("2026-11-20");
    expect(r.urgent).toBe(true);
  });
});
