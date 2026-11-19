/**
 * Inspection maths shared by the API (which decides pass/fail when a reading is saved) and the
 * web app (which colours inputs as the operator types).
 */

/** What a balloon on a drawing checks. "note" is a pass/fail requirement with no number. */
export const CHARACTERISTIC_KINDS = ["length", "diameter", "radius", "angle", "position", "flatness", "perpendicularity", "runout", "roughness", "thread", "note"] as const;
export type CharacteristicKind = (typeof CHARACTERISTIC_KINDS)[number];

/** How often a characteristic is checked: first piece only, every Nth piece (and the first), or every piece. */
export const SAMPLING = ["first", "every_n", "all"] as const;
export type Sampling = (typeof SAMPLING)[number];

export interface Limits {
  nominal: number | null;
  /** Allowed amount above nominal (positive number), or null for no upper limit. */
  tolPlus: number | null;
  /** Allowed amount below nominal (positive number), or null for no lower limit. */
  tolMinus: number | null;
}

const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Lowest and highest acceptable value. A missing side is open (null). */
export function limitsOf(c: Limits): { lower: number | null; upper: number | null } {
  if (c.nominal == null) return { lower: null, upper: null };
  return {
    lower: c.tolMinus == null ? null : round(c.nominal - Math.abs(c.tolMinus)),
    upper: c.tolPlus == null ? null : round(c.nominal + Math.abs(c.tolPlus)),
  };
}

/** True when a measured value is inside the limits (limits are inclusive). Null when nothing can be judged. */
export function inTolerance(c: Limits, value: number | null | undefined): boolean | null {
  if (value == null || !Number.isFinite(value)) return null;
  const { lower, upper } = limitsOf(c);
  if (lower == null && upper == null) return null;
  const v = round(value);
  return (lower == null || v >= lower) && (upper == null || v <= upper);
}

/** Pieces (1-based) that must be checked in a run of `quantity`. "every_n" always includes the first piece. */
export function piecesToCheck(sampling: Sampling, everyN: number | null, quantity: number): number[] {
  const q = Math.max(0, Math.floor(quantity));
  if (q === 0) return [];
  if (sampling === "first") return [1];
  if (sampling === "all") return Array.from({ length: q }, (_, i) => i + 1);
  const n = Math.max(1, Math.floor(everyN ?? 1));
  const out = new Set<number>([1]);
  for (let p = n; p <= q; p += n) out.add(p);
  return [...out].sort((a, b) => a - b);
}

/** Text shown for a tolerance, e.g. "±0.005", "+0.01 / -0.02", "max", "min". */
export function toleranceText(c: Limits): string {
  const p = c.tolPlus == null ? null : Math.abs(c.tolPlus);
  const m = c.tolMinus == null ? null : Math.abs(c.tolMinus);
  if (p == null && m == null) return "";
  if (p != null && m != null && p === m) return `±${p}`;
  if (p == null) return `-${m} / no max`;
  if (m == null) return `+${p} / no min`;
  return `+${p} / -${m}`;
}

export interface Capability {
  count: number;
  mean: number | null;
  /** Sample standard deviation (n − 1). */
  stdDev: number | null;
  /**
   * Process capability index: distance from the mean to the nearest limit in units of three
   * standard deviations. Needs at least 2 readings with some spread, and at least one limit.
   */
  cpk: number | null;
}

export function capability(c: Limits, values: number[]): Capability {
  const v = values.filter((x) => Number.isFinite(x));
  const count = v.length;
  if (!count) return { count, mean: null, stdDev: null, cpk: null };
  const mean = v.reduce((a, b) => a + b, 0) / count;
  if (count < 2) return { count, mean: round(mean), stdDev: null, cpk: null };
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (count - 1));
  const { lower, upper } = limitsOf(c);
  if (sd === 0 || (lower == null && upper == null)) return { count, mean: round(mean), stdDev: round(sd), cpk: null };
  const sides = [upper == null ? Infinity : (upper - mean) / (3 * sd), lower == null ? Infinity : (mean - lower) / (3 * sd)];
  return { count, mean: round(mean), stdDev: round(sd), cpk: Math.round(Math.min(...sides) * 100) / 100 };
}

/**
 * Tolerance used when a balloon has a nominal but no tolerance of its own: the shop's title-block
 * tolerance for the number of decimal places written on the drawing (e.g. X.X ±0.5, X.XX ±0.25).
 */
export function defaultTolerance(nominalText: string, kind: CharacteristicKind, table: { linear: number[]; angular: number }): number | null {
  if (kind === "note" || kind === "roughness" || kind === "thread") return null;
  if (kind === "angle") return table.angular;
  const dec = (nominalText.split(".")[1] ?? "").replace(/\D/g, "").length;
  return table.linear[Math.min(dec, table.linear.length - 1)] ?? null;
}

export const DEFAULT_TOLERANCES = { linear: [0.5, 0.25, 0.1, 0.005], angular: 0.5 };
