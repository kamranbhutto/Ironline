import { useQuery } from "@tanstack/react-query";
import { Boxes, Hourglass, Package, Pause, Play, RefreshCw, Activity, Clock, CircleDashed } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api } from "../api.ts";
import { runTimeText } from "../components/RunTimeInput.tsx";
import { Button, Card, cx, ErrorNote, Input, Loading, PageHeader, Status } from "../components/ui.tsx";
import { date, isPast, num } from "../format.ts";

// ── Types ───────────────────────────────────────────────────────────────────
type FloorWc = { id: string; code: string; name: string; kind: string; queued: number; running: number };
type QueueRow = {
  id: string; sequence: number; description: string | null; status: string; setupHours: number; runHoursPerUnit: number; quantityGood: number;
  jobId: string; jobNumber: string; jobDescription: string; quantity: number; dueDate: string | null; priority: number; customerName: string | null; partNumber: string | null;
};

// ── Work center picker + queue ──────────────────────────────────────────────
export function FloorPage() {
  const [params, setParams] = useSearchParams();
  const wcId = params.get("wc") ?? "";
  const nav = useNavigate();
  const wcs = useQuery({ queryKey: ["floor-wcs"], queryFn: () => api<FloorWc[]>("/floor/work-centers"), refetchInterval: 20_000 });
  const queue = useQuery({ queryKey: ["floor-queue", wcId], queryFn: () => api<QueueRow[]>(`/floor/work-centers/${wcId}/queue`), enabled: !!wcId, refetchInterval: 15_000 });
  const wc = wcs.data?.find((w) => w.id === wcId);
  return (
    <>
      <PageHeader
        title="Shop floor"
        sub={wc ? `${wc.code} · ${wc.name}` : "Pick your work center to see what to run next"}
        actions={
          <>
            <Link to="/floor/board" className="inline-flex min-h-9 items-center rounded-lg px-3.5 text-sm font-medium ring-1 ring-inset ring-line hover:bg-panel-2">Schedule board</Link>
            {wc && <Button onClick={() => setParams({})}>Change work center</Button>}
          </>
        }
      />
      {!wcId ? (
        wcs.isLoading ? <Loading /> : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(wcs.data ?? []).map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => setParams({ wc: w.id })}
                className="rounded-xl bg-panel p-5 text-left shadow-panel ring-1 ring-line/70 transition hover:ring-2 hover:ring-accent"
              >
                <div className="text-lg font-semibold">{w.code}</div>
                <div className="text-sm text-muted">{w.name}</div>
                <div className="mt-4 flex items-center gap-3 text-sm">
                  <span className="num font-medium">{w.queued} in queue</span>
                  {w.running > 0 && <Status value="running" />}
                </div>
              </button>
            ))}
            {!wcs.data?.length && <p className="text-sm text-muted">No work centers yet. Add them under Setup → Work centers.</p>}
          </div>
        )
      ) : queue.isLoading ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {!(queue.data ?? []).length && (
            <Card><p className="py-8 text-center text-sm text-muted">Nothing to run here. Released jobs appear when their previous step is done.</p></Card>
          )}
          {(queue.data ?? []).map((o, i) => (
            <button
              key={o.id}
              type="button"
              onClick={() => nav(`/floor/op/${o.id}`)}
              className={cx("flex w-full flex-wrap items-center gap-4 rounded-xl bg-panel p-4 text-left shadow-panel ring-1 transition hover:ring-2 hover:ring-accent", o.status === "running" ? "ring-live" : "ring-line/70")}
            >
              <span className="num flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-panel-2 text-sm font-semibold text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold">{o.jobNumber}</span>
                  <span className="text-sm text-muted">Op {o.sequence}</span>
                  <Status value={o.status} />
                </div>
                <div className="truncate text-sm">{o.description || o.jobDescription}</div>
                <div className="text-xs text-muted">{[o.customerName, o.partNumber].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="num text-right text-sm">
                <div>{num(o.quantityGood, 4)} / {num(o.quantity, 4)} pcs</div>
                <div className="text-xs text-muted">{num(o.setupHours + o.runHoursPerUnit * o.quantity, 2)} h planned</div>
              </div>
              <div className={cx("num w-28 text-right text-sm", isPast(o.dueDate) ? "font-semibold text-bad" : "")}>Due {date(o.dueDate)}</div>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

// ── Schedule board ──────────────────────────────────────────────────────────
type BoardCard = QueueRow & { workCenterId: string; remainingHours: number; state: string; late: boolean; materialShort: boolean; jobStatus: string };
type BoardData = { columns: { id: string; code: string; name: string; capacityHoursPerDay: number; backlogHours: number; finishDate: string | null; cards: BoardCard[] }[]; latePct: number; updatedAt: string };

const STATE: Record<string, { label: string; cls: string; icon: typeof Play }> = {
  running: { label: "Running", cls: "bg-[#5cc735] text-white", icon: Activity },
  paused: { label: "Paused", cls: "bg-[#8d949c] text-white", icon: Pause },
  ready: { label: "Ready", cls: "bg-[#4fb6ef] text-white", icon: Play },
  setup_pending: { label: "Setup pending", cls: "bg-[#8b74e0] text-white", icon: Hourglass },
  waiting: { label: "Waiting on previous step", cls: "bg-panel-2 text-muted", icon: Clock },
  pieces: { label: "Waiting for pieces", cls: "bg-warn-soft text-warn", icon: Boxes },
  planned: { label: "Not released", cls: "bg-panel-2 text-muted", icon: CircleDashed },
};
const PRIORITY = (p: number) => (p >= 90 ? "Urgent" : p >= 70 ? "High" : p >= 40 ? "Moderate" : "Low");
const shortDate = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "2-digit" }) : "—");
const hm = (h: number) => {
  const m = Math.round(h * 60);
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

export function BoardPage() {
  const nav = useNavigate();
  const b = useQuery({ queryKey: ["board"], queryFn: () => api<BoardData>("/floor/board"), refetchInterval: 30_000 });
  const [q, setQ] = useState("");
  if (b.error) return <ErrorNote error={b.error} />;
  if (!b.data) return <Loading />;
  const match = (c: BoardCard) => !q || `${c.jobNumber} ${c.customerName ?? ""} ${c.partNumber ?? ""}`.toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight">Schedule — all work centers</h1>
          <p className="text-xs text-muted">Last updated {new Date(b.data.updatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })} · each column runs top to bottom</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cx("num rounded-lg px-3 py-2 text-sm font-semibold", b.data.latePct ? "bg-bad text-white" : "bg-ok-soft text-ok")}>Late {b.data.latePct}%</span>
          <Input type="search" placeholder="Search job, customer, part" aria-label="Find on the board" value={q} onChange={(e) => setQ(e.target.value)} className="w-64!" />
          <Button variant="primary" onClick={() => b.refetch()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
      </div>
      <div className="-mx-4 flex h-[calc(100vh-200px)] min-h-[420px] gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {b.data.columns.map((col) => {
          const cards = col.cards.filter(match);
          const idle = col.cards.length === 0;
          return (
            <section key={col.id} className={cx("flex shrink-0 flex-col border-r border-line pr-3 last:border-r-0", idle ? "w-40" : "w-[250px]")}>
              <header className="mb-2 border-b-2 border-ink/80 pb-1.5 pt-1">
                <div className="truncate text-xl font-semibold" title={col.name}>{col.code} {!idle && <span className="text-sm font-normal text-muted">{col.name}</span>}</div>
                <div className="num text-xs text-muted">
                  {idle ? "Idle" : <>Backlog {num(col.backlogHours, 0)} hrs{col.finishDate ? `, ${date(col.finishDate)}` : ""}</>}
                </div>
              </header>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto pr-0.5">
                {cards.map((c) => {
                  const st = STATE[c.state] ?? STATE.ready!;
                  const Icon = st.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => nav(c.jobStatus === "planned" ? `/jobs/${c.jobId}` : `/floor/op/${c.id}`)}
                      className={cx("rounded-lg bg-panel p-3 text-left shadow-panel ring-1 transition hover:ring-2 hover:ring-accent", c.late ? "ring-2 ring-bad" : "ring-line/70")}
                    >
                      <div className="text-[17px] font-semibold">Job {c.jobNumber}</div>
                      <div className={cx("mt-1.5 flex items-center justify-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium", st.cls)}>
                        <Icon className="h-4 w-4" aria-hidden /> {st.label}
                      </div>
                      {c.materialShort && c.jobStatus !== "planned" && (
                        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-[#ece8fb] px-1.5 py-0.5 text-[11px] text-[#5b45b8]"><Package className="h-3 w-3" aria-hidden /> Material not picked</div>
                      )}
                      <div className="num mt-1.5 text-xs">{hm(c.remainingHours)} left</div>
                      <div className="num text-[11px] text-muted" title="Planned time: setup once, then run time for every piece">
                        {num(c.setupHours, 2)} h setup + {num(c.quantity, 0)} × {runTimeText(c.runHoursPerUnit)}
                      </div>
                      <div className="text-[11px] text-muted">Priority: {PRIORITY(c.priority)}</div>
                      <div className="num mt-1.5 flex justify-between gap-2 text-sm font-semibold">
                        <span className={cx("whitespace-nowrap", c.late && "text-bad")}>Due {shortDate(c.dueDate)}</span>
                        <span className="truncate font-medium" title={c.description ?? undefined}>{c.description || "Op"} ({c.sequence / 10})</span>
                      </div>
                      <div className="mt-1 flex justify-between gap-2 text-xs font-medium">
                        <span className="truncate">{c.customerName ?? "Stock"}</span>
                        <span className="truncate text-muted">{c.partNumber}</span>
                      </div>
                    </button>
                  );
                })}
                {idle && <div className="px-1.5 text-xs text-muted">Nothing scheduled</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
