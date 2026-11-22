import { describe, expect, it } from "vitest";
import {
  bestCartons,
  BOARD_GRADES,
  cartonStrengthN,
  DEFAULT_PACK_SETTINGS,
  evaluate,
  fillContainer,
  floorFill,
  loadPallet,
  rankOptions,
  returnableRoi,
  type PackContainer,
  type PackPallet,
  type PackSettings,
  type PackVehicle,
} from "./packing.ts";

const s: PackSettings = { ...DEFAULT_PACK_SETTINGS, margin: 0, boxWeightCap: 0, padThickness: 0, wrapCostPerPallet: 3, freightMode: "pallet", freightPerPallet: 85 };
const part = { l: 100, w: 50, h: 40, weight: 0.5 };
const tote: PackContainer = { id: "t", kind: "tote", name: "Tote", l: 300, w: 200, h: 200, wall: 0, tare: 1, maxLoad: 0, cost: 20, returnable: true, tripCost: 1, lifeTrips: 100 };
const pallet: PackPallet = { id: "p", name: "1200 × 800", l: 1200, w: 800, h: 150, tare: 20, maxLoad: 1000, maxHeight: 1350, cost: 10, returnable: false, tripCost: 0, lifeTrips: 1 };
const truck: PackVehicle = { id: "v", name: "Trailer", l: 13600, w: 2450, h: 2700, payload: 24000 };

describe("floorFill", () => {
  it("turns boxes to fill a pallet", () => {
    expect(floorFill(1200, 800, 400, 300).count).toBe(8); // 4 × 2 with 300 along the length
  });
  it("mixes two directions when that fits more", () => {
    // Uniform grids fit 15; two rows of 300 × 200 plus the rest turned fits 6 + 10 = 16.
    const f = floorFill(1000, 1000, 300, 200);
    expect(f.count).toBe(16);
    expect(f.rects).toHaveLength(16);
    for (const r of f.rects) {
      expect(r.x + r.l).toBeLessThanOrEqual(1000);
      expect(r.y + r.w).toBeLessThanOrEqual(1000);
    }
  });
});

describe("fillContainer", () => {
  it("fills the box exactly when the part divides it", () => {
    const f = fillContainer(part, { l: 300, w: 200, h: 200 }, 1, 0, s)!;
    expect(f.count).toBe(60); // 12 000 000 / 200 000
    expect(f.fill).toBeCloseTo(1, 5);
    expect(f.limitedBy).toBe("space");
  });
  it("stops at the lift limit", () => {
    const f = fillContainer(part, { l: 300, w: 200, h: 200 }, 1, 0, { ...s, boxWeightCap: 18 })!;
    expect(f.count).toBe(34); // (18 − 1 kg box) / 0.5 kg
    expect(f.limitedBy).toBe("weight");
  });
  it("keeps the part upright when asked", () => {
    const f = fillContainer({ ...part, upright: true }, { l: 300, w: 200, h: 90 }, 1, 0, s)!;
    expect(f.vertical).toBe("h");
    expect(f.count).toBe(24); // 12 per layer, 2 layers of 40
  });
  it("counts layer pads into the height", () => {
    // 40 mm layers with 5 mm pads: 4 × 40 + 3 × 5 = 175 ≤ 180, a fifth would need 220.
    const f = fillContainer({ ...part, upright: true }, { l: 300, w: 200, h: 180 }, 1, 0, { ...s, padThickness: 5 })!;
    expect(f.layers).toBe(4);
    expect(f.pads).toBe(3);
  });
  it("stacks nesting parts by their pitch", () => {
    // A 40 mm cup that adds 8 mm per extra cup in a 200 mm box: 1 + (200 − 40) / 8 = 21 a stack.
    const f = fillContainer({ ...part, nestPitch: 8 }, { l: 300, w: 200, h: 200 }, 1, 0, { ...s, method: "nest" })!;
    expect(f.perStack).toBe(21);
    expect(f.count).toBe(12 * 21);
  });
});

