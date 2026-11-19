/**
 * Reports: saved reports and starters, and the report builder (pick a dataset, then chart or
 * tabulate it in one or more views; save, pin to the dashboard, export CSV).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, ChevronDown, Copy, Download, Filter, LayoutDashboard, Pin, Plus, Star, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api.ts";
import { Badge, Button, cx, ErrorNote, Input, Loading, Modal, PageHeader, Select, Table, TabPanel, Td } from "../components/ui.tsx";
import { money, num } from "../format.ts";
import { AGG_LABEL, applyFilters, compute, PALETTE, toCsv, valueKey, valueLabel, type Agg, type Chart, type Column, type Result, type Row, type View } from "@ironline/shared";

type Dataset = { key: string; label: string; description: string; columns: Column[] };
type DataRows = { columns: Column[]; rows: Row[]; truncated: boolean };
type Saved = { id: string; name: string; dataset: string; starred: boolean; pinned: boolean; updatedAt: string; updatedBy?: string | null; config: { views: View[] } };

const blankView = (name = "View 1"): View => ({ name, chart: "bar", values: [{ field: "*", agg: "count" }], groupBy: null, breakdown: null, filters: [], hidden: [], sort: "label", limit: null, stacked: false });
const v = (p: Partial<View> & { name: string }): View => ({ ...blankView(p.name), ...p });

/** Our own starter reports. */
const STARTERS: { name: string; dataset: string; blurb: string; views: View[] }[] = [
  {
    name: "Monthly sales",
    dataset: "sales_lines",
    blurb: "Ordered value each month, and who your biggest customers are.",
    views: [
      v({ name: "By month", chart: "bar", values: [{ field: "line_total", agg: "sum" }], groupBy: { field: "order_date", bucket: "month" } }),
      v({ name: "Top customers", chart: "bar", values: [{ field: "line_total", agg: "sum" }], groupBy: { field: "customer" }, sort: "value_desc", limit: 10 }),
    ],
  },
  {
    name: "Job cost: estimate vs actual",
    dataset: "jobs",
    blurb: "Where jobs cost more than quoted, and the margin left.",
    views: [
      v({ name: "Per job", chart: "bar", values: [{ field: "estimated_cost", agg: "sum" }, { field: "actual_cost", agg: "sum" }], groupBy: { field: "job_number" } }),
      v({ name: "Totals", chart: "kpi", values: [{ field: "revenue", agg: "sum" }, { field: "actual_cost", agg: "sum" }, { field: "margin", agg: "sum" }] }),
    ],
  },
  {
    name: "Labor hours by work center",
    dataset: "labor",
    blurb: "Setup, hands-on and machine hours at each work center.",
    views: [v({ name: "Hours", chart: "bar", values: [{ field: "hours", agg: "sum" }], groupBy: { field: "work_center" }, breakdown: "kind", stacked: true })],
  },
  {
    name: "Quote pipeline",
    dataset: "quotes",
    blurb: "Quotes by status, and quoted value per customer.",
    views: [
      v({ name: "By status", chart: "pie", values: [{ field: "*", agg: "count" }], groupBy: { field: "status" } }),
      v({ name: "Value by customer", chart: "bar", values: [{ field: "total_price", agg: "sum" }], groupBy: { field: "customer" }, sort: "value_desc" }),
    ],
  },
  {
    name: "Spend by vendor",
    dataset: "purchases",
    blurb: "What you buy from whom.",
    views: [v({ name: "By vendor", chart: "pie", values: [{ field: "line_total", agg: "sum" }], groupBy: { field: "vendor" } })],
  },
  {
    name: "Inspection results",
    dataset: "inspection",
    blurb: "Readings per job, split into pass and fail.",
    views: [v({ name: "Per job", chart: "bar", values: [{ field: "*", agg: "count" }], groupBy: { field: "job_number" }, breakdown: "result", stacked: true })],
  },
];

