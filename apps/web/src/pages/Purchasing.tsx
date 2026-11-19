/**
 * Purchasing: the buying plan (what to buy, from whom, by when), purchase orders with
 * receiving, and vendors.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCircle2, Plus, Printer, ShoppingCart, Star, Trash2, Truck, X, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { api, qs, type Item, type StockLocation } from "../api.ts";
import { Badge, Button, cx, DetailTitle, ErrorNote, Field, Input, ListBar, Loading, MetricCard, Modal, PageHeader, R, recordCard, SearchBox, Select, StageTimeline, Status, Table, TabPanel, Td, Textarea, ViewTabs } from "../components/ui.tsx";
import { date, money, num } from "../format.ts";

const q4 = (n: number) => num(n, Number.isInteger(n) ? 0 : 2);
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDays = (iso: string, d: number) => {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + d);
  return x.toISOString().slice(0, 10);
};

type Seller = { vendorId: string; name: string; isPrimary: boolean; leadDays: number; unitCost: number; minOrder: number | null };
type PlanRow = {
  id: string;
  partNumber: string;
  description: string;
  type: string;
  uom: string;
  reorderPoint: number | null;
  onHand: number;
  vendor: Seller | null;
  vendorCount: number;
  unitCost: number;
  demand: number;
  incoming: number;
  projected: number;
  toBuy: number;
  shortageDate: string | null;
  arrival: string | null;
  late: boolean;
  urgent: boolean;
  totalCost: number;
  jobs: number;
  drafts: { poId: string; poNumber: string }[];
  bucket: "buy" | "late" | "urgent" | "ok";
};
type Plan = { endDate: string; rows: PlanRow[]; summary: Record<"buy" | "late" | "urgent" | "ok", { count: number; value: number }> };
type Vendor = { id: string; name: string; email: string | null; phone: string | null; address: { city?: string | null }; paymentTermsDays: number; active: boolean; items: number; openOrders: number; openValue: number };
type PoSummary = { id: string; number: string; status: string; vendorId: string; vendorName: string; orderDate: string | null; total: number; lines: number; dueDate: string | null; receivedPct: number };
type PoDetail = {
  id: string;
  number: string;
  status: string;
  orderDate: string | null;
  notes: string | null;
  total: number;
  createdAt: string;
  createdByName: string | null;
  vendor: { id: string; name: string; email: string | null; phone: string | null; address: Record<string, string | null>; paymentTermsDays: number };
  lines: { id: string; itemId: string | null; partNumber: string | null; uom: string | null; description: string; quantity: number; unitCost: number; dueDate: string | null; quantityReceived: number }[];
  receipts: { id: string; line_id: string; lot_number: string; quantity: number; location: string; created_at: string; user_name: string | null }[];
};
type Basket = Record<string, { vendor: Seller; lines: { row: PlanRow; quantity: number }[] }>;

// ── Page with three views ───────────────────────────────────────────────────

export function PurchasingPage() {
  const [sp, setSp] = useSearchParams();
  const view = sp.get("view") ?? "plan";
  const nav = useNavigate();
  return (
    <div className="space-y-5">
      <PageHeader
        title="Purchasing"
        sub="What to buy and when, purchase orders, receiving and vendors."
        actions={
          <>
            <ViewTabs
              views={[
                { key: "plan", label: "Buying plan" },
                { key: "orders", label: "Purchase orders" },
                { key: "vendors", label: "Vendors" },
              ]}
              value={view}
              onChange={(v) => setSp({ view: v })}
            />
            {view === "orders" && (
              <Button variant="primary" onClick={() => nav("/purchasing/orders/new")}>
                <Plus className="h-4 w-4" /> New order
              </Button>
            )}
          </>
        }
      />
      {view === "plan" && <PlanView />}
      {view === "orders" && <OrdersView />}
      {view === "vendors" && <VendorsView />}
    </div>
  );
}

// ── Buying plan ─────────────────────────────────────────────────────────────

function PlanView() {
  const [endDate, setEndDate] = useState(addDays(todayIso(), 90));
  const [filter, setFilter] = useState<"buy" | "late" | "urgent" | "ok" | "all">("buy");
  const [q, setQ] = useState("");
  const [basket, setBasket] = useState<Basket>({});
  const [qty, setQty] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<PlanRow | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const p = useQuery({ queryKey: ["purchase-plan", endDate], queryFn: () => api<Plan>(`/purchasing/plan${qs({ endDate })}`) });
  const rows = (p.data?.rows ?? []).filter(
    (r) =>
      (filter === "all" || (filter === "buy" ? r.toBuy > 0 : filter === "ok" ? r.toBuy === 0 : r.toBuy > 0 && r[filter])) &&
      (!q || [r.partNumber, r.description, r.vendor?.name].some((v) => v?.toLowerCase().includes(q.toLowerCase()))),
  );
  const inBasket = (r: PlanRow) => !!r.vendor && !!basket[r.vendor.vendorId]?.lines.some((l) => l.row.id === r.id);
  const add = (r: PlanRow) => {
    if (!r.vendor) return;
    const quantity = Number(qty[r.id] ?? r.toBuy);
    if (!(quantity > 0)) return;
    const b = basket[r.vendor.vendorId] ?? { vendor: r.vendor, lines: [] };
    setBasket({ ...basket, [r.vendor.vendorId]: { ...b, lines: [...b.lines.filter((l) => l.row.id !== r.id), { row: r, quantity }] } });
  };
  const remove = (r: PlanRow) => {
    if (!r.vendor) return;
    const b = basket[r.vendor.vendorId];
    if (!b) return;
    const lines = b.lines.filter((l) => l.row.id !== r.id);
    const next = { ...basket };
    if (lines.length) next[r.vendor.vendorId] = { ...b, lines };
    else delete next[r.vendor.vendorId];
    setBasket(next);
  };
  const s = p.data?.summary;
  const card = (key: typeof filter, label: string, icon: typeof ShoppingCart, tone: "accent" | "bad" | "warn" | "ok", note: string, value: number) => {
    const Icon = icon;
    return (
      <button type="button" onClick={() => setFilter(filter === key ? "all" : key)} className={cx("rounded-xl text-left transition", filter === key && "ring-2 ring-accent ring-offset-2 ring-offset-bg")}>
        <MetricCard label={label} value={value} note={note} tone={tone} badge={<Icon className="h-4 w-4 text-muted" />} />
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {s && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {card("buy", "To buy", ShoppingCart, "accent", `${money(s.buy.value, 0)} at primary vendor prices`, s.buy.count)}
          {card("late", "Can't arrive in time", CalendarClock, "bad", "Runs out before an order placed today lands", s.late.count)}
          {card("urgent", "Urgent", Zap, "warn", "Runs out within a week, or an urgent job is short", s.urgent.count)}
          {card("ok", "Covered", CheckCircle2, "ok", `Stock and orders cover jobs to ${date(p.data!.endDate)}`, s.ok.count)}
        </div>
      )}

      {Object.values(basket).map((b) => (
        <div key={b.vendor.vendorId} className="flex flex-wrap items-center gap-3 rounded-xl bg-accent-soft px-4 py-3 ring-1 ring-accent/30">
          <Truck className="h-5 w-5 text-accent" />
          <span className="font-semibold">{b.vendor.name}</span>
          <span className="text-sm text-muted">
            {b.lines.length} item{b.lines.length === 1 ? "" : "s"} · {money(b.lines.reduce((a, l) => a + l.quantity * l.row.unitCost, 0))}
          </span>
          <Button className="ml-auto" variant="ghost" onClick={() => setBasket(Object.fromEntries(Object.entries(basket).filter(([k]) => k !== b.vendor.vendorId)))}>
            Clear
          </Button>
          <Button variant="primary" onClick={() => setConfirm(b.vendor.vendorId)}>
            <ShoppingCart className="h-4 w-4" /> Create order
          </Button>
        </div>
      ))}

      <section className="rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
        <ListBar>
          <div className="w-full sm:w-80">
            <SearchBox value={q} onChange={setQ} placeholder="Search part, description or vendor" />
          </div>
          <label className="ml-auto flex items-center gap-2 text-sm text-muted">
            Jobs due up to
            <Input type="date" value={endDate} onChange={(e) => e.target.value && setEndDate(e.target.value)} className="w-40!" />
          </label>
        </ListBar>
        {p.error && <ErrorNote error={p.error} />}
        {p.isLoading ? (
          <Loading />
        ) : (
          <Table head={["Item", "Vendor & lead time", R("On hand"), R("Demand"), R("To buy"), R("Unit cost"), R("Total"), ""]} empty={filter === "buy" ? "Nothing to buy. Stock and open orders cover every job in this window." : "No items here."}>
            {rows.map((r) => {
              const shortNow = r.onHand < r.demand;
              return (
                <tr key={r.id} className={cx(inBasket(r) && "bg-accent-soft/40")}>
                  <Td>
                    <button type="button" onClick={() => setDetail(r)} className="text-left">
                      <div className="font-medium text-accent hover:underline">{r.partNumber}</div>
                      <div className="max-w-72 truncate text-xs text-muted">{r.description}</div>
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.late && (
                        <Badge tone="bad">
                          <AlertTriangle className="h-3 w-3" /> Short {date(r.shortageDate)}
                        </Badge>
                      )}
                      {!r.late && r.urgent && <Badge tone="warn">Short {date(r.shortageDate)}</Badge>}
                      {r.drafts.map((d) => (
                        <Link key={d.poId} to={`/purchasing/orders/${d.poId}`}>
                          <Badge tone="accent">Draft {d.poNumber}</Badge>
                        </Link>
                      ))}
                    </div>
                  </Td>
                  <Td>
                    {r.vendor ? (
                      <>
                        <div>{r.vendor.name}</div>
                        <div className={cx("text-xs", r.late ? "font-medium text-bad" : "text-muted")}>
                          {r.vendor.leadDays} days{r.vendorCount > 1 ? ` · ${r.vendorCount} vendors` : ""}
                        </div>
                      </>
                    ) : (
                      <button type="button" onClick={() => setDetail(r)} className="text-sm text-warn hover:underline">
                        Add a vendor
                      </button>
                    )}
                  </Td>
                  <Td right>
                    <div className={cx("font-medium", shortNow && "text-bad")}>{q4(r.onHand)}</div>
                    <div className="text-xs text-muted">{r.reorderPoint != null ? `min ${q4(r.reorderPoint)}` : "no min"}</div>
                  </Td>
                  <Td right>
                    <div className="font-medium">{q4(r.demand)}</div>
                    <div className="text-xs text-muted">{r.incoming ? `${q4(r.incoming)} on order` : `${r.jobs} job${r.jobs === 1 ? "" : "s"}`}</div>
                  </Td>
                  <Td right>
                    <span className="inline-flex items-center gap-1">
                      <input
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`Quantity to buy of ${r.partNumber}`}
                        value={qty[r.id] ?? String(r.toBuy)}
                        onChange={(e) => setQty({ ...qty, [r.id]: e.target.value })}
                        className={cx("num h-9 w-24 rounded-md bg-panel-2 px-2 text-right font-medium outline-none ring-1 ring-line focus:ring-2 focus:ring-accent", r.toBuy > 0 && "ring-accent/60")}
                      />
                      <span className="w-8 text-left text-xs text-muted">{r.uom}</span>
                    </span>
                  </Td>
                  <Td right>{money(r.unitCost, r.unitCost < 1 ? 4 : 2)}</Td>
                  <Td right className="font-medium">{money(Number(qty[r.id] ?? r.toBuy) * r.unitCost)}</Td>
                  <Td right>
                    {inBasket(r) ? (
                      <Button variant="ghost" onClick={() => remove(r)} title="Take off the order">
                        <X className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button disabled={!r.vendor || !(Number(qty[r.id] ?? r.toBuy) > 0)} onClick={() => add(r)} title={r.vendor ? `Add to the ${r.vendor.name} order` : "Add a vendor first"}>
                        <Plus className="h-4 w-4" /> Add
                      </Button>
                    )}
                  </Td>
                </tr>
              );
            })}
          </Table>
        )}
      </section>
      {detail && <PlanDetail row={detail} endDate={endDate} onClose={() => setDetail(null)} />}
      {confirm && basket[confirm] && <ConfirmOrder basket={basket[confirm]!} onClose={() => setConfirm(null)} onDone={() => (setBasket(Object.fromEntries(Object.entries(basket).filter(([k]) => k !== confirm))), setConfirm(null))} />}
    </div>
  );
}

function ConfirmOrder({ basket, onClose, onDone }: { basket: Basket[string]; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const due = addDays(todayIso(), basket.vendor.leadDays);
  const create = useMutation({
    mutationFn: () =>
      api<PoDetail>("/purchase-orders", "POST", {
        vendorId: basket.vendor.vendorId,
        lines: basket.lines.map((l) => ({ itemId: l.row.id, quantity: l.quantity, unitCost: l.row.vendor?.vendorId === basket.vendor.vendorId ? l.row.unitCost : basket.vendor.unitCost, dueDate: due })),
      }),
    onSuccess: (po) => {
      qc.invalidateQueries({ queryKey: ["purchase-plan"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onDone();
      nav(`/purchasing/orders/${po.id}`);
    },
  });
  const total = basket.lines.reduce((a, l) => a + l.quantity * l.row.unitCost, 0);
  return (
    <Modal open onClose={onClose} title={`New order for ${basket.vendor.name}`} wide>
      <Table head={["Item", R("Quantity"), "Arrives by", R("Unit cost"), R("Total")]}>
        {basket.lines.map((l) => (
          <tr key={l.row.id}>
            <Td>
              <div className="font-medium">{l.row.partNumber}</div>
              <div className="text-xs text-muted">{l.row.description}</div>
            </Td>
            <Td right>
              {q4(l.quantity)} {l.row.uom}
            </Td>
            <Td className={cx(l.row.shortageDate && due > l.row.shortageDate && "text-bad")}>{date(due)}</Td>
            <Td right>{money(l.row.unitCost, 4)}</Td>
            <Td right>{money(l.quantity * l.row.unitCost)}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-sm text-muted">Saved as a draft. Check it, then mark it sent from the order page.</span>
        <span className="num text-lg font-semibold">{money(total)}</span>
      </div>
      <ErrorNote error={create.error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => create.mutate()} disabled={create.isPending}>
          Create draft order
        </Button>
      </div>
    </Modal>
  );
}

type Detail = {
  item: { id: string; partNumber: string; description: string; uom: string; reorderPoint: number | null };
  onHand: number;
  vendors: (Seller & { city: string | null; vendorPartNumber: string | null })[];
  demand: { jobId: string; jobNumber: string; dueDate: string | null; priority: number; status: string; remaining: number }[];
  incoming: { poId: string; poNumber: string; status: string; vendor: string; dueDate: string | null; remaining: number }[];
  timeline: { date: string; change: number; balance: number; kind: string; label?: string }[];
  toBuy: number;
  shortageDate: string | null;
  arrival: string | null;
};

function PlanDetail({ row, endDate, onClose }: { row: PlanRow; endDate: string; onClose: () => void }) {
  const [tab, setTab] = useState(row.vendor ? "supply" : "vendors");
  const d = useQuery({ queryKey: ["purchase-plan-item", row.id, endDate], queryFn: () => api<Detail>(`/purchasing/plan/${row.id}${qs({ endDate })}`) });
  return (
    <Modal open onClose={onClose} title={`${row.partNumber} — ${row.description}`} wide>
      <div className="mb-3">
        <ViewTabs
          views={[
            { key: "supply", label: "Expected supply" },
            { key: "vendors", label: "Vendors" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {!d.data ? <Loading /> : tab === "supply" ? <Supply d={d.data} /> : <VendorEditor itemId={row.id} current={d.data.vendors} />}
    </Modal>
  );
}

/** Step chart of projected stock: today's stock, minus job demand, plus incoming orders. */
function SupplyChart({ d }: { d: Detail }) {
  const pts = d.timeline;
  const W = 760;
  const H = 180;
  const pad = { l: 44, r: 12, t: 12, b: 26 };
  const t0 = new Date(pts[0]!.date).getTime();
  const t1 = Math.max(new Date(pts.at(-1)!.date).getTime(), t0 + 14 * 864e5, d.arrival ? new Date(d.arrival).getTime() : 0) + 3 * 864e5;
  const vals = [...pts.map((p) => p.balance), 0, d.item.reorderPoint ?? 0];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals) || 1;
  const x = (iso: string) => pad.l + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo || 1)) * (H - pad.t - pad.b);
  let path = `M ${x(pts[0]!.date)} ${y(pts[0]!.balance)}`;
  for (let i = 1; i < pts.length; i++) path += ` H ${x(pts[i]!.date)} V ${y(pts[i]!.balance)}`;
  path += ` H ${W - pad.r}`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => new Date(t0 + f * (t1 - t0)).toISOString().slice(0, 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Projected stock over time">
      <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="stroke-muted" strokeWidth="1" />
      {lo < 0 && <rect x={pad.l} y={y(0)} width={W - pad.l - pad.r} height={y(lo) - y(0)} className="fill-bad/10" />}
      {d.item.reorderPoint != null && (
        <>
          <line x1={pad.l} x2={W - pad.r} y1={y(d.item.reorderPoint)} y2={y(d.item.reorderPoint)} className="stroke-warn" strokeDasharray="4 4" />
          <text x={W - pad.r} y={y(d.item.reorderPoint) - 4} textAnchor="end" className="fill-warn text-[10px]">
            minimum {q4(d.item.reorderPoint)}
          </text>
        </>
      )}
      {d.arrival && (
        <>
          <line x1={x(d.arrival)} x2={x(d.arrival)} y1={pad.t} y2={H - pad.b} className="stroke-accent" strokeDasharray="3 3" />
          <text x={x(d.arrival) + 4} y={pad.t + 10} className="fill-accent text-[10px]">
            order today arrives
          </text>
        </>
      )}
      <path d={path} fill="none" className="stroke-accent" strokeWidth="2.5" />
      {pts.slice(1).map((p, i) => (
        <circle key={i} cx={x(p.date)} cy={y(p.balance)} r="3.5" className={p.kind === "incoming" ? "fill-ok" : p.balance < 0 ? "fill-bad" : "fill-ink"} />
      ))}
      {[lo, 0, hi].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <text key={v} x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="num fill-muted text-[10px]">
          {q4(v)}
        </text>
      ))}
      {ticks.map((t, i) => (
        <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"} className="fill-muted text-[10px]">
          {date(t)}
        </text>
      ))}
    </svg>
  );
}

