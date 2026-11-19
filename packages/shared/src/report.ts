/**
 * Turns dataset rows into what a report view shows: filter, group (dates by day/week/month/
 * quarter/year), break down into series, total (sum, average, count, min, max), sort and limit.
 */

export type ColType = "text" | "number" | "money" | "date";
export interface Column {
  key: string;
  label: string;
  type: ColType;
}
export type Agg = "sum" | "avg" | "count" | "min" | "max";
export type Chart = "table" | "bar" | "line" | "area" | "pie" | "kpi" | "scatter";
export interface View {
  name: string;
  chart: Chart;
  values: { field: string; agg: Agg }[];
  groupBy?: { field: string; bucket?: "day" | "week" | "month" | "quarter" | "year" | null } | null;
  breakdown?: string | null;
  filters: { field: string; op: "is" | "is_not" | "contains" | "gt" | "lt" | "after" | "before"; value: string }[];
  hidden: string[];
  sort: "label" | "value_desc" | "value_asc";
  limit?: number | null;
  stacked: boolean;
}
export type Row = Record<string, unknown>;

export const AGG_LABEL: Record<Agg, string> = { sum: "Sum", avg: "Average", count: "Count", min: "Lowest", max: "Highest" };
export const valueKey = (v: { field: string; agg: Agg }) => `${v.agg}:${v.field}`;
export const valueLabel = (v: { field: string; agg: Agg }, cols: Column[]) =>
  v.agg === "count" ? `Count of ${v.field === "*" ? "rows" : (cols.find((c) => c.key === v.field)?.label ?? v.field)}` : `${cols.find((c) => c.key === v.field)?.label ?? v.field} (${AGG_LABEL[v.agg].toLowerCase()})`;

export function applyFilters(rows: Row[], filters: View["filters"], cols: Column[]) {
  return rows.filter((r) =>
    filters.every((f) => {
      const raw = r[f.field];
      const col = cols.find((c) => c.key === f.field);
      // A filter with nothing typed in yet does not hide anything.
      if (!f.value) return true;
      const s = raw == null ? "" : String(raw);
      switch (f.op) {
        case "is":
          return s.toLowerCase() === f.value.toLowerCase();
        case "is_not":
          return s.toLowerCase() !== f.value.toLowerCase();
        case "contains":
          return s.toLowerCase().includes(f.value.toLowerCase());
        case "gt":
          return Number(raw) > Number(f.value);
        case "lt":
          return Number(raw) < Number(f.value);
        case "after":
          return col?.type === "date" ? s >= f.value : true;
        case "before":
          return col?.type === "date" ? !!s && s <= f.value : true;
      }
    }),
  );
}

/** Date bucket key that sorts in time order, e.g. "2026-11", "2026-Q4", "2026-W47". */
export function bucketOf(iso: string, bucket: NonNullable<NonNullable<View["groupBy"]>["bucket"]>) {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "No date";
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (bucket === "year") return String(y);
  if (bucket === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
  if (bucket === "month") return `${y}-${String(m).padStart(2, "0")}`;
  if (bucket === "week") {
    // ISO week number.
    const t = new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const wk = Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
  }
  return iso.slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Human label for a bucket key: "Nov 2026", "Q4 2026", "Week 47, 2026". */
export function bucketLabel(key: string) {
  let m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = /^(\d{4})-Q(\d)$/.exec(key);
  if (m) return `Q${m[2]} ${m[1]}`;
  m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (m) return `Week ${Number(m[2])}, ${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  return key;
}

function aggregate(nums: number[], agg: Agg, count: number) {
  if (agg === "count") return count;
  if (!nums.length) return 0;
  if (agg === "sum") return nums.reduce((a, b) => a + b, 0);
  if (agg === "avg") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agg === "min") return Math.min(...nums);
  return Math.max(...nums);
}

export interface Result {
  /** One entry per group (x-axis point or table row). */
  data: Record<string, string | number>[];
  /** Series drawn: key in data, label, and the value it came from. */
  series: { key: string; label: string; value: { field: string; agg: Agg } }[];
  totals: Record<string, number>;
  rowCount: number;
}

export function compute(rows: Row[], view: View, cols: Column[]): Result {
  const filtered = applyFilters(rows, view.filters, cols);
  const values = view.values.length ? view.values : [{ field: "*", agg: "count" as Agg }];
  const keyOf = (r: Row) => {
    if (!view.groupBy) return "All";
    const raw = r[view.groupBy.field];
    if (raw == null || raw === "") return "(blank)";
    const col = cols.find((c) => c.key === view.groupBy!.field);
    return col?.type === "date" && view.groupBy.bucket ? bucketOf(String(raw), view.groupBy.bucket) : String(raw);
  };
  const totals: Record<string, number> = {};
  for (const v of values) totals[valueKey(v)] = aggregate(filtered.map((r) => Number(r[v.field])).filter(Number.isFinite), v.agg, filtered.length);

  const groups = new Map<string, Row[]>();
  for (const r of filtered) {
    const k = keyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const breakdown = view.breakdown && view.chart !== "pie" && view.chart !== "kpi" ? view.breakdown : null;
  const seriesKeys = breakdown ? [...new Set(filtered.map((r) => String(r[breakdown] ?? "(blank)")))].sort() : [];
  const first = values[0]!;
  let data = [...groups.entries()].map(([label, rs]) => {
    const row: Record<string, string | number> = { label, display: bucketLabel(label) };
    if (breakdown) {
      for (const s of seriesKeys) {
        const sub = rs.filter((r) => String(r[breakdown] ?? "(blank)") === s);
        row[`s:${s}`] = aggregate(sub.map((r) => Number(r[first.field])).filter(Number.isFinite), first.agg, sub.length);
      }
      row[valueKey(first)] = aggregate(rs.map((r) => Number(r[first.field])).filter(Number.isFinite), first.agg, rs.length);
    } else {
      for (const v of values) row[valueKey(v)] = aggregate(rs.map((r) => Number(r[v.field])).filter(Number.isFinite), v.agg, rs.length);
    }
    return row;
  });
  const sortKey = valueKey(first);
  const groupCol = view.groupBy ? cols.find((c) => c.key === view.groupBy!.field) : undefined;
  data.sort((a, b) =>
    view.sort === "value_desc"
      ? Number(b[sortKey]) - Number(a[sortKey])
      : view.sort === "value_asc"
        ? Number(a[sortKey]) - Number(b[sortKey])
        : groupCol?.type === "number" || groupCol?.type === "money"
          ? Number(a.label) - Number(b.label)
          : String(a.label).localeCompare(String(b.label)),
  );
  if (view.limit) data = data.slice(0, view.limit);
  const series = breakdown
    ? seriesKeys.map((s) => ({ key: `s:${s}`, label: s, value: first }))
    : values.map((v) => ({ key: valueKey(v), label: valueLabel(v, cols), value: v }));
  return { data, series, totals, rowCount: filtered.length };
}

export function toCsv(head: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [head, ...rows].map((r) => r.map(esc).join(",")).join("\n");
}

export const PALETTE = ["#2340a8", "#e0a21b", "#2e9e6b", "#d64545", "#7b61c9", "#1f9fb5", "#a5682a", "#5c6b7a", "#c2459c", "#6b8e23"];
