import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Boxes, RefreshCw, ChevronDown, ChevronRight, ChevronUp, HardHat, Lock, Pencil, Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, qs, type JobDetail, type JobSummary, type Me } from "../api.ts";
import { QualityTab, ReportTab } from "../components/JobQuality.tsx";
import { FilesPanel, pollWhilePreparing, type FileRow } from "../components/Files.tsx";
import { useThumb } from "../thumbs.ts";
import { printLabel } from "../printLabel.ts";
import { Button, ButtonLink, Card, cx, MoreMenu, ErrorNote, InsetField, insetControl, ListBar, Loading, PageHeader, PillTabs, SearchBox, StageTimeline, Status, Table, Td, VarianceCard, ViewTabs, R } from "../components/ui.tsx";
import { date, isPast, label, money, num } from "../format.ts";

const OPEN = ["planned", "released", "in_progress"];
const VIEWS = [
  { key: "open", label: "Open" },
  { key: "late", label: "Late" },
  { key: "planned", label: "Planned" },
  { key: "in_progress", label: "In progress" },
  { key: "complete", label: "Complete" },
  { key: "", label: "All" },
];

export function JobsPage() {
  const [q, setQ] = useState("");
  const [view, setView] = useState("open");
  const nav = useNavigate();
  const status = view === "late" ? "open" : view;
  const list = useQuery({ queryKey: ["jobs", status, q], queryFn: () => api<JobSummary[]>(`/jobs${qs({ q, status })}`) });
  const rows = (list.data ?? []).filter((j) => view !== "late" || isPast(j.dueDate));
  return (
    <>
      <PageHeader
        title="Jobs"
        sub="Work orders on the shop floor, soonest due first"
        actions={
          <>
            <ButtonLink to="/floor/board">Schedule board</ButtonLink>
            <ButtonLink to="/floor" variant="primary">
              <HardHat className="h-4 w-4" /> Shop floor
            </ButtonLink>
          </>
        }
      />
      <Card pad={false}>
        <ListBar>
          <ViewTabs views={VIEWS} value={view} onChange={setView} />
          <div className="ml-auto w-full sm:w-72">
            <SearchBox value={q} onChange={setQ} placeholder="Search job, part or customer" />
          </div>
        </ListBar>
        {list.isLoading ? (
          <Loading />
        ) : (
          <Table head={["Job", "Customer", R("Qty"), "Due", "Progress", R("Est. cost"), R("Actual"), "Status"]} empty={view === "late" ? "No late jobs." : "No jobs here. Jobs are created from sales orders."}>
            {rows.map((j) => {
              const late = OPEN.includes(j.status) && isPast(j.dueDate);
              const pct = j.operationsTotal ? Math.round((j.operationsDone / j.operationsTotal) * 100) : 0;
              return (
                <tr key={j.id} className="cursor-pointer hover:bg-panel-2/60" onClick={() => nav(`/jobs/${j.id}`)}>
                  <Td>
                    <div className="font-medium">{j.number}</div>
                    <div className="max-w-64 truncate text-xs text-muted">{j.description}</div>
                  </Td>
                  <Td>
                    <div>{j.customerName ?? "Stock"}</div>
                    <div className="text-xs text-muted">{j.salesOrderNumber}</div>
                  </Td>
                  <Td right>{num(j.quantity, 4)}</Td>
                  <Td className={late ? "font-medium text-bad" : ""}>{date(j.dueDate)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel-2">
                        <div className={cx("h-full", j.status === "in_progress" ? "bg-live" : "bg-accent")} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="num text-xs text-muted">{j.operationsDone}/{j.operationsTotal}</span>
                    </div>
                  </Td>
                  <Td right>{money(j.estimatedCost)}</Td>
                  <Td right className={j.actualCost > j.estimatedCost ? "text-bad" : "text-muted"}>{j.actualCost ? money(j.actualCost) : "—"}</Td>
                  <Td><Status value={late ? "late" : j.status} /></Td>
                </tr>
              );
            })}
          </Table>
        )}
      </Card>
    </>
  );
}

const STAGES = [
  { key: "planned", label: "Planned" },
  { key: "released", label: "Released" },
  { key: "in_progress", label: "In progress" },
  { key: "complete", label: "Complete" },
  { key: "closed", label: "Closed" },
];


const LOG_TEXT: Record<string, (d: Record<string, unknown>) => string> = {
  created: () => "Job created",
  status: (d) => `Status changed from ${String(d.from).replace("_", " ")} to ${String(d.to).replace("_", " ")}`,
  updated: () => "Job details edited",
  timer_started: (d) => `Started ${d.kind} timer on operation ${d.operation}`,
  timer_stopped: (d) => `Stopped timer on operation ${d.operation}: ${d.good ?? 0} good${d.scrap ? `, ${d.scrap} scrap${d.reason ? ` (${d.reason})` : ""}` : ""}`,
  operation_done: (d) => `Operation ${d.operation} complete: ${d.good} good${d.scrap ? `, ${d.scrap} scrap` : ""}${d.next ? ` · operation ${d.next} is ready` : ""}`,
  material_picked: (d) => `Picked ${d.quantity} of ${d.material}`,
  material_returned: (d) => `Returned ${d.quantity} of ${d.material}`,
  file_added: (d) => `Added file ${d.file}`,
  file_removed: (d) => `Removed file ${d.file}`,
  inspection_failed: (d) => `Piece ${d.piece}: ${d.count} reading${d.count === 1 ? "" : "s"} out of tolerance`,
  remnant_saved: (d) => `Saved remnant ${d.lot}: ${d.quantity} of ${d.material} (${d.dimensions})`,
  inspection_plan_copied: (d) => `Inspection plan copied from the part (${d.balloons} balloons)`,
};

type Tab = "files" | "log" | "scrap" | "cost" | "quality" | "certs";

/** Which statuses a job can move to from each status (the server enforces the same rules). */
const NEXT: Record<string, string[]> = {
  planned: ["released", "cancelled"],
  released: ["planned", "in_progress", "cancelled"],
  in_progress: ["complete"],
  complete: ["in_progress", "closed"],
  closed: [],
  cancelled: [],
};
const STATUS_TONE: Record<string, "ok" | "live" | "accent" | "bad" | undefined> = { released: "accent", in_progress: "ok", complete: "ok", cancelled: "bad" };
const TYPE_LABEL: Record<string, string> = { manufactured: "Made in house", purchased: "Bought in", material: "Material", service: "Service" };

/** The date each stage was last reached, from the job's history. */
function stageDates(j: JobDetail) {
  const out: Record<string, string> = {};
  // The log is newest first, so the first entry per status is the latest time it was reached.
  for (const e of j.log) if (e.action === "status" && typeof e.data.to === "string") out[e.data.to] ??= date(e.createdAt);
  out.planned ??= date(j.createdAt);
  return out;
}

export function JobDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api<JobDetail>(`/jobs/${id}`) });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), staleTime: Infinity });
  const [tab, setTab] = useState<Tab>("files");
  const [fileCount, setFileCount] = useState<number | undefined>();
  const [form, setForm] = useState({ dueDate: "", priority: "50", notes: "" });
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!job.data || dirty) return;
    setForm({ dueDate: job.data.dueDate ?? "", priority: String(job.data.priority), notes: job.data.notes ?? "" });
  }, [job.data, dirty]);
  const done = (j: JobDetail) => (qc.setQueryData(["job", id], j), qc.invalidateQueries({ queryKey: ["jobs"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }));
  const move = useMutation({ mutationFn: (status: string) => api<JobDetail>(`/jobs/${id}/status`, "POST", { status }), onSuccess: done });
  const save = useMutation({
    mutationFn: () => api<JobDetail>(`/jobs/${id}`, "PATCH", { dueDate: form.dueDate || null, priority: Number(form.priority), notes: form.notes || null }),
    onSuccess: (j) => (done(j), setDirty(false)),
  });
  if (job.error) return <ErrorNote error={job.error} />;
  if (!job.data) return <Loading />;
  const j = job.data;
  const late = OPEN.includes(j.status) && isPast(j.dueDate);
  const c = j.costs;
  const totalEst = c.laborEstimate + c.materialEstimate;
  const totalAct = c.laborActual + c.materialActual;
  const started = totalAct > 0;
  const finished = j.status === "complete" || j.status === "closed";
  const workOp = j.operations.find((o) => o.status === "running") ?? j.operations.find((o) => o.status === "ready");
  const allOpsDone = j.operations.length > 0 && j.operations.every((o) => o.status === "done");
  const editable = !["closed", "cancelled"].includes(j.status);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => (setForm({ ...form, [k]: e.target.value }), setDirty(true));
  const scrapTotal = j.operations.reduce((a, o) => a + o.quantityScrap, 0);
  const marginEst = j.revenue != null ? j.revenue - totalEst : null;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-1.5 text-[28px] font-semibold leading-tight tracking-tight">
            <Link to="/jobs" className="text-accent hover:underline">Jobs</Link>
            <ChevronRight className="h-6 w-6 text-muted" aria-hidden />
            <span className="num">{j.number}</span>
            {late && <Status value="late" />}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {j.parent && (
              <>
                <Link className="mr-1 inline-flex items-center gap-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent hover:underline" to={`/jobs/${j.parent.id}`}>
                  <Boxes className="h-3 w-3" /> Piece of {j.parent.number}
                </Link>{" "}
              </>
            )}
            {j.description}
            {j.salesOrderId && (
              <>
                {" for "}
                <Link className="text-accent hover:underline" to={`/sales-orders/${j.salesOrderId}`}>{j.salesOrderNumber}</Link>
                {j.customerPo && <> (PO {j.customerPo})</>}
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["released", "in_progress"].includes(j.status) && workOp && (
            <ButtonLink to={`/floor/op/${workOp.id}`} variant="primary">
              <HardHat className="h-4 w-4" /> Work on it
            </ButtonLink>
          )}
          {j.status === "planned" && <Button variant="primary" onClick={() => move.mutate("released")} disabled={move.isPending}>Release to shop</Button>}
          {j.status === "in_progress" && allOpsDone && <Button variant="primary" onClick={() => move.mutate("complete")} disabled={move.isPending}>Mark complete</Button>}
          {j.status === "complete" && <Button variant="primary" onClick={() => move.mutate("closed")} disabled={move.isPending}>Close job</Button>}
          <MoreMenu
            items={[
              ...(j.status === "released" ? [{ label: "Back to planned", onClick: () => move.mutate("planned") }] : []),
              ...(j.status === "in_progress" && !allOpsDone ? [{ label: "Mark complete (operations still open)", onClick: () => move.mutate("complete") }] : []),
              ...(j.status === "complete" ? [{ label: "Reopen", onClick: () => move.mutate("in_progress") }] : []),
              ...(j.status === "planned" || j.status === "released" ? [{ label: "Cancel job", onClick: () => move.mutate("cancelled"), danger: true }] : []),
            ]}
          />
        </div>
      </div>
      <ErrorNote error={move.error} />

      <div className="mb-5 px-1">
        {j.status === "cancelled" ? (
          <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">This job was cancelled.</div>
        ) : (
          <StageTimeline stages={STAGES} current={j.status} dates={stageDates(j)} />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 2xl:grid-cols-5">
        <VarianceCard label="Material cost" partial={!finished} actual={started ? c.materialActual : null} estimate={c.materialEstimate} />
        <VarianceCard label="Labor cost" partial={!finished} actual={started ? c.laborActual : null} estimate={c.laborEstimate} />
        <VarianceCard label="Total cost" partial={!finished} actual={started ? totalAct : null} estimate={totalEst} />
        {finished ? (
          <VarianceCard label="Margin" actual={j.revenue != null ? j.revenue - totalAct : null} estimate={marginEst} moreIsBetter />
        ) : (
          <VarianceCard
            label="Projected margin"
            actual={marginEst}
            estimate={null}
            note={j.revenue ? `${num(((j.revenue - totalEst) / j.revenue) * 100, 1)}% · final when complete` : "Stock job"}
          />
        )}
        <VarianceCard label="Revenue" actual={j.revenue} estimate={null} note={`${num(j.quantity, 4)} × ${money(j.revenue != null ? j.revenue / j.quantity : null)}`} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-w-0 flex-col rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
          <div className="text-[15px] font-medium">{j.customerName ?? "Stock job"}</div>
          <div className="num mt-1 text-[28px] font-semibold leading-tight">{j.number}</div>
          <div className="mt-3">
            <div className="text-[11px] text-muted">Part</div>
            {j.itemId ? (
              <Link to={`/items/${j.itemId}`} className="text-[17px] font-medium hover:text-accent hover:underline">{j.part?.name ?? j.description}</Link>
            ) : (
              <div className="text-[17px] font-medium">{j.description}</div>
            )}
          </div>
          {j.part?.packSpec && (
            <Link to={`/packaging?item=${j.itemId}`} className="mt-3 block rounded-lg bg-panel-2 px-3 py-2 text-sm hover:ring-1 hover:ring-accent" title="Open the packing study">
              <div className="text-[11px] text-muted">Packing</div>
              <div>
                <b>{num(j.part.packSpec.perBox, 0)} per {j.part.packSpec.container.code}</b>, {num(j.part.packSpec.boxesPerPallet, 0)} per pallet
                <span className="text-muted"> · {num(Math.ceil(j.quantity / j.part.packSpec.perBox), 0)} {Math.ceil(j.quantity / j.part.packSpec.perBox) === 1 ? "container" : "containers"} for this job</span>
              </div>
            </Link>
          )}
          <div className="mt-4 space-y-3">
            <InsetField label="Status" tone={STATUS_TONE[j.status]}>
              <select
                className={cx(insetControl, "text-[17px] font-medium", j.status === "in_progress" && "text-ok")}
                value={j.status}
                disabled={!NEXT[j.status]?.length || move.isPending}
                onChange={(e) => move.mutate(e.target.value)}
              >
                {[j.status, ...(NEXT[j.status] ?? [])].map((s) => (
                  <option key={s} value={s}>{label(s)}</option>
                ))}
              </select>
            </InsetField>
            <InsetField label="Priority">
              <select className={insetControl} value={form.priority} onChange={set("priority")} disabled={!editable}>
                <option value="90">Urgent</option>
                <option value="70">High</option>
                <option value="50">Normal</option>
                <option value="30">Low</option>
                {!["90", "70", "50", "30"].includes(form.priority) && <option value={form.priority}>Custom ({form.priority})</option>}
              </select>
            </InsetField>
            <div className="grid grid-cols-2 gap-3">
              <InsetField label="Due" tone={late ? "bad" : undefined}>
                <input type="date" className={cx(insetControl, late && "text-bad")} value={form.dueDate} onChange={set("dueDate")} disabled={!editable} />
              </InsetField>
              <InsetField label="Quantity">
                <div className="num text-[15px]">
                  {num(j.quantity, 4)}
                  {j.quantityCompleted > 0 && <span className="text-xs text-muted"> · {num(j.quantityCompleted, 4)} done</span>}
                </div>
              </InsetField>
            </div>
            <InsetField label="Internal notes">
              <textarea rows={6} className={cx(insetControl, "resize-y text-sm leading-relaxed")} value={form.notes} onChange={set("notes")} disabled={!editable} placeholder="Repeat order, approvals, special handling…" />
            </InsetField>
          </div>
          <ErrorNote error={save.error} />
          <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-4">
            {dirty && (
              <>
                <Button onClick={() => setDirty(false)}>Discard</Button>
                <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button>
              </>
            )}
            <Button
              onClick={() => printLabel({ jobNumber: j.number, part: j.part ? `${j.part.partNumber} rev ${j.part.revision}` : j.description, name: j.part?.name ?? j.description, customer: j.customerName, quantity: j.quantity, dueDate: j.dueDate })}
              title="Print a label for the parts or bin"
            >
              <Printer className="h-4 w-4" /> Label
            </Button>
          </div>
        </section>

        <section className="min-w-0 rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 className="text-xl font-semibold">Details</h2>
            <PillTabs<Tab>
              tabs={[
                { key: "files", label: "Attachments", count: fileCount },
                { key: "log", label: "Log", count: j.log.length },
                { key: "scrap", label: "Scrap", count: scrapTotal || undefined },
                { key: "cost", label: "Cost" },
                { key: "quality", label: "Quality" },
                { key: "certs", label: "Report" },
              ]}
              value={tab}
              onChange={setTab}
            />
          </header>
          <div className="p-4">
            {tab === "files" && <FilesPanel entity="job" entityId={j.id} onCount={setFileCount} height={440} />}
            {tab === "cost" && (
              <Table head={["Op", "Work center", R("Est. hours"), R("Actual hours"), R("Est. cost"), R("Actual cost"), R("Difference")]}>
                {j.operations.map((o) => {
                  const estH = o.setupHours + o.runHoursPerUnit * j.quantity;
                  const diff = o.actualCost - o.estimatedCost;
                  return (
                    <tr key={o.id}>
                      <Td className="text-muted">{o.sequence}</Td>
                      <Td>{o.workCenterCode ?? "—"}</Td>
                      <Td right>{num(estH, 2)}</Td>
                      <Td right>{o.actualHours ? num(o.actualHours, 2) : "—"}</Td>
                      <Td right>{money(o.estimatedCost)}</Td>
                      <Td right>{o.actualCost ? money(o.actualCost) : "—"}</Td>
                      <Td right className={o.actualCost ? (diff > 0 ? "text-bad" : "text-ok") : "text-muted"}>{o.actualCost ? `${diff > 0 ? "+" : "−"}${money(Math.abs(diff))}` : "—"}</Td>
                    </tr>
                  );
                })}
              </Table>
            )}
            {tab === "scrap" && <ScrapView j={j} />}
            {tab === "quality" && <QualityTab jobId={j.id} itemId={j.itemId} />}
            {tab === "certs" && <ReportTab jobId={j.id} shop={me.data?.org.name ?? ""} customer={j.customerName} po={j.customerPo} />}
            {tab === "log" && (
              <ol className="space-y-3">
                {j.log.map((e) => (
                  <li key={e.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
                    <div>
                      <div>{(LOG_TEXT[e.action] ?? (() => e.action.replace(/_/g, " ")))(e.data)}</div>
                      <div className="text-xs text-muted">
                        {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                        {e.userName && ` · ${e.userName}`}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>

      <PieceJobs j={j} />
      <BomRouting j={j} />
    </>
  );
}

function ScrapView({ j }: { j: JobDetail }) {
  const reasons = j.log.filter((e) => Number(e.data.scrap) > 0);
  const made = j.operations.reduce((a, o) => a + o.quantityGood + o.quantityScrap, 0);
  const scrap = j.operations.reduce((a, o) => a + o.quantityScrap, 0);
  if (!scrap) return <p className="py-10 text-center text-sm text-muted">No scrap reported on this job.</p>;
  return (
    <div className="space-y-5">
      <Table head={["Op", "Work center", R("Good"), R("Scrap"), R("Scrap rate")]}>
        {j.operations.map((o) => (
          <tr key={o.id}>
            <Td className="text-muted">{o.sequence}</Td>
            <Td>{o.workCenterCode ?? "—"}</Td>
            <Td right>{num(o.quantityGood, 4)}</Td>
            <Td right className={o.quantityScrap ? "text-bad" : "text-muted"}>{num(o.quantityScrap, 4)}</Td>
            <Td right>{o.quantityGood + o.quantityScrap ? `${num((o.quantityScrap / (o.quantityGood + o.quantityScrap)) * 100, 1)}%` : "—"}</Td>
          </tr>
        ))}
      </Table>
      <div className="text-sm text-muted">
        {num(scrap, 4)} scrapped of {num(made, 4)} made across all operations.
      </div>
      {reasons.length > 0 && (
        <ol className="space-y-2">
          {reasons.map((e) => (
            <li key={e.id} className="text-sm">
              <span className="font-medium text-bad">{String(e.data.scrap)} scrap</span> on operation {String(e.data.operation)}
              {e.data.reason ? `: ${String(e.data.reason)}` : ""}
              <span className="text-xs text-muted"> · {new Date(e.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}{e.userName && ` · ${e.userName}`}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The jobs making this assembly's pieces: each with its own routing; assembly starts when all are done. */
function PieceJobs({ j }: { j: JobDetail }) {
  if (!j.children.length) return null;
  const done = j.children.filter((c) => ["complete", "closed"].includes(c.status)).length;
  const waiting = done < j.children.length;
  return (
    <section className="mt-5 min-w-0 overflow-hidden rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel-2/60 px-4 py-2.5">
        <h2 className="text-lg font-semibold">Pieces for this assembly</h2>
        <span className="text-sm text-muted">
          {done} of {j.children.length} finished
        </span>
        <span className={cx("ml-auto rounded-md px-2 py-0.5 text-xs font-medium", waiting ? "bg-warn-soft text-warn" : "bg-ok-soft text-ok")}>
          {waiting ? "Assembly waits until every piece is finished" : "All pieces ready: assembly can start"}
        </span>
      </header>
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
        {j.children.map((c) => {
          const pct = c.operationsTotal ? Math.round((c.operationsDone / c.operationsTotal) * 100) : 0;
          return (
            <Link key={c.id} to={`/jobs/${c.id}`} className="rounded-xl p-3 ring-1 ring-line transition hover:ring-2 hover:ring-accent">
              <div className="flex items-center justify-between gap-2">
                <span className="num font-semibold">{c.number}</span>
                <Status value={c.status} />
              </div>
              <div className="mt-0.5 line-clamp-2 text-sm text-muted">{c.description.replace(/ \(for [^)]+\)$/, "")}</div>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <span className="block h-full bg-ok" style={{ width: `${pct}%` }} />
                </span>
                <span className="num">
                  {c.operationsTotal ? `${c.operationsDone}/${c.operationsTotal} steps` : "No routing yet"}
                </span>
              </div>
              <div className="num mt-1 text-xs text-muted">
                {num(c.quantityCompleted, 4)} of {num(c.quantity, 4)} made{c.pieces ? ` · ${c.pieces} sub-pieces` : ""}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** The job's own copy of the part's bill of materials and routing, as a part card that expands. */
function BomRouting({ j }: { j: JobDetail }) {
  const [open, setOpen] = useState(true);
  const files = useQuery({ queryKey: ["files", "job", j.id], queryFn: () => api<FileRow[]>(`/files?entity=job&entityId=${j.id}`), refetchInterval: pollWhilePreparing });
  const model = (files.data ?? []).find((f) => f.kind === "cad" || f.kind === "mesh");
  const thumb = useThumb(model?.id);
  const est = j.costs.laborEstimate + j.costs.materialEstimate;
  // One-off quote lines become parts numbered after their quote (Q-1001-2), so they read as custom.
  const custom = !!j.part && /^Q-\d+-\d+$/.test(j.part.partNumber);
  const qc = useQueryClient();
  // A job keeps its own copy of the routing; this copies the part's current one (and makes piece jobs).
  const rebuild = useMutation({
    mutationFn: () => api<JobDetail>(`/jobs/${j.id}/rebuild`, "POST"),
    onSuccess: (d) => (qc.setQueryData(["job", j.id], d), qc.invalidateQueries({ queryKey: ["jobs"] })),
  });
  const canRebuild = !!j.itemId && ["planned", "released"].includes(j.status);
  return (
    <section className="mt-5 min-w-0 overflow-hidden rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel-2/60 px-4 py-2.5">
        <h2 className="text-lg font-semibold">Bill of materials &amp; routing</h2>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Read-only view
        </span>
        <span className="hidden text-sm text-muted lg:inline">This is the job's own copy; changing the part does not change it.</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => setOpen(false)}>
            <ChevronUp className="h-4 w-4" /> Collapse all
          </Button>
          <Button variant="ghost" onClick={() => setOpen(true)}>
            <ChevronDown className="h-4 w-4" /> Expand all
          </Button>
          {j.itemId && (
            <ButtonLink to={`/items/${j.itemId}`} variant="ghost">
              <Pencil className="h-4 w-4" /> Edit part routing
            </ButtonLink>
          )}
          {canRebuild && (
            <Button variant={j.operations.length ? "ghost" : "primary"} onClick={() => rebuild.mutate()} disabled={rebuild.isPending} title="Replace this job's steps and materials with the part's current routing and bill of materials">
              <RefreshCw className="h-4 w-4" /> Copy routing from the part
            </Button>
          )}
        </div>
      </header>
      <div className="p-4">
        {rebuild.error && <ErrorNote error={rebuild.error} />}
        {canRebuild && !j.operations.length && (
          <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            This job was made before its part had a routing. Add the steps on the part (Edit part routing), then click <b>Copy routing from the part</b>.
          </p>
        )}
        <div className="rounded-xl ring-1 ring-line">
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-4 p-3 text-left hover:bg-panel-2/50">
            <div className="flex h-24 w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel-2">
              {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Box className="h-8 w-8 text-muted" aria-hidden />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="num truncate text-xl font-semibold">{j.part ? j.part.partNumber : j.description}</div>
              <div className="truncate text-muted">{j.part?.name ?? j.description}</div>
              {j.part && (
                <span className={cx("mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", custom ? "bg-ok-soft text-ok" : "bg-accent-soft text-accent")}>
                  {custom ? "Custom" : (TYPE_LABEL[j.part.type] ?? label(j.part.type))}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Quantity", `${num(j.quantity, 4)} ${j.part?.uom ?? "ea"}`],
                ["Unit cost", money(j.quantity ? est / j.quantity : null)],
                ["Total cost", money(est)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-28 rounded-lg bg-panel-2 px-3 py-2 text-center">
                  <div className="text-xs text-muted">{k}</div>
                  <div className="num mt-0.5 text-lg font-semibold">{v}</div>
                </div>
              ))}
            </div>
            <ChevronDown className={cx("h-5 w-5 shrink-0 text-muted transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div className="space-y-5 border-t border-line p-3">
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold">Routing</h3>
                <Table head={["Op", "Work center", "Step", R("Hours"), R("Good / scrap"), "Progress", "Status", ""]} empty="This job has no operations.">
                  {j.operations.map((o) => {
                    const estH = o.setupHours + o.runHoursPerUnit * j.quantity;
                    const pct = o.status === "done" ? 100 : Math.min(99, Math.round((o.quantityGood / j.quantity) * 100));
                    return (
                      <tr key={o.id}>
                        <Td className="text-muted">{o.sequence}</Td>
                        <Td>
                          <div className="font-medium">{o.workCenterCode ?? "—"}</div>
                          <div className="text-xs text-muted">{o.workCenterName}</div>
                        </Td>
                        <Td className="min-w-48 whitespace-normal">{o.description ?? "—"}</Td>
                        <Td right>
                          {num(o.actualHours, 2)} <span className="text-muted">/ {num(estH, 2)}</span>
                        </Td>
                        <Td right>
                          {num(o.quantityGood, 4)}
                          {o.quantityScrap > 0 && <span className="text-bad"> / {num(o.quantityScrap, 4)}</span>}
                        </Td>
                        <Td>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-panel-2">
                              <div className={cx("h-full", o.status === "running" ? "bg-live" : o.status === "done" ? "bg-ok" : "bg-accent")} style={{ width: `${pct}%` }} />
                            </div>
                            <span className="num text-xs text-muted">{pct}%</span>
                          </div>
                        </Td>
                        <Td><Status value={o.status} /></Td>
                        <Td>
                          {(o.status === "ready" || o.status === "running") && ["released", "in_progress"].includes(j.status) && (
                            <Link to={`/floor/op/${o.id}`} className="text-sm font-medium text-accent hover:underline">Open</Link>
                          )}
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-sm font-semibold">Materials and services</h3>
                <Table head={["Item", R("Required"), R("Picked"), R("To pick"), R("Cost")]} empty="No materials.">
                  {j.materials.map((m) => {
                    const left = Math.max(0, m.quantityRequired - m.quantityIssued);
                    return (
                      <tr key={m.id}>
                        <Td className="min-w-48 whitespace-normal">
                          {m.description}
                          {m.kind === "service" && <div className="text-xs text-muted">Outside service</div>}
                        </Td>
                        <Td right>{num(m.quantityRequired, 4)}</Td>
                        <Td right>{num(m.quantityIssued, 4)}</Td>
                        <Td right className={left > 0 && m.kind === "material" && j.status !== "planned" ? "text-warn" : "text-muted"}>{num(left, 4)}</Td>
                        <Td right>
                          {money(m.quantityIssued * m.unitCost)} <span className="text-muted">/ {money(m.estimatedCost)}</span>
                        </Td>
                      </tr>
                    );
                  })}
                </Table>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
