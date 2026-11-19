import { describe, expect, it } from "vitest";
import { bucketOf, bucketLabel, compute, type Column, type View } from "./report.ts";

const cols: Column[] = [
  { key: "day", label: "Day", type: "date" },
  { key: "who", label: "Who", type: "text" },
  { key: "kind", label: "Kind", type: "text" },
  { key: "hours", label: "Hours", type: "number" },
];
const rows = [
  { day: "2026-10-30", who: "Ana", kind: "setup", hours: 1 },
  { day: "2026-11-02", who: "Ana", kind: "run", hours: 3 },
  { day: "2026-11-19", who: "Ben", kind: "run", hours: 2 },
  { day: "2026-11-20", who: "Ben", kind: "setup", hours: 0.5 },
];
const base: View = { name: "v", chart: "bar", values: [{ field: "hours", agg: "sum" }], groupBy: null, breakdown: null, filters: [], hidden: [], sort: "label", limit: null, stacked: false };

describe("report compute", () => {
  it("buckets dates and labels them", () => {
    expect(bucketOf("2026-11-19", "month")).toBe("2026-11");
    expect(bucketOf("2026-11-19", "quarter")).toBe("2026-Q4");
    expect(bucketOf("2026-11-19", "week")).toBe("2026-W47");
    expect(bucketLabel("2026-11")).toBe("Nov 2026");
    expect(bucketLabel("2026-Q4")).toBe("Q4 2026");
  });
  it("groups by month and totals", () => {
    const r = compute(rows, { ...base, groupBy: { field: "day", bucket: "month" } }, cols);
    expect(r.data.map((d) => [d.label, d["sum:hours"]])).toEqual([["2026-10", 1], ["2026-11", 5.5]]);
    expect(r.totals["sum:hours"]).toBe(6.5);
  });
  it("splits into series and sorts by value", () => {
    const r = compute(rows, { ...base, groupBy: { field: "who" }, breakdown: "kind", sort: "value_desc" }, cols);
    expect(r.series.map((s) => s.label)).toEqual(["run", "setup"]);
    expect(r.data[0]).toMatchObject({ label: "Ana", "s:run": 3, "s:setup": 1 });
  });
  it("filters by text, number and date, and counts rows", () => {
    const r = compute(rows, { ...base, values: [{ field: "*", agg: "count" }], filters: [{ field: "who", op: "is", value: "ben" }, { field: "day", op: "after", value: "2026-11-20" }] }, cols);
    expect(r.rowCount).toBe(1);
    expect(compute(rows, { ...base, filters: [{ field: "hours", op: "gt", value: "1" }] }, cols).totals["sum:hours"]).toBe(5);
  });
  it("ignores a filter until a value is typed", () => {
    expect(compute(rows, { ...base, filters: [{ field: "who", op: "is", value: "" }] }, cols).rowCount).toBe(4);
  });
  it("limits to the first N", () => {
    const r = compute(rows, { ...base, groupBy: { field: "day" }, sort: "value_desc", limit: 2 }, cols);
    expect(r.data.map((d) => d.label)).toEqual(["2026-11-02", "2026-11-19"]);
  });
});
