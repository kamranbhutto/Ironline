import { describe, expect, it } from "vitest";
import { capability, defaultTolerance, DEFAULT_TOLERANCES, inTolerance, limitsOf, piecesToCheck, toleranceText } from "./quality.ts";

const bore = { nominal: 0.44, tolPlus: 0.005, tolMinus: 0.005 };

describe("limits and tolerance", () => {
  it("builds inclusive limits without float noise", () => {
    expect(limitsOf(bore)).toEqual({ lower: 0.435, upper: 0.445 });
    expect(inTolerance(bore, 0.445)).toBe(true);
    expect(inTolerance(bore, 0.435)).toBe(true);
    expect(inTolerance(bore, 0.4451)).toBe(false);
    expect(inTolerance(bore, 0.43)).toBe(false);
  });
  it("handles one-sided limits and missing data", () => {
    const flat = { nominal: 0, tolPlus: 0.002, tolMinus: null };
    expect(limitsOf(flat)).toEqual({ lower: null, upper: 0.002 });
    expect(inTolerance(flat, -5)).toBe(true);
    expect(inTolerance(flat, 0.003)).toBe(false);
    expect(inTolerance({ nominal: null, tolPlus: null, tolMinus: null }, 1)).toBeNull();
    expect(inTolerance(bore, null)).toBeNull();
  });
  it("writes tolerances the way a drawing does", () => {
    expect(toleranceText(bore)).toBe("±0.005");
    expect(toleranceText({ nominal: 7.1, tolPlus: 0.008, tolMinus: 0 })).toBe("+0.008 / -0");
    expect(toleranceText({ nominal: 0, tolPlus: 0.002, tolMinus: null })).toBe("+0.002 / no min");
  });
  it("picks the title-block tolerance from the decimals written", () => {
    expect(defaultTolerance("12", "length", DEFAULT_TOLERANCES)).toBe(0.5);
    expect(defaultTolerance("12.50", "diameter", DEFAULT_TOLERANCES)).toBe(0.1);
    expect(defaultTolerance("30", "angle", DEFAULT_TOLERANCES)).toBe(0.5);
    expect(defaultTolerance("x", "note", DEFAULT_TOLERANCES)).toBeNull();
  });
});

describe("sampling", () => {
  it("checks the first piece, then every Nth", () => {
    expect(piecesToCheck("every_n", 5, 20)).toEqual([1, 5, 10, 15, 20]);
    expect(piecesToCheck("first", null, 20)).toEqual([1]);
    expect(piecesToCheck("all", null, 3)).toEqual([1, 2, 3]);
    expect(piecesToCheck("every_n", 5, 0)).toEqual([]);
  });
});

describe("capability", () => {
  it("returns no Cpk for fewer than two readings or no spread", () => {
    expect(capability(bore, []).cpk).toBeNull();
    expect(capability(bore, [0.44]).cpk).toBeNull();
    expect(capability(bore, [0.44, 0.44, 0.44]).cpk).toBeNull();
  });
  it("uses the nearer limit", () => {
    const r = capability(bore, [0.441, 0.442, 0.443]);
    expect(r.mean).toBe(0.442);
    expect(r.stdDev).toBe(0.001);
    expect(r.cpk).toBe(1); // (0.445 - 0.442) / (3 * 0.001)
  });
});