function Supply({ d }: { d: Detail }) {
  const events = [
    ...d.demand.map((x) => ({ key: x.jobId, what: x.jobNumber, link: `/jobs/${x.jobId}`, sub: x.priority >= 90 ? "Urgent job" : "Job", change: -x.remaining, date: x.dueDate, status: x.status })),
    ...d.incoming.map((x) => ({ key: x.poId, what: x.poNumber, link: `/purchasing/orders/${x.poId}`, sub: x.vendor, change: x.remaining, date: x.dueDate, status: x.status })),
  ].sort((a, b) => (a.date ?? "") < (b.date ?? "") ? -1 : 1);
  const bal = d.timeline.at(-1)?.balance ?? d.onHand;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ["On hand", q4(d.onHand)],
          ["Incoming", `+${q4(d.incoming.reduce((a, x) => a + x.remaining, 0))}`],
          ["Demand", `−${q4(d.demand.reduce((a, x) => a + x.remaining, 0))}`],
          ["Projected", q4(bal)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg bg-panel-2 px-3 py-2">
            <div className="text-xs text-muted">{k}</div>
            <div className={cx("num text-lg font-semibold", k === "Projected" && bal < 0 && "text-bad")}>
              {v} <span className="text-xs font-normal text-muted">{d.item.uom}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-panel-2 p-2">
        <SupplyChart d={d} />
      </div>
      {d.shortageDate && (
        <p className={cx("rounded-lg px-3 py-2 text-sm", d.arrival && d.arrival > d.shortageDate ? "bg-bad-soft text-bad" : "bg-warn-soft text-warn")}>
          Stock runs out on {date(d.shortageDate)}.{" "}
          {d.arrival ? (d.arrival > d.shortageDate ? `An order placed today arrives ${date(d.arrival)}, too late: expedite, use another vendor or move the job.` : `An order placed today arrives ${date(d.arrival)}, in time.`) : "Add a vendor to see when an order would arrive."}
        </p>
      )}
      <Table head={["Source", "Status", "Date", R("Change")]} empty="No jobs need this item and nothing is on order.">
        {events.map((e) => (
          <tr key={e.key + e.what}>
            <Td>
              <Link to={e.link} className="font-medium text-accent hover:underline">
                {e.what}
              </Link>
              <div className="text-xs text-muted">{e.sub}</div>
            </Td>
            <Td>
              <Status value={e.status} />
            </Td>
            <Td>{e.date ? date(e.date) : "No date"}</Td>
            <Td right className={e.change > 0 ? "text-ok" : "text-bad"}>
              {e.change > 0 ? "+" : "−"}
              {q4(Math.abs(e.change))}
            </Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function VendorEditor({ itemId, current }: { itemId: string; current: Detail["vendors"] }) {
  const qc = useQueryClient();
  const all = useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/vendors") });
  const [rows, setRows] = useState(current.map((v) => ({ vendorId: v.vendorId, isPrimary: v.isPrimary, leadDays: String(v.leadDays), unitCost: String(v.unitCost), minOrder: v.minOrder == null ? "" : String(v.minOrder), vendorPartNumber: v.vendorPartNumber ?? "" })));
  const [pick, setPick] = useState("");
  const save = useMutation({
    mutationFn: () =>
      api(`/items/${itemId}/vendors`, "PUT", {
        vendors: rows.map((r) => ({ vendorId: r.vendorId, isPrimary: r.isPrimary, leadDays: Number(r.leadDays) || 0, unitCost: Number(r.unitCost) || 0, minOrder: r.minOrder === "" ? null : Number(r.minOrder), vendorPartNumber: r.vendorPartNumber || null })),
      }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["purchase-plan"] }), qc.invalidateQueries({ queryKey: ["purchase-plan-item", itemId] }), qc.invalidateQueries({ queryKey: ["vendors"] })),
  });
  const name = (id: string) => all.data?.find((v) => v.id === id)?.name ?? "…";
  const set = (i: number, k: string, v: string | boolean) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : k === "isPrimary" && v ? { ...r, isPrimary: false } : r)));
  const cell = "num h-9 w-full rounded-md bg-panel-2 px-2 text-right outline-none ring-1 ring-line focus:ring-2 focus:ring-accent";
  return (
    <div className="space-y-3">
      <Table head={["Vendor", "Status", R("Lead days"), R("Unit cost"), R("Min order"), "Their part no.", ""]} empty="No vendors yet. Add one below.">
        {rows.map((r, i) => (
          <tr key={r.vendorId}>
            <Td className="font-medium">{name(r.vendorId)}</Td>
            <Td>
              <button type="button" onClick={() => set(i, "isPrimary", true)} className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1", r.isPrimary ? "bg-warn-soft text-warn ring-warn/50" : "text-muted ring-line hover:ring-accent")}>
                <Star className={cx("h-3 w-3", r.isPrimary && "fill-warn")} /> {r.isPrimary ? "Primary" : "Make primary"}
              </button>
            </Td>
            <Td right>
              <input className={cell} value={r.leadDays} onChange={(e) => set(i, "leadDays", e.target.value)} inputMode="numeric" aria-label="Lead days" />
            </Td>
            <Td right>
              <input className={cell} value={r.unitCost} onChange={(e) => set(i, "unitCost", e.target.value)} inputMode="decimal" aria-label="Unit cost" />
            </Td>
            <Td right>
              <input className={cell} value={r.minOrder} onChange={(e) => set(i, "minOrder", e.target.value)} inputMode="decimal" placeholder="—" aria-label="Minimum order" />
            </Td>
            <Td>
              <input className={cx(cell, "text-left")} value={r.vendorPartNumber} onChange={(e) => set(i, "vendorPartNumber", e.target.value)} aria-label="Vendor part number" />
            </Td>
            <Td right>
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted hover:text-bad" aria-label="Remove vendor">
                <Trash2 className="h-4 w-4" />
              </button>
            </Td>
          </tr>
        ))}
      </Table>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-auto! min-w-56">
          <option value="">Add a vendor…</option>
          {(all.data ?? [])
            .filter((v) => v.active && !rows.some((r) => r.vendorId === v.id))
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
        </Select>
        <Button disabled={!pick} onClick={() => (setRows([...rows, { vendorId: pick, isPrimary: rows.length === 0, leadDays: "7", unitCost: "", minOrder: "", vendorPartNumber: "" }]), setPick(""))}>
          <Plus className="h-4 w-4" /> Add
        </Button>
        <Link to="/purchasing?view=vendors" className="text-sm text-accent hover:underline">
          New vendor
        </Link>
        <Button className="ml-auto" variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isSuccess && !save.isPending ? "Saved" : "Save vendors"}
        </Button>
      </div>
      <ErrorNote error={save.error} />
    </div>
  );
}