const useDatasets = () => useQuery({ queryKey: ["report-datasets"], queryFn: () => api<Dataset[]>("/reports/datasets"), staleTime: Infinity });
const useRows = (key: string | undefined) => useQuery({ queryKey: ["report-rows", key], queryFn: () => api<DataRows>(`/reports/datasets/${key}`), enabled: !!key, staleTime: 30_000 });

// ── List ────────────────────────────────────────────────────────────────────

export function ReportsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const list = useQuery({ queryKey: ["reports"], queryFn: () => api<Saved[]>("/reports") });
  const ds = useDatasets();
  const [newOpen, setNewOpen] = useState(false);
  const create = useMutation({
    mutationFn: (b: { name: string; dataset: string; views: View[] }) => api<Saved>("/reports", "POST", { name: b.name, dataset: b.dataset, config: { views: b.views } }),
    onSuccess: (r) => (qc.invalidateQueries({ queryKey: ["reports"] }), nav(`/reports/${r.id}`)),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...flags }: { id: string; starred?: boolean; pinned?: boolean }) => api(`/reports/${id}`, "PATCH", flags),
    onSuccess: (_d, v) => (qc.invalidateQueries({ queryKey: ["reports"] }), qc.invalidateQueries({ queryKey: ["report", v.id] }), qc.invalidateQueries({ queryKey: ["pinned-reports"] })),
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/reports/${id}`, "DELETE"), onSuccess: () => qc.invalidateQueries({ queryKey: ["reports"] }) });
  const [confirmDel, setConfirmDel] = useState<Saved | null>(null);
  const toggle = (r: Saved, k: "starred" | "pinned") => patch.mutate({ id: r.id, [k]: !r[k] });
  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        sub="Chart and total anything the shop records. Save a report to come back to it, or pin it to the dashboard."
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus className="h-4 w-4" /> New report
          </Button>
        }
      />
      <section>
        <h2 className="mb-2 text-sm font-medium text-muted">Start from a ready-made report</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STARTERS.map((s) => (
            <button
              key={s.name}
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate(s)}
              className="flex items-start gap-3 rounded-xl bg-panel p-4 text-left shadow-panel ring-1 ring-line/70 transition hover:ring-2 hover:ring-accent"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <BarChart3 className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{s.name}</span>
                <span className="block text-sm text-muted">{s.blurb}</span>
                <span className="mt-1 block text-xs text-muted">{ds.data?.find((d) => d.key === s.dataset)?.label}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
      <TabPanel title="Saved reports">
        <Table head={["", "Report", "Data", "Last changed", ""]} empty="No saved reports yet. Start from one above or make a new one.">
          {(list.data ?? []).map((r) => (
            <tr key={r.id} className="hover:bg-panel-2/60">
              <Td className="w-10">
                <button type="button" onClick={() => toggle(r, "starred")} aria-label={r.starred ? "Unstar" : "Star"}>
                  <Star className={cx("h-4 w-4", r.starred ? "fill-warn text-warn" : "text-muted")} />
                </button>
              </Td>
              <Td>
                <Link to={`/reports/${r.id}`} className="font-medium text-accent hover:underline">
                  {r.name}
                </Link>
                {r.pinned && (
                  <Badge tone="accent">
                    <Pin className="h-3 w-3" /> On dashboard
                  </Badge>
                )}
              </Td>
              <Td className="text-muted">{ds.data?.find((d) => d.key === r.dataset)?.label ?? r.dataset}</Td>
              <Td className="text-muted">
                {new Date(r.updatedAt).toLocaleString()}
                {r.updatedBy ? ` · ${r.updatedBy}` : ""}
              </Td>
              <Td right>
                <span className="flex justify-end gap-3">
                  <button type="button" onClick={() => toggle(r, "pinned")} className="text-sm text-accent hover:underline">
                    {r.pinned ? "Unpin" : "Pin to dashboard"}
                  </button>
                  <button type="button" onClick={() => setConfirmDel(r)} className="text-muted hover:text-bad" aria-label="Delete report">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </TabPanel>
      {newOpen && <NewReport datasets={ds.data ?? []} busy={create.isPending} onClose={() => setNewOpen(false)} onCreate={(name, dataset) => create.mutate({ name, dataset, views: [blankView()] })} />}
      <Modal open={!!confirmDel} onClose={() => setConfirmDel(null)} title="Delete report?">
        <p className="text-sm">"{confirmDel?.name}" will be removed for everyone in the shop. The data behind it is not touched.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>
            Keep it
          </Button>
          <Button variant="danger" onClick={() => confirmDel && del.mutate(confirmDel.id, { onSuccess: () => setConfirmDel(null) })}>
            Delete report
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function NewReport({ datasets, busy, onClose, onCreate }: { datasets: Dataset[]; busy: boolean; onClose: () => void; onCreate: (name: string, dataset: string) => void }) {
  const [name, setName] = useState("");
  const [pick, setPick] = useState("");
  return (
    <Modal open onClose={onClose} title="New report" wide>
      <label className="block text-sm">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Scrap by work center" className="mt-1" />
      </label>
      <p className="mb-2 mt-4 text-sm text-muted">What should it report on?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {datasets.map((d) => (
          <button key={d.key} type="button" onClick={() => setPick(d.key)} className={cx("rounded-xl p-3 text-left ring-1 transition", pick === d.key ? "bg-accent-soft ring-2 ring-accent" : "ring-line hover:ring-accent/60")}>
            <div className="font-semibold">{d.label}</div>
            <div className="text-sm text-muted">{d.description}</div>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!pick || busy} onClick={() => onCreate(name.trim() || (datasets.find((d) => d.key === pick)?.label ?? "Report"), pick)}>
          Create report
        </Button>
      </div>
    </Modal>
  );
}

// ── Chart ───────────────────────────────────────────────────────────────────

function fmt(cols: Column[], field: string, n: number) {
  const t = cols.find((c) => c.key === field)?.type;
  if (t === "money") return money(n, Math.abs(n) >= 1000 ? 0 : 2);
  return num(n, Number.isInteger(n) ? 0 : 2);
}

export function ReportChart({ view, result, cols, height = 360 }: { view: View; result: Result; cols: Column[]; height?: number }) {
  const first = result.series[0]?.value ?? { field: "*", agg: "count" as Agg };
  const f = (n: unknown) => fmt(cols, first.agg === "count" ? "*" : first.field, Number(n));
  if (view.chart === "kpi") {
    const vals = view.values.length ? view.values : [{ field: "*", agg: "count" as Agg }];
    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {vals.map((x, i) => (
          <div key={valueKey(x)} className="rounded-xl bg-panel-2 px-5 py-4" style={{ borderLeft: `4px solid ${PALETTE[i % PALETTE.length]}` }}>
            <div className="text-sm text-muted">{valueLabel(x, cols)}</div>
            <div className="num mt-1 text-3xl font-semibold">{fmt(cols, x.agg === "count" ? "*" : x.field, result.totals[valueKey(x)] ?? 0)}</div>
          </div>
        ))}
        <p className="text-xs text-muted sm:col-span-full">{result.rowCount} rows after filters.</p>
      </div>
    );
  }
  if (!result.data.length) return <div className="flex items-center justify-center text-sm text-muted" style={{ height }}>No rows match. Loosen the filters or pick other data.</div>;
  if (view.chart === "table") {
    return (
      <div className="overflow-auto" style={{ maxHeight: height + 120 }}>
        <Table head={[view.groupBy ? (cols.find((c) => c.key === view.groupBy!.field)?.label ?? "Group") : "", ...result.series.map((s) => ({ label: s.label, right: true }))]}>
          {result.data.map((d) => (
            <tr key={String(d.label)}>
              <Td className="font-medium">{String(d.display)}</Td>
              {result.series.map((s) => (
                <Td key={s.key} right>
                  {f(d[s.key])}
                </Td>
              ))}
            </tr>
          ))}
          <tr className="border-t-2 border-line font-semibold">
            <Td>Total</Td>
            {result.series.map((s) => (
              <Td key={s.key} right>
                {view.breakdown ? "" : fmt(cols, s.value.agg === "count" ? "*" : s.value.field, result.totals[s.key] ?? 0)}
              </Td>
            ))}
          </tr>
        </Table>
      </div>
    );
  }
  const axis = { tick: { fontSize: 11, fill: "var(--color-muted, #6b7280)" }, stroke: "var(--color-line, #d6dbe1)" };
  const common = { data: result.data, margin: { top: 8, right: 16, bottom: 8, left: 8 } };
  const tip = <Tooltip formatter={(n) => f(n)} labelFormatter={(l) => String(result.data.find((d) => d.label === l)?.display ?? l)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />;
  const many = result.data.length > 12;
  const x = <XAxis dataKey="label" tickFormatter={(l) => String(result.data.find((d) => d.label === l)?.display ?? l)} {...axis} angle={many ? -35 : 0} textAnchor={many ? "end" : "middle"} height={many ? 70 : 30} interval={result.data.length > 40 ? "preserveStartEnd" : 0} />;
  const y = <YAxis tickFormatter={f} {...axis} width={72} />;
  const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line, #e5e7eb)" />;
  const legend = result.series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {view.chart === "pie" ? (
          <PieChart>
            <Pie data={result.data} dataKey={result.series[0]!.key} nameKey="display" innerRadius="45%" outerRadius="80%" paddingAngle={1} label={(e: { percent?: number }) => `${Math.round((e.percent ?? 0) * 100)}%`}>
              {result.data.map((_, i) => (
                <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(n) => f(n)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        ) : view.chart === "line" ? (
          <LineChart {...common}>
            {grid}
            {x}
            {y}
            {tip}
            {legend}
            {result.series.map((s, i) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2.5} dot={result.data.length < 40} />
            ))}
          </LineChart>
        ) : view.chart === "area" ? (
          <AreaChart {...common}>
            {grid}
            {x}
            {y}
            {tip}
            {legend}
            {result.series.map((s, i) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId={view.stacked ? "a" : undefined} stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.25} strokeWidth={2} />
            ))}
          </AreaChart>
        ) : view.chart === "scatter" ? (
          <ScatterChart margin={common.margin}>
            {grid}
            <XAxis dataKey={result.series[0]!.key} name={result.series[0]!.label} type="number" tickFormatter={f} {...axis} />
            <YAxis dataKey={result.series[1]?.key ?? result.series[0]!.key} name={result.series[1]?.label ?? result.series[0]!.label} type="number" tickFormatter={f} {...axis} width={72} />
            <Tooltip formatter={(n) => f(n)} contentStyle={{ borderRadius: 10, fontSize: 12 }} />
            <Scatter data={result.data} fill={PALETTE[0]} />
          </ScatterChart>
        ) : (
          <BarChart {...common}>
            {grid}
            {x}
            {y}
            {tip}
            {legend}
            {result.series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.label} stackId={view.stacked ? "a" : undefined} fill={PALETTE[i % PALETTE.length]} radius={view.stacked ? 0 : [4, 4, 0, 0]} maxBarSize={56} />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

// ── Builder ─────────────────────────────────────────────────────────────────

const CHARTS: { key: Chart; label: string }[] = [
  { key: "bar", label: "Bar" },
  { key: "line", label: "Line" },
  { key: "area", label: "Area" },
  { key: "pie", label: "Pie" },
  { key: "kpi", label: "Big numbers" },
  { key: "table", label: "Table" },
  { key: "scatter", label: "Scatter (value vs value)" },
];
const OPS: { key: View["filters"][number]["op"]; label: string; types: string[] }[] = [
  { key: "is", label: "is", types: ["text", "number", "money", "date"] },
  { key: "is_not", label: "is not", types: ["text", "number", "money", "date"] },
  { key: "contains", label: "contains", types: ["text"] },
  { key: "gt", label: "more than", types: ["number", "money"] },
  { key: "lt", label: "less than", types: ["number", "money"] },
  { key: "after", label: "on or after", types: ["date"] },
  { key: "before", label: "on or before", types: ["date"] },
];

export function ReportEditorPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const rep = useQuery({ queryKey: ["report", id], queryFn: () => api<Saved>(`/reports/${id}`) });
  const [draft, setDraft] = useState<Saved | null>(null);
  const [vi, setVi] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [showRows, setShowRows] = useState(false);
  useEffect(() => {
    if (rep.data && !dirty) setDraft(rep.data);
  }, [rep.data, dirty]);
  const data = useRows(draft?.dataset);
  const ds = useDatasets();
  const save = useMutation({
    mutationFn: (r: Saved) => api<Saved>(`/reports/${r.id}`, "PUT", { name: r.name, dataset: r.dataset, config: r.config, starred: r.starred, pinned: r.pinned }),
    onSuccess: (r) => (qc.setQueryData(["report", id], r), qc.invalidateQueries({ queryKey: ["reports"] }), qc.invalidateQueries({ queryKey: ["pinned-reports"] }), setDirty(false)),
  });
  const cols = data.data?.columns ?? [];
  const view = draft?.config.views[Math.min(vi, (draft?.config.views.length ?? 1) - 1)];
  const result = useMemo(() => (view && data.data ? compute(data.data.rows, view, cols) : null), [view, data.data, cols]);
  if (!draft || !view) return rep.error ? <ErrorNote error={rep.error} /> : <Loading />;

  const change = (next: Saved) => (setDraft(next), setDirty(true));
  const setView = (p: Partial<View>) => change({ ...draft, config: { views: draft.config.views.map((x, i) => (i === vi ? { ...x, ...p } : x)) } });
  const numeric = cols.filter((c) => c.type === "number" || c.type === "money");
  const exportCsv = () => {
    if (!result || !data.data) return;
    const grouped = !!view.groupBy;
    const csv = grouped
      ? toCsv([cols.find((c) => c.key === view.groupBy!.field)?.label ?? "Group", ...result.series.map((s) => s.label)], result.data.map((d) => [String(d.display), ...result.series.map((s) => d[s.key] as number)]))
      : toCsv(cols.filter((c) => !view.hidden.includes(c.key)).map((c) => c.label), data.data.rows.map((r) => cols.filter((c) => !view.hidden.includes(c.key)).map((c) => r[c.key] as string)));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${draft.name} - ${view.name}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const dsLabel = ds.data?.find((d) => d.key === draft.dataset)?.label ?? draft.dataset;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link to="/reports" className="text-sm text-accent hover:underline">
            Reports
          </Link>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => change({ ...draft, starred: !draft.starred })} aria-label={draft.starred ? "Unstar" : "Star"}>
              <Star className={cx("h-5 w-5", draft.starred ? "fill-warn text-warn" : "text-muted")} />
            </button>
            <input value={draft.name} onChange={(e) => change({ ...draft, name: e.target.value })} aria-label="Report name" className="min-w-0 flex-1 bg-transparent text-2xl font-semibold outline-none focus:underline" />
            <span className={cx("text-sm", dirty ? "text-warn" : "text-muted")}>{dirty ? "Unsaved changes" : "Saved"}</span>
          </div>
          <div className="text-sm text-muted">
            {dsLabel} · {data.data ? `${data.data.rows.length} rows${data.data.truncated ? " (first 20,000)" : ""}` : "loading…"}
          </div>
        </div>
        <Button onClick={() => change({ ...draft, pinned: !draft.pinned })}>
          <LayoutDashboard className="h-4 w-4" /> {draft.pinned ? "Pinned to dashboard" : "Pin to dashboard"}
        </Button>
        <Button onClick={exportCsv} disabled={!result}>
          <Download className="h-4 w-4" /> Export CSV
        </Button>
        <Button variant="primary" disabled={!dirty || save.isPending || !draft.name.trim()} onClick={() => save.mutate(draft)}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
      <ErrorNote error={save.error} />

      <div className="flex flex-wrap items-center gap-1 border-b border-line">
        {draft.config.views.map((x, i) => (
          <button key={i} type="button" onClick={() => setVi(i)} className={cx("-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm", i === vi ? "border-accent font-medium text-accent" : "border-transparent text-muted hover:text-ink")}>
            {x.name}
          </button>
        ))}
        <button type="button" title="Add a view" onClick={() => (change({ ...draft, config: { views: [...draft.config.views, blankView(`View ${draft.config.views.length + 1}`)] } }), setVi(draft.config.views.length))} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Add a view">
          <Plus className="h-4 w-4" />
        </button>
        <span className="ml-auto flex items-center gap-1">
          <button type="button" title="Copy this view" onClick={() => (change({ ...draft, config: { views: [...draft.config.views, { ...view, name: `${view.name} copy` }] } }), setVi(draft.config.views.length))} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Copy view">
            <Copy className="h-4 w-4" />
          </button>
          {draft.config.views.length > 1 && (
            <button type="button" title="Remove this view" onClick={() => (change({ ...draft, config: { views: draft.config.views.filter((_, i) => i !== vi) } }), setVi(0))} className="rounded-md p-1.5 text-muted hover:bg-panel-2 hover:text-bad" aria-label="Remove view">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
          {data.isLoading || !result ? <Loading /> : <ReportChart view={view} result={result} cols={cols} />}
          {view.filters.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {view.filters.map((fl, i) => (
                <Badge key={i} tone="accent">
                  <Filter className="h-3 w-3" /> {cols.find((c) => c.key === fl.field)?.label} {OPS.find((o) => o.key === fl.op)?.label} {fl.value || "blank"}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-4 border-t border-line pt-3">
            <button type="button" onClick={() => setShowRows(!showRows)} className="flex items-center gap-1.5 text-sm font-medium" aria-expanded={showRows}>
              <ChevronDown className={cx("h-4 w-4 transition-transform", !showRows && "-rotate-90")} /> Underlying data ({result?.rowCount ?? 0} rows)
            </button>
            {showRows && data.data && <Underlying rows={data.data.rows} cols={cols} view={view} />}
          </div>
        </section>

        <aside className="space-y-4 rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
          <label className="block text-sm">
            <span className="text-xs text-muted">View name</span>
            <Input value={view.name} onChange={(e) => setView({ name: e.target.value })} />
          </label>
          <label className="block text-sm">
            <span className="text-xs text-muted">Show as</span>
            <Select value={view.chart} onChange={(e) => setView({ chart: e.target.value as Chart })}>
              {CHARTS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </label>

          <PanelBlock title="Values" onAdd={() => setView({ values: [...view.values, { field: numeric[0]?.key ?? "*", agg: numeric[0] ? "sum" : "count" }] })}>
            {view.values.map((x, i) => (
              <div key={i} className="flex gap-1.5">
                <Select value={x.field} onChange={(e) => setView({ values: view.values.map((y, j) => (j === i ? { field: e.target.value, agg: e.target.value === "*" ? "count" : y.agg === "count" ? "sum" : y.agg } : y)) })} className="min-w-0 flex-1">
                  <option value="*">Rows</option>
                  {cols.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <Select value={x.agg} onChange={(e) => setView({ values: view.values.map((y, j) => (j === i ? { ...y, agg: e.target.value as Agg } : y)) })} className="w-28!">
                  {(Object.keys(AGG_LABEL) as Agg[])
                    .filter((a) => x.field === "*" ? a === "count" : numeric.some((c) => c.key === x.field) || a === "count")
                    .map((a) => (
                      <option key={a} value={a}>
                        {AGG_LABEL[a]}
                      </option>
                    ))}
                </Select>
                <IconX onClick={() => setView({ values: view.values.filter((_, j) => j !== i) })} />
              </div>
            ))}
          </PanelBlock>

          {view.chart !== "kpi" && (
            <PanelBlock title={view.chart === "pie" ? "Slices by" : view.chart === "table" ? "Rows by" : "Across the bottom (group by)"}>
              <div className="flex gap-1.5">
                <Select value={view.groupBy?.field ?? ""} onChange={(e) => setView({ groupBy: e.target.value ? { field: e.target.value, bucket: cols.find((c) => c.key === e.target.value)?.type === "date" ? "month" : null } : null })} className="min-w-0 flex-1">
                  <option value="">Nothing (one total)</option>
                  {cols.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                {view.groupBy && cols.find((c) => c.key === view.groupBy!.field)?.type === "date" && (
                  <Select value={view.groupBy.bucket ?? "month"} onChange={(e) => setView({ groupBy: { ...view.groupBy!, bucket: e.target.value as "month" } })} className="w-28!">
                    {["day", "week", "month", "quarter", "year"].map((b) => (
                      <option key={b} value={b}>
                        By {b}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </PanelBlock>
          )}

          {["bar", "line", "area", "table"].includes(view.chart) && (
            <PanelBlock title="Split into series by">
              <Select value={view.breakdown ?? ""} onChange={(e) => setView({ breakdown: e.target.value || null })}>
                <option value="">No split</option>
                {cols
                  .filter((c) => c.type === "text")
                  .map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
              </Select>
              {view.breakdown && view.values.length > 1 && <p className="text-xs text-muted">With a split, only the first value is drawn.</p>}
              {(view.chart === "bar" || view.chart === "area") && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={view.stacked} onChange={(e) => setView({ stacked: e.target.checked })} /> Stack the series
                </label>
              )}
            </PanelBlock>
          )}

          <PanelBlock title="Filters" onAdd={() => setView({ filters: [...view.filters, { field: view.groupBy?.field ?? cols.find((c) => c.type === "text")?.key ?? cols[0]?.key ?? "", op: "is", value: "" }] })}>
            {view.filters.map((fl, i) => {
              const t = cols.find((c) => c.key === fl.field)?.type ?? "text";
              const set = (p: Partial<typeof fl>) => setView({ filters: view.filters.map((y, j) => (j === i ? { ...y, ...p } : y)) });
              return (
                <div key={i} className="space-y-1 rounded-lg bg-panel-2 p-2">
                  <div className="flex gap-1.5">
                    <Select value={fl.field} onChange={(e) => set({ field: e.target.value, op: "is", value: "" })} className="min-w-0 flex-1">
                      {cols.map((c) => (
                        <option key={c.key} value={c.key}>
                          {c.label}
                        </option>
                      ))}
                    </Select>
                    <IconX onClick={() => setView({ filters: view.filters.filter((_, j) => j !== i) })} />
                  </div>
                  <div className="flex gap-1.5">
                    <Select value={fl.op} onChange={(e) => set({ op: e.target.value as typeof fl.op })} className="w-32!">
                      {OPS.filter((o) => o.types.includes(t)).map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <Input type={t === "date" ? "date" : t === "text" ? "text" : "number"} value={fl.value} onChange={(e) => set({ value: e.target.value })} className="min-w-0 flex-1" />
                  </div>
                </div>
              );
            })}
          </PanelBlock>

          {view.chart !== "kpi" && (
            <PanelBlock title="Order">
              <div className="flex gap-1.5">
                <Select value={view.sort} onChange={(e) => setView({ sort: e.target.value as View["sort"] })} className="min-w-0 flex-1">
                  <option value="label">By group name or date</option>
                  <option value="value_desc">Largest first</option>
                  <option value="value_asc">Smallest first</option>
                </Select>
                <Input type="number" min={1} placeholder="All" value={view.limit ?? ""} onChange={(e) => setView({ limit: e.target.value ? Math.max(1, Number(e.target.value)) : null })} className="w-20!" aria-label="Show only the first" />
              </div>
            </PanelBlock>
          )}

          <PanelBlock title="Columns in underlying data">
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {cols.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!view.hidden.includes(c.key)} onChange={(e) => setView({ hidden: e.target.checked ? view.hidden.filter((h) => h !== c.key) : [...view.hidden, c.key] })} />
                  {c.label}
                </label>
              ))}
            </div>
          </PanelBlock>
        </aside>
      </div>
    </div>
  );
}

function PanelBlock({ title, onAdd, children }: { title: string; onAdd?: () => void; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5 border-t border-line pt-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted">{title}</span>
        {onAdd && (
          <button type="button" onClick={onAdd} className="rounded p-0.5 text-accent hover:bg-accent-soft" aria-label={`Add to ${title}`}>
            <Plus className="h-4 w-4" />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

const IconX = ({ onClick }: { onClick: () => void }) => (
  <button type="button" onClick={onClick} className="shrink-0 rounded px-1 text-muted hover:text-bad" aria-label="Remove">
    <X className="h-4 w-4" />
  </button>
);

function Underlying({ rows, cols, view }: { rows: Row[]; cols: Column[]; view: View }) {
  const shown = cols.filter((c) => !view.hidden.includes(c.key));
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => applyFilters(rows, view.filters, cols), [rows, view.filters, cols]);
  const pageRows = filtered.slice(page * 100, page * 100 + 100);
  return (
    <div className="mt-2 overflow-x-auto">
      <Table head={shown.map((c) => ({ label: c.label, right: c.type === "number" || c.type === "money" }))}>
        {pageRows.map((r, i) => (
          <tr key={i}>
            {shown.map((c) => (
              <Td key={c.key} right={c.type === "number" || c.type === "money"}>
                {r[c.key] == null ? "—" : c.type === "money" ? money(Number(r[c.key])) : c.type === "number" ? num(Number(r[c.key]), 4) : String(r[c.key])}
              </Td>
            ))}
          </tr>
        ))}
      </Table>
      {filtered.length > 100 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-sm">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="num">
            {page * 100 + 1}–{Math.min(filtered.length, page * 100 + 100)} of {filtered.length}
          </span>
          <Button variant="ghost" disabled={(page + 1) * 100 >= filtered.length} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

/** Pinned reports for the home dashboard: each report's first view, live from today's data. */
export function PinnedReports() {
  const pinned = useQuery({ queryKey: ["pinned-reports"], queryFn: () => api<Saved[]>("/reports/pinned") });
  if (!pinned.data?.length) return null;
  return (
    <section className="grid gap-5 xl:grid-cols-2">
      {pinned.data.map((r) => (
        <PinnedCard key={r.id} r={r} />
      ))}
    </section>
  );
}

function PinnedCard({ r }: { r: Saved }) {
  const data = useRows(r.dataset);
  const view = r.config.views[0]!;
  const result = useMemo(() => (data.data ? compute(data.data.rows, view, data.data.columns) : null), [data.data, view]);
  return (
    <TabPanel
      title={
        <Link to={`/reports/${r.id}`} className="hover:text-accent">
          {r.name}
        </Link>
      }
      tabs={<span className="text-sm text-muted">{view.name}</span>}
    >
      {result && data.data ? <ReportChart view={view} result={result} cols={data.data.columns} height={240} /> : <Loading />}
    </TabPanel>
  );
}
