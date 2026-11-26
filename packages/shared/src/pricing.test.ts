import { describe, expect, it } from "vitest";
import { priceBreaks, priceLine } from "./pricing.ts";

const line = {
  markupPct: 25,
  operations: [
    { setupHours: 1.5, runHoursPerUnit: 0.25, rate: 90 }, // CNC mill
    { setupHours: 0.25, runHoursPerUnit: 0.05, rate: 40 }, // deburr
  ],
  materials: [
    { kind: "material" as const, quantityPer: 1, unitCost: 12, scrapPct: 5, perLot: false },
    { kind: "service" as const, quantityPer: 1, unitCost: 150, scrapPct: 0, perLot: true }, // anodize lot charge
  ],
};

describe("priceLine", () => {
  it("adds setup once, run per piece, material with scrap and a per-lot service", () => {
    const r = priceLine({ ...line, quantity: 10 });
    // mill (1.5 + 2.5) * 90 = 360; deburr (0.25 + 0.5) * 40 = 30
    expect(r.operationCosts).toEqual([360, 30]);
    expect(r.laborCost).toBe(390);
    expect(r.materialCost).toBe(126); // 10 * 1.05 * 12
    expect(r.serviceCost).toBe(150);
    expect(r.totalCost).toBe(666);
    expect(r.unitCost).toBe(66.6);
    expect(r.unitPrice).toBe(83.25); // +25 %
    expect(r.totalPrice).toBe(832.5);
    expect(r.marginPct).toBe(20); // 166.5 / 832.5
    expect(r.totalHours).toBe(4.75);
  });

  it("uses an override price when the estimator sets one", () => {
    const r = priceLine({ ...line, quantity: 10, unitPriceOverride: 70 });
    expect(r.unitPrice).toBe(70);
    expect(r.totalPrice).toBe(700);
    expect(r.marginPct).toBe(4.86);
  });

  it("makes larger quantities cheaper per piece because setup is shared", () => {
    const [a, b] = priceBreaks(line, [10, 100]);
    expect(b!.unitPrice).toBeLessThan(a!.unitPrice);
  });

  it("adds packaging for every piece", () => {
    const r = priceLine({ ...line, quantity: 10, packagingPerUnit: 0.75 });
    expect(r.packagingCost).toBe(7.5);
    expect(r.totalCost).toBe(673.5); // 666 + 7.5
    expect(r.unitCost).toBe(67.35);
    expect(priceLine({ ...line, quantity: 10 }).packagingCost).toBe(0);
  });

  it("rejects a zero quantity", () => {
    expect(() => priceLine({ ...line, quantity: 0 })).toThrow();
  });
});