// ── Orders ──────────────────────────────────────────────────────────────────

function OrdersView() {
  const nav = useNavigate();
  const [status, setStatus] = useState("open");
  const list = useQuery({ queryKey: ["purchase-orders", status], queryFn: () => api<PoSummary[]>(`/purchase-orders${qs({ status: status === "all" ? undefined : status })}`) });
  return (
    <section className="rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
      <ListBar>
        <ViewTabs
          views={[
            { key: "open", label: "Open" },
            { key: "draft", label: "Drafts" },
            { key: "received", label: "Received" },
            { key: "all", label: "All" },
          ]}
          value={status}
          onChange={setStatus}
        />
      </ListBar>
      {list.isLoading ? (
        <Loading />
      ) : (
        <Table head={["Order", "Vendor", "Status", "Ordered", "Next due", R("Received"), R("Total")]} empty="No purchase orders here. Build one from the buying plan, or start a new order.">
          {(list.data ?? []).map((o) => (
            <tr key={o.id} className="cursor-pointer hover:bg-panel-2/60" onClick={() => nav(`/purchasing/orders/${o.id}`)}>
              <Td className="font-medium">{o.number}</Td>
              <Td>{o.vendorName}</Td>
              <Td>
                <Status value={o.status} />
              </Td>
              <Td className="text-muted">{date(o.orderDate)}</Td>
              <Td className={cx(o.dueDate && o.dueDate < todayIso() && !["received", "cancelled"].includes(o.status) && "font-medium text-bad")}>{date(o.dueDate)}</Td>
              <Td right>
                <span className="inline-flex items-center gap-2">
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
                    <span className="block h-full bg-ok" style={{ width: `${o.receivedPct}%` }} />
                  </span>
                  <span className="num w-9 text-right text-xs">{o.receivedPct}%</span>
                </span>
              </Td>
              <Td right>{money(o.total)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}

const PO_STAGES = [
  { key: "draft", label: "Draft" },
  { key: "sent", label: "Sent" },
  { key: "partial", label: "Partly received" },
  { key: "received", label: "Received" },
];

type LineForm = { itemId: string; description: string; quantity: string; unitCost: string; dueDate: string };

export function PurchaseOrderPage() {
  const { id = "" } = useParams();
  const isNew = id === "new";
  const qc = useQueryClient();
  const nav = useNavigate();
  const po = useQuery({ queryKey: ["purchase-order", id], queryFn: () => api<PoDetail>(`/purchase-orders/${id}`), enabled: !isNew });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/vendors") });
  const itemsQ = useQuery({ queryKey: ["items", "", ""], queryFn: () => api<Item[]>("/items") });
  const [editing, setEditing] = useState(isNew);
  const [vendorId, setVendorId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineForm[]>([{ itemId: "", description: "", quantity: "", unitCost: "", dueDate: "" }]);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const d = po.data;
  const startEdit = () => {
    if (!d) return;
    setVendorId(d.vendor.id);
    setNotes(d.notes ?? "");
    setLines(d.lines.map((l) => ({ itemId: l.itemId ?? "", description: l.itemId ? "" : l.description, quantity: String(l.quantity), unitCost: String(l.unitCost), dueDate: l.dueDate ?? "" })));
    setEditing(true);
  };
  const refresh = (x: PoDetail) => {
    qc.setQueryData(["purchase-order", x.id], x);
    qc.invalidateQueries({ queryKey: ["purchase-orders"] });
    qc.invalidateQueries({ queryKey: ["purchase-plan"] });
    qc.invalidateQueries({ queryKey: ["inventory"] });
    qc.invalidateQueries({ queryKey: ["item-stock"] });
  };
  const save = useMutation({
    mutationFn: () => {
      const body = { vendorId, notes: notes || null, lines: lines.filter((l) => l.itemId || l.description).map((l) => ({ itemId: l.itemId || null, description: l.description || null, quantity: Number(l.quantity), unitCost: Number(l.unitCost) || 0, dueDate: l.dueDate || null })) };
      return isNew ? api<PoDetail>("/purchase-orders", "POST", body) : api<PoDetail>(`/purchase-orders/${id}`, "PUT", body);
    },
    onSuccess: (x) => (refresh(x), setEditing(false), isNew && nav(`/purchasing/orders/${x.id}`, { replace: true })),
  });
  const status = useMutation({ mutationFn: (s: string) => api<PoDetail>(`/purchase-orders/${id}/status`, "POST", { status: s }), onSuccess: refresh });

  if (!isNew && !d) return po.error ? <ErrorNote error={po.error} /> : <Loading />;
  const total = editing ? lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0) : d!.total;
  const received = d ? d.lines.reduce((a, l) => a + Math.min(l.quantityReceived, l.quantity), 0) / Math.max(1e-9, d.lines.reduce((a, l) => a + l.quantity, 0)) : 0;
  const nextDue = d?.lines.filter((l) => l.quantityReceived < l.quantity && l.dueDate).map((l) => l.dueDate!).sort()[0];
  const setLine = (i: number, k: keyof LineForm, v: string) =>
    setLines(
      lines.map((l, j) => {
        if (j !== i) return l;
        const next = { ...l, [k]: v };
        if (k === "itemId" && v && !l.unitCost) next.unitCost = String(itemsQ.data?.find((it) => it.id === v)?.unitCost ?? "");
        return next;
      }),
    );

  return (
    <div className="space-y-5">
      <DetailTitle
        parent={{ to: "/purchasing?view=orders", label: "Purchase orders" }}
        title={isNew ? "New order" : d!.number}
        badge={d && <Status value={d.status} />}
        sub={d ? `${d.vendor.name} · created ${date(d.createdAt)}${d.createdByName ? ` by ${d.createdByName}` : ""}` : "Choose the vendor and what to buy. It is saved as a draft."}
        actions={
          d &&
          !editing && (
            <>
              <Button onClick={() => printPo(d)}>
                <Printer className="h-4 w-4" /> Print
              </Button>
              {d.status === "draft" && <Button onClick={startEdit}>Edit</Button>}
              {["draft", "sent"].includes(d.status) && received === 0 && (
                <Button variant="ghost" className="text-bad" onClick={() => status.mutate("cancelled")}>
                  Cancel order
                </Button>
              )}
              {d.status === "draft" && (
                <Button variant="primary" onClick={() => status.mutate("sent")}>
                  Mark as sent
                </Button>
              )}
              {["sent", "partial"].includes(d.status) && (
                <Button variant="primary" onClick={() => setReceiveOpen(true)}>
                  <Truck className="h-4 w-4" /> Receive
                </Button>
              )}
            </>
          )
        }
      />
      {d && d.status !== "cancelled" && <StageTimeline stages={PO_STAGES} current={d.status} dates={{ draft: date(d.createdAt), sent: d.orderDate ? date(d.orderDate) : undefined }} />}
      <ErrorNote error={status.error} />
      {d && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Order total" value={money(d.total)} note={`${d.lines.length} line${d.lines.length === 1 ? "" : "s"}`} tone="accent" />
          <MetricCard label="Received" value={`${Math.round(received * 100)}%`} note={`${d.receipts.length} receipt${d.receipts.length === 1 ? "" : "s"}`} tone={received >= 1 ? "ok" : received > 0 ? "warn" : "line"} />
          <MetricCard label="Next due" value={nextDue ? date(nextDue) : "—"} note={nextDue && nextDue < todayIso() ? "Overdue: chase the vendor" : "Earliest open line"} tone={nextDue && nextDue < todayIso() ? "bad" : "line"} />
          <MetricCard label="Payment terms" value={`${d.vendor.paymentTermsDays} days`} note={d.vendor.email ?? d.vendor.phone ?? "No contact saved"} tone="line" />
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section className={recordCard}>
          <div className="text-xs text-muted">Vendor</div>
          {editing ? (
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="mt-1">
              <option value="">Choose a vendor…</option>
              {(vendorsQ.data ?? [])
                .filter((v) => v.active)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
            </Select>
          ) : (
            <>
              <Link to={`/purchasing/vendors/${d!.vendor.id}`} className="mt-0.5 text-xl font-semibold hover:text-accent">
                {d!.vendor.name}
              </Link>
              <div className="mt-1 text-sm text-muted">{[d!.vendor.address.line1, d!.vendor.address.city, d!.vendor.address.region].filter(Boolean).join(", ") || "No address saved"}</div>
            </>
          )}
          <div className="mt-4 text-xs text-muted">Notes for the vendor</div>
          {editing ? <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" /> : <p className="mt-1 whitespace-pre-wrap text-sm">{d!.notes || "—"}</p>}
        </section>

        <TabPanel title="Lines">
          {editing ? (
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,2fr)_100px_110px_150px_32px] items-end gap-2">
                  <Field label={i === 0 ? "Item or description" : ""}>
                    {l.itemId || !l.description ? (
                      <Select value={l.itemId} onChange={(e) => setLine(i, "itemId", e.target.value)}>
                        <option value="">Choose an item…</option>
                        {(itemsQ.data ?? [])
                          .filter((it) => it.active && it.type !== "manufactured")
                          .map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.partNumber} — {it.description}
                            </option>
                          ))}
                      </Select>
                    ) : (
                      <Input value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} />
                    )}
                  </Field>
                  <Field label={i === 0 ? "Quantity" : ""}>
                    <Input type="number" min={0} step="any" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} />
                  </Field>
                  <Field label={i === 0 ? "Unit cost" : ""}>
                    <Input type="number" min={0} step="any" value={l.unitCost} onChange={(e) => setLine(i, "unitCost", e.target.value)} />
                  </Field>
                  <Field label={i === 0 ? "Due" : ""}>
                    <Input type="date" value={l.dueDate} onChange={(e) => setLine(i, "dueDate", e.target.value)} />
                  </Field>
                  <button type="button" className="mb-2 text-muted hover:text-bad" onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button onClick={() => setLines([...lines, { itemId: "", description: "", quantity: "", unitCost: "", dueDate: "" }])}>
                  <Plus className="h-4 w-4" /> Item line
                </Button>
                <Button variant="ghost" onClick={() => setLines([...lines, { itemId: "", description: " ", quantity: "", unitCost: "", dueDate: "" }])}>
                  <Plus className="h-4 w-4" /> Free-text line
                </Button>
                <span className="num ml-auto text-lg font-semibold">{money(total)}</span>
              </div>
              <ErrorNote error={save.error} />
              <div className="flex justify-end gap-2">
                {!isNew && (
                  <Button variant="ghost" onClick={() => setEditing(false)}>
                    Discard
                  </Button>
                )}
                <Button variant="primary" disabled={!vendorId || save.isPending} onClick={() => save.mutate()}>
                  {isNew ? "Create draft order" : "Save order"}
                </Button>
              </div>
            </div>
          ) : (
            <>
              <Table head={["Item", R("Ordered"), R("Received"), "Due", R("Unit cost"), R("Total")]}>
                {d!.lines.map((l) => (
                  <tr key={l.id}>
                    <Td>
                      {l.itemId ? (
                        <Link to={`/inventory/${l.itemId}`} className="font-medium text-accent hover:underline">
                          {l.partNumber}
                        </Link>
                      ) : (
                        <span className="font-medium">Free text</span>
                      )}
                      <div className="max-w-80 truncate text-xs text-muted">{l.description}</div>
                    </Td>
                    <Td right>
                      {q4(l.quantity)} <span className="text-xs text-muted">{l.uom ?? ""}</span>
                    </Td>
                    <Td right className={l.quantityReceived >= l.quantity ? "text-ok" : l.quantityReceived > 0 ? "text-warn" : "text-muted"}>
                      {q4(l.quantityReceived)}
                    </Td>
                    <Td className={cx(l.dueDate && l.dueDate < todayIso() && l.quantityReceived < l.quantity && "font-medium text-bad")}>{date(l.dueDate)}</Td>
                    <Td right>{money(l.unitCost, l.unitCost < 1 ? 4 : 2)}</Td>
                    <Td right>{money(l.quantity * l.unitCost)}</Td>
                  </tr>
                ))}
              </Table>
              {d!.receipts.length > 0 && (
                <>
                  <h3 className="mb-2 mt-5 font-semibold">Receipts</h3>
                  <Table head={["Lot", "Item", "Location", R("Quantity"), "By", "When"]}>
                    {d!.receipts.map((r) => {
                      const line = d!.lines.find((l) => l.id === r.line_id);
                      return (
                        <tr key={r.id}>
                          <Td className="num font-medium">{r.lot_number}</Td>
                          <Td>{line?.partNumber ?? line?.description}</Td>
                          <Td>{r.location}</Td>
                          <Td right>{q4(r.quantity)}</Td>
                          <Td className="text-muted">{r.user_name ?? "—"}</Td>
                          <Td className="text-muted">{new Date(r.created_at).toLocaleString()}</Td>
                        </tr>
                      );
                    })}
                  </Table>
                </>
              )}
            </>
          )}
        </TabPanel>
      </div>
      {d && receiveOpen && <ReceiveOrder po={d} onClose={() => setReceiveOpen(false)} onDone={(x) => (refresh(x), setReceiveOpen(false))} />}
    </div>
  );
}

function ReceiveOrder({ po, onClose, onDone }: { po: PoDetail; onClose: () => void; onDone: (x: PoDetail) => void }) {
  const locs = useQuery({ queryKey: ["stock-locations"], queryFn: () => api<StockLocation[]>("/inventory/locations") });
  const open = po.lines.filter((l) => l.quantityReceived < l.quantity);
  const [f, setF] = useState<Record<string, { quantity: string; locationId: string; heatNumber: string }>>(Object.fromEntries(open.map((l) => [l.id, { quantity: String(Math.round((l.quantity - l.quantityReceived) * 10000) / 10000), locationId: "", heatNumber: "" }])));
  const save = useMutation({
    mutationFn: () =>
      api<PoDetail>(`/purchase-orders/${po.id}/receive`, "POST", {
        lines: open.filter((l) => Number(f[l.id]?.quantity) > 0).map((l) => ({ lineId: l.id, quantity: Number(f[l.id]!.quantity), locationId: f[l.id]!.locationId || null, heatNumber: f[l.id]!.heatNumber || null })),
      }),
    onSuccess: onDone,
  });
  const set = (id: string, k: string, v: string) => setF({ ...f, [id]: { ...f[id]!, [k]: v } });
  return (
    <Modal open onClose={onClose} title={`Receive ${po.number}`} wide>
      <p className="mb-3 text-sm text-muted">Enter what arrived. Each catalogue line goes into stock as a new lot at the order's price; leave a line at 0 if it did not come.</p>
      <Table head={["Item", R("Still due"), R("Arrived"), "Location", "Heat or mill lot"]}>
        {open.map((l) => (
          <tr key={l.id}>
            <Td>
              <div className="font-medium">{l.partNumber ?? "Free text"}</div>
              <div className="max-w-64 truncate text-xs text-muted">{l.description}</div>
            </Td>
            <Td right>{q4(l.quantity - l.quantityReceived)}</Td>
            <Td right>
              <Input type="number" min={0} step="any" value={f[l.id]?.quantity ?? ""} onChange={(e) => set(l.id, "quantity", e.target.value)} className="w-24! text-right" />
            </Td>
            <Td>
              {l.itemId ? (
                <Select value={f[l.id]?.locationId ?? ""} onChange={(e) => set(l.id, "locationId", e.target.value)}>
                  <option value="">Where it usually goes</option>
                  {(locs.data ?? [])
                    .filter((x) => x.active)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code}
                      </option>
                    ))}
                </Select>
              ) : (
                <span className="text-xs text-muted">Not stocked</span>
              )}
            </Td>
            <Td>{l.itemId && <Input value={f[l.id]?.heatNumber ?? ""} onChange={(e) => set(l.id, "heatNumber", e.target.value)} />}</Td>
          </tr>
        ))}
      </Table>
      <ErrorNote error={save.error} />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>
          Receive into stock
        </Button>
      </div>
    </Modal>
  );
}