describe("pallets and cartons", () => {
  it("is limited by pallet weight", () => {
    const p = loadPallet({ l: 400, w: 300, h: 250 }, 40, pallet, null, 5)!;
    expect(p.perLayer).toBe(8);
    expect(p.boxes).toBe(25); // 4 layers would be 32, but 1000 kg / 40 kg = 25
    expect(p.limitedBy).toBe("weight");
  });
  it("works out carton strength", () => {
    // 400 × 300 outside, C flute ECT 32: 5.87 × 32 × √(0.1575 in × 55.12 in) ≈ 553 lbf ≈ 2461 N
    expect(cartonStrengthN({ l: 400, w: 300, h: 250 }, BOARD_GRADES[1])).toBeGreaterThan(2450);
    expect(cartonStrengthN({ l: 400, w: 300, h: 250 }, BOARD_GRADES[1])).toBeLessThan(2470);
  });
  it("lets a weak carton stack fewer layers", () => {
    // 2461 N / (5 × 25 kg × 9.81) = 2.0 → the bottom box carries 2 more, so 3 layers.
    const p = loadPallet({ l: 400, w: 300, h: 250 }, 25, pallet, 2461, 5)!;
    expect(p.layers).toBe(3);
    expect(p.limitedBy).toBe("strength");
  });
});

describe("evaluate", () => {
  it("costs a full truck per part", () => {
    const o = evaluate(part, tote, pallet, truck, s)!;
    expect(o.box.count).toBe(60);
    expect(o.palletLoad.boxes).toBe(32); // 1000 kg / 31 kg
    expect(o.partsPerPallet).toBe(1920);
    expect(o.perPart.container).toBeCloseTo(0.02, 4); // (1 trip + 20 / 100 trips) / 60
    expect(o.perPart.pallet).toBeCloseTo(13 / 1920, 4);
    expect(o.perPart.freight).toBeCloseTo(85 / 1920, 4);
    expect(o.perPart.total).toBeCloseTo(0.02 + 13 / 1920 + 85 / 1920, 3);
  });
  it("costs a real shipment", () => {
    const o = evaluate(part, tote, pallet, truck, { ...s, shipQty: 500 })!;
    // 9 totes × 1.20 + one pallet (10 + 3 wrap) + 85 freight
    expect(o.shipment).toMatchObject({ boxes: 9, pallets: 1, total: 108.8 });
    expect(o.rankCost).toBeCloseTo(0.2176, 4);
  });
  it("leaves out containers the part does not fit", () => {
    const small = { ...tote, id: "s", l: 90, w: 90, h: 90 };
    expect(rankOptions({ ...part, upright: true }, [small, tote], [pallet], [truck], s).map((o) => o.container.id)).toEqual(["t"]);
  });
});

describe("bestCartons", () => {
  it("sizes cartons around whole parts and ranks them", () => {
    const r = bestCartons({ l: 100, w: 100, h: 100, weight: 0.1 }, pallet, truck, { ...s, freightMode: "load" }, { min: 100, max: 600 });
    expect(r.length).toBeGreaterThan(0);
    expect(r[0]!.box.fill).toBeGreaterThan(0.95);
    for (let i = 1; i < r.length; i++) expect(r[i]!.rankCost).toBeGreaterThanOrEqual(r[i - 1]!.rankCost);
    for (const o of r) expect(o.container.grade).toBeTruthy();
  });
});

describe("returnableRoi", () => {
  it("sizes the fleet and the break-even", () => {
    // 50 000 / 250 days / 50 a tote = 4 totes a day, away 10 days, +10% spares → 44 totes
    const r = returnableRoi({ annualParts: 50000, partsPerContainer: 50, containerPrice: 25, cycleDays: 10, oneWayPerPart: 0.1, returnablePerPart: 0.04 });
    expect(r).toEqual({ fleet: 44, capital: 1100, annualSaving: 3000, breakEvenMonths: 4.4 });
  });
  it("never breaks even when returnable costs more to run", () => {
    expect(returnableRoi({ annualParts: 1000, partsPerContainer: 10, containerPrice: 25, cycleDays: 10, oneWayPerPart: 0.1, returnablePerPart: 0.2 }).breakEvenMonths).toBeNull();
  });
});
