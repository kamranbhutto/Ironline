import { useQuery } from "@tanstack/react-query";
import { HardHat, Plus } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { PinnedReports } from "./Reports.tsx";
import { api, type Dashboard, type JobSummary, type QuoteSummary, type SalesOrderSummary } from "../api.ts";
import { Badge, ButtonLink, cx, ErrorNote, Loading, MetricCard, PillTabs, Status, TabPanel } from "../components/ui.tsx";
import { date, isPast, money, num } from "../format.ts";

type BoardCol = { id: string; code: string; name: string; capacityHoursPerDay: number; backlogHours: number; finishDate: string | null; cards: { state: string; late: boolean }[] };
type Board = { columns: BoardCol[]; latePct: number };

const daysUntil = (iso: string | null) => (iso ? Math.round((new Date(`${iso.slice(0, 10)}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86_400_000) : null);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function DashboardPage() {
  const d = useQuery({ queryKey: ["dashboard"], queryFn: () => api<Dashboard>("/dashboard") });
  const jobs = useQuery({ queryKey: ["jobs", "open", ""], queryFn: () => api<JobSummary[]>("/jobs?status=open") });
  const quotes = useQuery({ queryKey: ["quotes", "", ""], queryFn: () => api<QuoteSummary[]>("/quotes") });
  const orders = useQuery({ queryKey: ["sales-orders", "open", ""], queryFn: () => api<SalesOrderSummary[]>("/sales-orders?status=open") });
  const board = useQuery({ queryKey: ["board"], queryFn: () => api<Board>("/floor/board"), refetchInterval: 60_000 });
  const [prodTab, setProdTab] = useState<"due" | "late" | "running">("due");
  const [salesTab, setSalesTab] = useState<"sent" | "draft" | "orders">("sent");
  const nav = useNavigate();

  if (d.error) return <ErrorNote error={d.error} />;
  if (!d.data) return <Loading />;
  const s = d.data;
  const open = jobs.data ?? [];
  const late = open.filter((j) => isPast(j.dueDate));
  const running = open.filter((j) => j.status === "in_progress");
  const sent = (quotes.data ?? []).filter((q) => q.status === "sent");
  const drafts = (quotes.data ?? []).filter((q) => q.status === "draft");
  const expiring = sent.filter((q) => {
    const n = daysUntil(q.validUntil);
    return n != null && n <= 7;
  }).length;
  const prodRows = prodTab === "late" ? late : prodTab === "running" ? running : open;
  const cols = (board.data?.columns ?? []).filter((c) => c.cards.length || c.backlogHours);
  const maxDays = Math.max(5, ...cols.map((c) => (c.capacityHoursPerDay ? c.backlogHours / c.capacityHoursPerDay : 0)));

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">{greeting()}</h1>
          <p className="mt-1 text-sm text-muted">
            {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
            {s.lateJobs ? <span className="font-medium text-bad">{s.lateJobs} late {s.lateJobs === 1 ? "job" : "jobs"} need attention</span> : "Everything is on time"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink to="/floor"><HardHat className="h-4 w-4" /> Shop floor</ButtonLink>
          <ButtonLink to="/quotes/new" variant="primary"><Plus className="h-4 w-4" /> New quote</ButtonLink>
        </div>
      </div>

      {/* The flow of work from quote to shipped, left to right. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard to="/quotes" label="Open quotes" value={s.openQuotes} tone="accent" note={`${money(s.quotedValue, 0)} waiting on customers`} badge={expiring ? <Badge tone="warn">{expiring} expiring</Badge> : undefined} />
        <MetricCard to="/quotes" label="Win rate" value={s.winRate90 == null ? "—" : `${s.winRate90}%`} tone={s.winRate90 != null && s.winRate90 < 25 ? "warn" : "ok"} note="Quotes decided in the last 90 days" />
        <MetricCard to="/sales-orders" label="Backlog" value={money(s.backlog, 0)} tone="ok" note={`${s.openOrders} open ${s.openOrders === 1 ? "order" : "orders"}`} />
        <MetricCard to="/jobs" label="Open jobs" value={s.openJobs} tone="line" note={`${running.length} running on the floor`} />
        <MetricCard
          to="/jobs"
          label="Late jobs"
          value={s.lateJobs}
          tone={s.lateJobs ? "bad" : "ok"}
          badge={board.data ? <Badge tone={board.data.latePct ? "bad" : "ok"}>{board.data.latePct}% of jobs</Badge> : undefined}
          note={s.lateJobs ? "Past their due date" : "Everything on time"}
        />
      </div>

      <section className="mt-5 rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
        <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-semibold">Shop load</h2>
          <Link to="/floor/board" className="text-sm text-accent hover:underline">Open the schedule board</Link>
        </header>
        {!cols.length ? (
          <p className="py-6 text-center text-sm text-muted">No work queued at any work center.</p>
        ) : (
          <ul className="space-y-2.5">
            {cols.map((c) => {
              const days = c.capacityHoursPerDay ? c.backlogHours / c.capacityHoursPerDay : 0;
              const lateCards = c.cards.filter((x) => x.late).length;
              const isRunning = c.cards.some((x) => x.state === "running");
              return (
                <li key={c.id} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[180px_minmax(0,1fr)_200px]">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium">
                      <span className={cx("h-2 w-2 shrink-0 rounded-full", isRunning ? "bg-live" : "bg-line")} aria-label={isRunning ? "Running" : "Idle"} />
                      {c.code}
                    </div>
                    <div className="truncate text-xs text-muted">{c.name}</div>
                  </div>
                  <div className="h-3 overflow-hidden rounded-full bg-panel-2" title={`${num(days, 1)} days of work`}>
                    <div className={cx("h-full rounded-full", lateCards ? "bg-bad" : days > 5 ? "bg-warn" : "bg-ok")} style={{ width: `${Math.max(2, (days / maxDays) * 100)}%` }} />
                  </div>
                  <div className="num text-right text-xs text-muted">
                    <span className="font-medium text-ink">{num(c.backlogHours, 1)} h</span> · {c.cards.length} {c.cards.length === 1 ? "job" : "jobs"}
                    {lateCards > 0 && <span className="text-bad"> · {lateCards} late</span>}
                    <div className="hidden sm:block">{c.finishDate ? `Clear by ${date(c.finishDate)}` : ""}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="mt-5 grid gap-5 2xl:grid-cols-2">
        <TabPanel
          title="Production"
          tabs={
            <PillTabs
              tabs={[
                { key: "due" as const, label: "Due next", count: open.length },
                { key: "late" as const, label: "Late", count: late.length },
                { key: "running" as const, label: "Running", count: running.length },
              ]}
              value={prodTab}
              onChange={setProdTab}
            />
          }
        >
          {!prodRows.length ? (
            <p className="py-8 text-center text-sm text-muted">{prodTab === "late" ? "No late jobs." : prodTab === "running" ? "Nothing is running right now." : "No open jobs."}</p>
          ) : (
            <ul className="-my-1 divide-y divide-line">
              {prodRows.slice(0, 8).map((j) => {
                const pct = j.operationsTotal ? Math.round((j.operationsDone / j.operationsTotal) * 100) : 0;
                const lateJob = isPast(j.dueDate);
                const n = daysUntil(j.dueDate);
                return (
                  <li key={j.id}>
                    <button type="button" onClick={() => nav(`/jobs/${j.id}`)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-panel-2/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="num font-semibold">{j.number}</span>
                          <Status value={lateJob ? "late" : j.status} />
                        </div>
                        <div className="truncate text-sm text-muted">{j.customerName ?? "Stock"} · {j.description}</div>
                      </div>
                      <div className="hidden w-32 sm:block">
                        <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
                          <div className={cx("h-full", j.status === "in_progress" ? "bg-live" : "bg-accent")} style={{ width: `${pct}%` }} />
                        </div>
                        <div className="num mt-1 text-xs text-muted">{j.operationsDone}/{j.operationsTotal} steps</div>
                      </div>
                      <div className={cx("num w-24 text-right text-sm", lateJob ? "font-medium text-bad" : "")}>
                        {date(j.dueDate)}
                        <div className="text-xs text-muted">{n == null ? "" : n < 0 ? `${-n} d late` : n === 0 ? "Today" : `in ${n} d`}</div>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabPanel>

        <TabPanel
          title="Sales"
          tabs={
            <PillTabs
              tabs={[
                { key: "sent" as const, label: "With customer", count: sent.length },
                { key: "draft" as const, label: "Drafts", count: drafts.length },
                { key: "orders" as const, label: "Open orders", count: orders.data?.length },
              ]}
              value={salesTab}
              onChange={setSalesTab}
            />
          }
        >
          {salesTab !== "orders" ? (
            (salesTab === "sent" ? sent : drafts).length ? (
              <ul className="-my-1 divide-y divide-line">
                {(salesTab === "sent" ? sent : drafts).slice(0, 8).map((q) => {
                  const n = daysUntil(q.validUntil);
                  const margin = q.totalPrice > 0 ? ((q.totalPrice - q.totalCost) / q.totalPrice) * 100 : 0;
                  return (
                    <li key={q.id}>
                      <button type="button" onClick={() => nav(`/quotes/${q.id}`)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-panel-2/60">
                        <div className="min-w-0 flex-1">
                          <div className="num font-semibold">{q.number}</div>
                          <div className="truncate text-sm text-muted">{q.customerName}</div>
                        </div>
                        <Badge tone={margin < 15 ? "bad" : "muted"}>{num(margin, 1)}% margin</Badge>
                        {salesTab === "sent" && n != null && <Badge tone={n < 0 ? "bad" : n <= 7 ? "warn" : "muted"}>{n < 0 ? "Expired" : `${n} d left`}</Badge>}
                        <div className="num w-28 text-right font-medium">{money(q.totalPrice)}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-muted">{salesTab === "sent" ? "No quotes are out with customers." : "No draft quotes."}</p>
            )
          ) : (orders.data ?? []).length ? (
            <ul className="-my-1 divide-y divide-line">
              {(orders.data ?? []).slice(0, 8).map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => nav(`/sales-orders/${o.id}`)} className="flex w-full items-center gap-3 rounded-lg px-1 py-2.5 text-left hover:bg-panel-2/60">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="num font-semibold">{o.number}</span>
                        <Status value={o.status} />
                      </div>
                      <div className="truncate text-sm text-muted">{o.customerName}{o.customerPo && ` · PO ${o.customerPo}`}</div>
                    </div>
                    <div className={cx("num text-sm", isPast(o.dueDate) ? "font-medium text-bad" : "text-muted")}>Due {date(o.dueDate)}</div>
                    <div className="num w-28 text-right font-medium">{money(o.totalPrice)}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted">No open orders.</p>
          )}
        </TabPanel>
      </div>
      <div className="mt-5">
        <PinnedReports />
      </div>
    </>
  );
}