function printPo(d: PoDetail) {
  const w = window.open("", "_blank", "width=900,height=800");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const a = d.vendor.address;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.number)}</title>
<style>@page{size:letter;margin:.6in}body{font:13px system-ui,sans-serif;color:#111}h1{font-size:24px;margin:0}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border-bottom:1px solid #ccc;padding:6px;text-align:left}th{font-size:11px;color:#555}.r{text-align:right}.top{display:flex;justify-content:space-between}.m{color:#555}.tot{font-size:16px;font-weight:700}</style></head><body>
<div class="top"><div><h1>Purchase order ${esc(d.number)}</h1><div class="m">Ordered ${esc(d.orderDate ?? "not yet sent")} · Terms ${d.vendor.paymentTermsDays} days</div></div></div>
<p><b>${esc(d.vendor.name)}</b><br>${esc([a.line1, a.line2, a.city, a.region, a.postalCode, a.country].filter(Boolean).join(", "))}<br>${esc(d.vendor.email ?? "")} ${esc(d.vendor.phone ?? "")}</p>
<table><thead><tr><th>#</th><th>Item</th><th class="r">Quantity</th><th>Due</th><th class="r">Unit cost</th><th class="r">Total</th></tr></thead><tbody>
${d.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.description)}</td><td class="r">${esc(l.quantity)} ${esc(l.uom ?? "")}</td><td>${esc(l.dueDate ?? "")}</td><td class="r">${esc(l.unitCost.toFixed(4))}</td><td class="r">${esc((l.quantity * l.unitCost).toFixed(2))}</td></tr>`).join("")}
</tbody></table><p class="r tot">Total ${esc(d.total.toFixed(2))}</p>${d.notes ? `<p><b>Notes:</b> ${esc(d.notes)}</p>` : ""}</body></html>`);
  w.document.close();
  w.focus();
  w.print();
}

// ── Vendors ─────────────────────────────────────────────────────────────────

function VendorsView() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = useQuery({ queryKey: ["vendors"], queryFn: () => api<Vendor[]>("/vendors") });
  const rows = useMemo(() => (list.data ?? []).filter((v) => !q || v.name.toLowerCase().includes(q.toLowerCase())), [list.data, q]);
  return (
    <section className="rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
      <ListBar>
        <div className="w-full sm:w-72">
          <SearchBox value={q} onChange={setQ} placeholder="Search vendors" />
        </div>
        <Button className="ml-auto" variant="primary" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add vendor
        </Button>
      </ListBar>
      <Table head={["Vendor", "City", "Contact", R("Items"), R("Open orders"), R("Open value"), "Terms"]} empty="No vendors yet. Add the companies you buy material and hardware from.">
        {rows.map((v) => (
          <tr key={v.id} className={cx("cursor-pointer hover:bg-panel-2/60", !v.active && "opacity-50")} onClick={() => nav(`/purchasing/vendors/${v.id}`)}>
            <Td className="font-medium">{v.name}</Td>
            <Td className="text-muted">{v.address?.city ?? "—"}</Td>
            <Td className="text-muted">{v.email ?? v.phone ?? "—"}</Td>
            <Td right>{v.items}</Td>
            <Td right>{v.openOrders}</Td>
            <Td right>{money(v.openValue)}</Td>
            <Td className="text-muted">{v.paymentTermsDays} days</Td>
          </tr>
        ))}
      </Table>
      {open && <VendorModal onClose={() => setOpen(false)} />}
    </section>
  );
}

function VendorModal({ vendor, onClose }: { vendor?: Vendor & { address: Record<string, string | null>; notes?: string | null }; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: vendor?.name ?? "",
    email: vendor?.email ?? "",
    phone: vendor?.phone ?? "",
    line1: vendor?.address?.line1 ?? "",
    city: vendor?.address?.city ?? "",
    region: vendor?.address?.region ?? "",
    postalCode: vendor?.address?.postalCode ?? "",
    paymentTermsDays: String(vendor?.paymentTermsDays ?? 30),
    notes: vendor?.notes ?? "",
    active: vendor?.active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, email: f.email || null, phone: f.phone || null, address: { line1: f.line1 || null, city: f.city || null, region: f.region || null, postalCode: f.postalCode || null }, paymentTermsDays: Number(f.paymentTermsDays) || 0, notes: f.notes || null, active: f.active };
      return vendor ? api(`/vendors/${vendor.id}`, "PUT", body) : api("/vendors", "POST", body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["vendors"] }), qc.invalidateQueries({ queryKey: ["vendor"] }), onClose()),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open onClose={onClose} title={vendor ? `Edit ${vendor.name}` : "Add vendor"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Company name">
          <Input value={f.name} onChange={set("name")} required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Email">
            <Input type="email" value={f.email} onChange={set("email")} />
          </Field>
          <Field label="Phone">
            <Input value={f.phone} onChange={set("phone")} />
          </Field>
          <Field label="Street">
            <Input value={f.line1} onChange={set("line1")} />
          </Field>
          <Field label="City">
            <Input value={f.city} onChange={set("city")} />
          </Field>
          <Field label="State or region">
            <Input value={f.region} onChange={set("region")} />
          </Field>
          <Field label="Payment terms (days)">
            <Input type="number" min={0} value={f.paymentTermsDays} onChange={set("paymentTermsDays")} />
          </Field>
        </div>
        <Field label="Notes">
          <Textarea rows={2} value={f.notes} onChange={set("notes")} />
        </Field>
        {vendor && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active (shown when ordering)
          </label>
        )}
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Save vendor
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type VendorDetail = Vendor & {
  address: Record<string, string | null>;
  notes: string | null;
  supplies: { itemId: string; partNumber: string; description: string; uom: string; isPrimary: boolean; leadDays: number; unitCost: number; minOrder: number | null; vendorPartNumber: string | null }[];
  orders: PoSummary[];
};

export function VendorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const v = useQuery({ queryKey: ["vendor", id], queryFn: () => api<VendorDetail>(`/vendors/${id}`) });
  const [edit, setEdit] = useState(false);
  if (!v.data) return v.error ? <ErrorNote error={v.error} /> : <Loading />;
  const d = v.data;
  const open = d.orders.filter((o) => ["draft", "sent", "partial"].includes(o.status));
  return (
    <div className="space-y-5">
      <DetailTitle
        parent={{ to: "/purchasing?view=vendors", label: "Vendors" }}
        title={d.name}
        badge={!d.active && <Badge>Inactive</Badge>}
        sub={[d.address.city, d.address.region].filter(Boolean).join(", ") || undefined}
        actions={<Button onClick={() => setEdit(true)}>Edit</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Items supplied" value={d.supplies.length} note={`Primary for ${d.supplies.filter((s) => s.isPrimary).length}`} tone="accent" />
        <MetricCard label="Open orders" value={open.length} note={money(open.reduce((a, o) => a + o.total, 0))} tone="line" />
        <MetricCard label="Ordered to date" value={money(d.orders.filter((o) => o.status !== "cancelled").reduce((a, o) => a + o.total, 0))} note={`${d.orders.length} orders`} tone="line" />
        <MetricCard label="Payment terms" value={`${d.paymentTermsDays} days`} note={d.email ?? d.phone ?? "No contact saved"} tone="line" />
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <TabPanel title="Items they supply">
          <Table head={["Item", "Status", R("Lead"), R("Cost"), R("Min order")]} empty="Not linked to any item yet. Add this vendor on an item from the buying plan.">
            {d.supplies.map((s) => (
              <tr key={s.itemId}>
                <Td>
                  <Link to={`/inventory/${s.itemId}`} className="font-medium text-accent hover:underline">
                    {s.partNumber}
                  </Link>
                  <div className="text-xs text-muted">{s.description}</div>
                </Td>
                <Td>{s.isPrimary ? <Badge tone="warn">Primary</Badge> : <Badge>Secondary</Badge>}</Td>
                <Td right>{s.leadDays} d</Td>
                <Td right>{money(s.unitCost, 4)}</Td>
                <Td right>{s.minOrder != null ? q4(s.minOrder) : "—"}</Td>
              </tr>
            ))}
          </Table>
        </TabPanel>
        <TabPanel title="Orders">
          <Table head={["Order", "Status", "Ordered", R("Total")]} empty="No orders yet.">
            {d.orders.map((o) => (
              <tr key={o.id} className="cursor-pointer hover:bg-panel-2/60" onClick={() => nav(`/purchasing/orders/${o.id}`)}>
                <Td className="font-medium">{o.number}</Td>
                <Td>
                  <Status value={o.status} />
                </Td>
                <Td className="text-muted">{date(o.orderDate)}</Td>
                <Td right>{money(o.total)}</Td>
              </tr>
            ))}
          </Table>
        </TabPanel>
      </div>
      {edit && <VendorModal vendor={d} onClose={() => setEdit(false)} />}
    </div>
  );
}
