/**
 * Operator screen: the part fills the screen; timers and the part count run along the top;
 * start/pause, counting, scrap and rework sit on the left; job details, material picking,
 * closing the operation and the job chat open on the right.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  Cog,
  Flag,
  Hand,
  Hourglass,
  MessageCircle,
  Newspaper,
  PersonStanding,
  Play,
  Plus,
  QrCode,
  Repeat,
  Scissors,
  Ruler,
  Search,
  Send,
  Timer,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, ApiError, type Me } from "../api.ts";
import { FilePreview, fileUrl, pollWhilePreparing, type FileRow } from "../components/Files.tsx";
import { balloonMarks, InspectPanel, nextPiece, openChecks, stepCharacteristics, useJobInspection } from "../components/InspectPanel.tsx";
import { Button, cx, ErrorNote, Field, Input, Loading, Modal, Select } from "../components/ui.tsx";
import { date, isPast, num } from "../format.ts";
import { printLabel } from "../printLabel.ts";
import { useThumb } from "../thumbs.ts";

const Drawing = lazy(() => import("../components/Drawing.tsx"));

type OpView = {
  operation: {
    id: string;
    sequence: number;
    description: string | null;
    status: string;
    setupHours: number;
    runHoursPerUnit: number;
    quantityGood: number;
    quantityScrap: number;
    quantityRework: number;
  };
  workCenter: { id: string; code: string; name: string } | null;
  job: { id: string; number: string; description: string; quantity: number; dueDate: string | null; status: string; notes: string | null };
  part: { partNumber: string; revision: string; name: string } | null;
  customerName: string | null;
  salesOrderNumber: string | null;
  customerPo: string | null;
  estimate: { setupSeconds: number; runSeconds: number };
  actual: { setupSeconds: number; runSeconds: number; laborSeconds: number; machineSeconds: number };
  openEntry: { id: string; kind: string; startedAt: string } | null;
  othersRunning: string[];
  entries: { id: string; kind: string; startedAt: string; endedAt: string | null; quantityGood: number; quantityScrap: number; userName: string }[];
  materials: {
    id: string;
    kind: string;
    itemId: string | null;
    description: string;
    quantityRequired: number;
    quantityIssued: number;
    lots: { id: string; lotNumber: string; location: string; dimensions: string | null; quantity: number; remnant: boolean }[];
  }[];
  route: { id: string; sequence: number; status: string; workCenterCode: string | null; description: string | null }[];
};
type Message = { id: string; kind: string; reason: string | null; body: string | null; attachmentId: string | null; attachmentName: string | null; createdAt: string; userId: string | null; userName: string | null };
type Mode = "setup" | "labor" | "run";
type Side = "details" | "pick" | "inspect" | "complete" | "chat";

const MODES: { key: Mode; label: string; icon: LucideIcon }[] = [
  { key: "setup", label: "Setup", icon: Timer },
  { key: "labor", label: "Labor", icon: PersonStanding },
  { key: "run", label: "Machine", icon: Cog },
];
const SCRAP_REASONS = ["Out of tolerance", "Setup piece", "Material defect", "Tool breakage", "Handling damage", "Wrong program", "Other"];
const REWORK_REASONS = ["Burrs or finish", "Dimension off, fixable", "Wrong bend or angle", "Missing feature", "Cosmetic damage", "Other"];
const ALERT_REASONS = ["Drawing or model issue", "Material problem", "Machine down", "Tooling problem", "Quality concern", "Need a supervisor"];

const clock = (s: number) => {
  const t = Math.max(0, Math.round(s));
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};
const initials = (name: string | null | undefined) =>
  (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
const card = "rounded-2xl bg-panel shadow-[0_2px_12px_rgba(23,34,48,0.08)] ring-1 ring-line/60";

export function OperatorPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/auth/me"), staleTime: Infinity });
  const v = useQuery({ queryKey: ["floor-op", id], queryFn: () => api<OpView>(`/floor/operations/${id}`), refetchInterval: 20_000 });
  const jobId = v.data?.job.id;
  const files = useQuery({
    queryKey: ["files", "job", jobId],
    queryFn: () => api<FileRow[]>(`/files?entity=job&entityId=${jobId}`),
    enabled: !!jobId,
    refetchInterval: pollWhilePreparing,
  });
  const [mode, setMode] = useState<Mode>("setup");
  const [step, setStep] = useState(1);
  const [side, setSide] = useState<Side | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [scrapOpen, setScrapOpen] = useState(false);
  const [reworkOpen, setReworkOpen] = useState(false);
  const insp = useJobInspection(jobId);
  const [piece, setPiece] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focusChar, setFocusChar] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (v.data?.openEntry) setMode(v.data.openEntry.kind as Mode);
    else if (v.data && v.data.actual.setupSeconds > 0) setMode("labor");
  }, [v.data?.openEntry?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (d?: OpView) => {
    if (d) qc.setQueryData(["floor-op", id], d);
    else qc.invalidateQueries({ queryKey: ["floor-op", id] });
    qc.invalidateQueries({ queryKey: ["job", jobId] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
    qc.invalidateQueries({ queryKey: ["floor-queue"] });
  };
  const start = useMutation({ mutationFn: () => api<OpView>(`/floor/operations/${id}/start`, "POST", { kind: mode }), onSuccess: refresh });
  const stop = useMutation({ mutationFn: () => api<OpView>(`/floor/operations/${id}/stop`, "POST", {}), onSuccess: refresh });
  const count = useMutation({
    mutationFn: (b: { quantityGood?: number; quantityScrap?: number; scrapReason?: string | null }) => api<OpView>(`/floor/operations/${id}/count`, "POST", b),
    onSuccess: refresh,
  });
  const rework = useMutation({ mutationFn: (b: { quantity: number; reason: string }) => api<OpView>(`/floor/operations/${id}/rework`, "POST", b), onSuccess: refresh });
  const pick = useMutation({ mutationFn: ({ mid, qty }: { mid: string; qty: number }) => api(`/floor/materials/${mid}/pick`, "POST", { quantity: qty }), onSuccess: () => refresh() });
  const complete = useMutation({
    mutationFn: () => api<{ nextOperationId: string | null; jobComplete: boolean }>(`/floor/operations/${id}/complete`, "POST", {}),
    onSuccess: () => {
      refresh();
      nav(v.data?.workCenter ? `/floor?wc=${v.data.workCenter.id}` : "/floor");
    },
  });

  const d = v.data;
  const fileList = files.data ?? [];
  const main = fileList.find((f) => f.id === fileId) ?? fileList.find((f) => f.kind === "cad" || f.kind === "mesh") ?? fileList[0];
  if (v.error) return <div className="p-6"><ErrorNote error={v.error} /></div>;
  if (!d) return <Loading />;

  const running = !!d.openEntry;
  // Between refreshes the clocks keep counting from what the server last reported.
  const drift = d.openEntry ? Math.max(0, (now - v.dataUpdatedAt) / 1000) : 0;
  const setupSecs = d.actual.setupSeconds + (d.openEntry?.kind === "setup" ? drift : 0);
  const laborSecs = d.actual.laborSeconds + (d.openEntry?.kind === "labor" ? drift : 0);
  const machineSecs = d.actual.machineSeconds + (d.openEntry?.kind === "run" ? drift : 0);
  const canWork = ["released", "in_progress"].includes(d.job.status) && ["ready", "running"].includes(d.operation.status);
  const hasWork = d.actual.setupSeconds + d.actual.runSeconds > 0 || d.operation.quantityGood > 0 || running;
  const busy = start.isPending || stop.isPending || count.isPending;
  const toggle = (s: Side) => setSide(side === s ? null : s);
  const wcLink = d.workCenter ? `/floor?wc=${d.workCenter.id}` : "/floor";
  const stepChars = stepCharacteristics(insp.data, d.operation.sequence);
  const results = insp.data?.results ?? [];
  const curPiece = piece ?? nextPiece(stepChars, results);
  const canRecord = ["released", "in_progress", "complete"].includes(d.job.status) && d.operation.status !== "pending";
  // While inspecting, the drawing the balloons sit on fills the screen.
  const focusC = stepChars.find((c) => c.id === focusChar) ?? stepChars.find((c) => c.attachmentId);
  const sheet = side === "inspect" && focusC?.attachmentId ? fileList.find((f) => f.id === focusC.attachmentId) : undefined;

  return (
    <div className="relative h-dvh min-h-[600px] overflow-hidden bg-[#eceef1] text-ink">
      {/* The part fills the screen. */}
      <div className="absolute inset-0">
        {sheet && focusC ? (
          <div className={cx("h-full pb-4 pl-[258px] pt-[124px]", expanded ? "pr-4" : "pr-[512px]")}>
            <Suspense fallback={<Loading />}>
              <Drawing
                file={sheet}
                page={focusC.page}
                balloons={balloonMarks(stepChars, results, curPiece, sheet.id, focusC.page, focusChar)}
                onBalloon={setFocusChar}
                className="h-full"
              />
            </Suspense>
          </div>
        ) : main ? (
          <FilePreview key={main.id} file={main} immersive />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            No drawing or 3D model on this job.{" "}
            <Link to={`/jobs/${d.job.id}`} className="ml-1 font-medium text-accent hover:underline">Add files on the job</Link>
          </div>
        )}
      </div>

      {/* Top: who and what, the timers, and the side panels */}
      <div className="pointer-events-none absolute inset-x-4 top-4 flex flex-wrap items-start gap-3">
        <Link to={wcLink} title={`Back to the ${d.workCenter?.code ?? ""} queue`} className={cx(card, "pointer-events-auto flex h-[92px] w-[92px] items-center justify-center")}>
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-xl font-semibold text-accent-ink">{initials(me.data?.user.name)}</span>
        </Link>
        <div className={cx(card, "pointer-events-auto flex h-[92px] min-w-56 flex-col justify-center px-4 leading-snug")}>
          <Link to={`/jobs/${d.job.id}`} className="text-xl hover:text-accent">Job {d.job.number}</Link>
          <div className="text-xl">Item {d.part?.partNumber ?? "—"}</div>
          <div className="text-xl font-semibold">{d.workCenter ? `${d.workCenter.code} ${d.workCenter.name}` : `Op ${d.operation.sequence}`}</div>
        </div>
        <div className="pointer-events-auto mx-auto flex w-full max-w-[440px] flex-col gap-1.5 lg:w-auto lg:flex-1">
          <Meter icon={Timer} label="Setup time" value={setupSecs} total={d.estimate.setupSeconds} />
          <Meter icon={PersonStanding} label="Run time" value={laborSecs + machineSecs} total={d.estimate.runSeconds} />
          <Meter label="Parts done" value={d.operation.quantityGood} total={d.job.quantity} qty />
        </div>
        <nav className={cx(card, "pointer-events-auto ml-auto flex gap-0.5 p-1.5")} aria-label="Panels">
          <MenuButton icon={Newspaper} label="Details" active={side === "details"} onClick={() => toggle("details")} />
          <MenuButton icon={Hand} label="Pick" active={side === "pick"} onClick={() => toggle("pick")} />
          <MenuButton icon={Ruler} label="Inspect" active={side === "inspect"} onClick={() => toggle("inspect")} badge={openChecks(stepChars, results, d.operation.quantityGood)} />
          <MenuButton icon={CheckCircle2} label="Complete" active={side === "complete"} onClick={() => toggle("complete")} />
          <ChatButton jobId={d.job.id} active={side === "chat"} onClick={() => toggle("chat")} />
        </nav>
      </div>

      {/* Left: run the work */}
      <aside className={cx(card, "absolute left-4 top-[124px] z-10 flex max-h-[calc(100%-140px)] w-[226px] flex-col gap-3 overflow-y-auto bg-[#f4f5f7]/95 p-3 backdrop-blur")}>
        <div className="grid grid-cols-3 gap-2">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              disabled={running}
              onClick={() => setMode(m.key)}
              aria-pressed={mode === m.key}
              className={cx(
                "flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium shadow-[0_2px_8px_rgba(23,34,48,0.08)] transition",
                mode === m.key ? "bg-[#23272e] text-white" : "bg-panel text-ink hover:ring-2 hover:ring-accent",
                running && mode !== m.key && "opacity-40",
              )}
            >
              <m.icon className="h-5 w-5" />
              {m.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={!canWork || busy}
          onClick={() => (running ? stop.mutate() : start.mutate())}
          aria-label={running ? "Pause" : `Start ${MODES.find((m) => m.key === mode)!.label.toLowerCase()}`}
          className={cx(
            "mx-auto my-2 flex aspect-square w-[148px] items-center justify-center rounded-full shadow-[0_10px_28px_rgba(0,0,0,0.16)] transition active:scale-95 disabled:opacity-40",
            running ? "bg-panel ring-[3px] ring-panel" : "bg-gradient-to-b from-[#7ee052] to-[#4fbd2a] text-white ring-[10px] ring-panel",
          )}
        >
          {running ? (
            <span className="flex gap-4" aria-hidden>
              <span className="h-[68px] w-[22px] rounded-md bg-gradient-to-b from-[#ffa13d] to-[#f07c12]" />
              <span className="h-[68px] w-[22px] rounded-md bg-gradient-to-b from-[#ffa13d] to-[#f07c12]" />
            </span>
          ) : (
            <Play className="h-16 w-16 translate-x-1 fill-current" />
          )}
        </button>
        {running && <div className="num -mt-2 text-center text-sm text-muted">{clock((now - new Date(d.openEntry!.startedAt).getTime()) / 1000)} this session</div>}
        {d.othersRunning.length > 0 && <p className="text-center text-xs text-muted">Also working: {d.othersRunning.join(", ")}</p>}

        <div className="flex items-center gap-1.5">
          <RoundButton label="Count fewer at a time" onClick={() => setStep(Math.max(1, step - 1))}><ArrowDown className="h-5 w-5" /></RoundButton>
          <input
            type="number"
            min={1}
            value={step}
            aria-label="Parts to add with the plus button"
            onChange={(e) => setStep(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
            className="num h-12 w-full min-w-0 rounded-2xl bg-panel text-center text-xl font-semibold shadow-[0_2px_8px_rgba(23,34,48,0.08)] outline-none focus:ring-2 focus:ring-accent"
          />
          <RoundButton label="Count more at a time" onClick={() => setStep(step + 1)}><ArrowUp className="h-5 w-5" /></RoundButton>
        </div>
        <SideButton onClick={() => count.mutate({ quantityGood: step })} disabled={!canWork || busy} label={`Add ${step} good part${step === 1 ? "" : "s"}`} tall>
          <Plus className="h-8 w-8 text-[#2f6fe4]" />
        </SideButton>
        <SideButton
          onClick={() =>
            printLabel({
              jobNumber: d.job.number,
              part: d.part ? `${d.part.partNumber} rev ${d.part.revision}` : d.job.description,
              name: d.part?.name ?? d.job.description,
              customer: d.customerName,
              quantity: d.job.quantity,
              dueDate: d.job.dueDate,
              operation: `Op ${d.operation.sequence} ${d.workCenter?.code ?? ""}`,
            })
          }
        >
          <QrCode className="h-5 w-5" /> Label
        </SideButton>
        <SideButton onClick={() => setScrapOpen(true)} disabled={!canWork}>
          <Trash2 className="h-5 w-5" /> Scrap
        </SideButton>
        <SideButton onClick={() => setReworkOpen(true)} disabled={!canWork} className="text-[#e5481b]">
          <Repeat className="h-5 w-5" /> Rework
        </SideButton>
        <ErrorNote error={start.error ?? stop.error ?? count.error} />
        {!canWork && (
          <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">
            {d.operation.status === "done" ? "This operation is complete." : d.operation.status === "pending" ? "Waiting for the previous operation." : "This job is not released to the shop yet."}
          </p>
        )}
      </aside>

      {/* Right: the open panel */}
      {side && (
        <aside className={cx("absolute bottom-24 right-4 top-[124px] z-20 flex max-w-[calc(100%-2rem)] flex-col", side === "inspect" && expanded ? "w-[880px]" : "w-[480px]")}>
          <div className={cx(card, "flex min-h-0 flex-1 flex-col overflow-hidden bg-[#f4f5f7]")}>
            {side === "details" && <DetailsPanel d={d} onOpen={(opId) => nav(`/floor/op/${opId}`)} />}
            {side === "pick" && <PickPanel d={d} busy={pick.isPending} onPick={(mid, qty) => pick.mutate({ mid, qty })} error={pick.error} onClose={() => setSide(null)} />}
            {side === "inspect" &&
              (insp.data ? (
                <InspectPanel
                  insp={insp.data}
                  chars={stepChars}
                  piece={curPiece}
                  onPiece={setPiece}
                  expanded={expanded}
                  onExpand={setExpanded}
                  canRecord={canRecord}
                  focus={focusChar}
                  onFocus={setFocusChar}
                />
              ) : (
                <Loading />
              ))}
            {side === "complete" && (
              <CompletePanel d={d} setupSecs={setupSecs} laborSecs={laborSecs} machineSecs={machineSecs} canClose={canWork && hasWork} busy={complete.isPending} error={complete.error} onClose={() => complete.mutate()} />
            )}
            {side === "chat" && me.data && <ChatPanel jobId={d.job.id} me={me.data} />}
          </div>
        </aside>
      )}

      {/* Bottom right: the job's other drawings and models */}
      {fileList.length > 1 && (
        <div className="absolute bottom-4 right-4 z-10 flex gap-2">
          {fileList
            .filter((f) => f.id !== main?.id)
            .slice(0, 4)
            .map((f) => (
              <FileTile key={f.id} file={f} onClick={() => setFileId(f.id)} />
            ))}
        </div>
      )}

      <ScrapModal
        open={scrapOpen}
        onClose={() => setScrapOpen(false)}
        busy={count.isPending}
        onSave={(qty, reason) => count.mutate({ quantityScrap: qty, scrapReason: reason }, { onSuccess: () => setScrapOpen(false) })}
        error={count.error}
      />
      <ReworkModal open={reworkOpen} onClose={() => setReworkOpen(false)} busy={rework.isPending} onSave={(quantity, reason) => rework.mutate({ quantity, reason }, { onSuccess: () => setReworkOpen(false) })} error={rework.error} />
    </div>
  );
}

// ── Top bar pieces ──────────────────────────────────────────────────────────

/** A progress pill: green while within plan, orange once past it. */
function Meter({ icon: Icon, label, value, total, qty = false }: { icon?: LucideIcon; label: string; value: number; total: number; qty?: boolean }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const over = !qty && pct > 100;
  const started = value > 0;
  return (
    <div className="flex items-center gap-2" title={label}>
      <span className="flex w-6 justify-center text-ink">{Icon ? <Icon className="h-5 w-5" aria-hidden /> : null}</span>
      <div className={cx("relative h-[30px] flex-1 overflow-hidden rounded-full bg-panel ring-2", over ? "ring-[#f0a35e]" : started ? "ring-[#8fdc6a]" : "ring-[#cfd4da]")}>
        {started && (
          <div
            className={cx("absolute inset-y-0 left-0 rounded-full transition-[width] duration-700", over ? "bg-gradient-to-r from-[#ffd29a] to-[#f0821e]" : "bg-gradient-to-r from-[#5fcf3a] via-[#9be27a] to-[#d9f5c8]")}
            style={{ width: `max(30px, ${Math.min(100, pct)}%)` }}
          />
        )}
        <div className="num relative flex h-full items-center justify-between px-3 text-sm">
          <span>
            <span className="sr-only">{label}: </span>
            {qty ? `${num(value, 4)} / ${num(total, 4)}` : `${clock(value)} / ${clock(total)}`}
          </span>
          <span className={cx(over && "font-semibold")}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

function MenuButton({ icon: Icon, label, active, onClick, badge }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx("relative flex min-w-[82px] flex-col items-center gap-1 rounded-2xl px-3 py-3 text-[15px] transition", active ? "bg-[#23272e] text-white" : "hover:bg-panel-2")}
    >
      <Icon className="h-5 w-5" />
      {label}
      {active && <span aria-hidden className="absolute -bottom-[7px] left-1/2 h-0 w-0 -translate-x-1/2 border-x-8 border-t-8 border-x-transparent border-t-[#23272e]" />}
      {!!badge && <span className="num absolute -right-1 -top-1 min-w-5 rounded-full bg-bad px-1 text-[11px] font-semibold leading-5 text-white">{badge}</span>}
    </button>
  );
}

/** Chat button with the number of messages since this person last opened the chat. */
function ChatButton({ jobId, active, onClick }: { jobId: string; active: boolean; onClick: () => void }) {
  const msgs = useQuery({ queryKey: ["job-messages", jobId], queryFn: () => api<Message[]>(`/jobs/${jobId}/messages`), refetchInterval: active ? 4000 : 20_000 });
  const seenKey = `ironline-chat-seen:${jobId}`;
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(seenKey) ?? "";
    } catch {
      return "";
    }
  });
  const last = msgs.data?.at(-1)?.createdAt ?? "";
  useEffect(() => {
    if (!active || !last) return;
    setSeen(last);
    try {
      localStorage.setItem(seenKey, last);
    } catch {
      /* per-browser nicety only */
    }
  }, [active, last, seenKey]);
  const unread = active ? 0 : (msgs.data ?? []).filter((m) => m.createdAt > seen).length;
  return <MenuButton icon={MessageCircle} label="Chat" active={active} onClick={onClick} badge={unread} />;
}

// ── Left panel pieces ───────────────────────────────────────────────────────

function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-panel shadow-[0_2px_8px_rgba(23,34,48,0.08)] hover:ring-2 hover:ring-accent">
      {children}
    </button>
  );
}

function SideButton({ children, onClick, disabled, label, tall, className }: { children: ReactNode; onClick: () => void; disabled?: boolean; label?: string; tall?: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "flex w-full items-center justify-center gap-2 rounded-2xl bg-panel text-lg font-medium shadow-[0_2px_8px_rgba(23,34,48,0.08)] transition hover:ring-2 hover:ring-accent active:scale-[0.98] disabled:opacity-40",
        tall ? "h-[70px]" : "h-[56px]",
        className,
      )}
    >
      {children}
    </button>
  );
}

function FileTile({ file, onClick }: { file: FileRow; onClick: () => void }) {
  const snap = useThumb(file.kind === "cad" || file.kind === "mesh" ? file.id : undefined);
  const img = file.kind === "image" ? fileUrl(file.id) : snap;
  return (
    <button type="button" onClick={onClick} title={`Show ${file.fileName}`} className={cx(card, "flex h-[88px] w-[88px] flex-col items-center justify-center overflow-hidden p-1 hover:ring-2 hover:ring-accent")}>
      {img ? <img src={img} alt="" className="h-full w-full rounded-lg object-cover" /> : <span className="px-1 text-center text-[11px] font-medium leading-tight text-muted">{file.fileName}</span>}
    </button>
  );
}

function ScrapModal({ open, onClose, onSave, busy, error }: { open: boolean; onClose: () => void; onSave: (qty: number, reason: string) => void; busy: boolean; error: unknown }) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) (setQty(1), setReason(""));
  }, [open]);
  return (
    <Modal open={open} title="Record scrap" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), onSave(qty, reason))} className="space-y-4">
        <Field label="Scrapped parts">
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} autoFocus className="num text-lg" />
        </Field>
        <Field label="Reason">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Choose a reason…</option>
            {SCRAP_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy || !reason}>Record {qty} scrap</Button>
        </div>
      </form>
    </Modal>
  );
}

function ReworkModal({ open, onClose, onSave, busy, error }: { open: boolean; onClose: () => void; onSave: (qty: number, reason: string) => void; busy: boolean; error: unknown }) {
  const [qty, setQty] = useState(1);
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) (setQty(1), setReason(""));
  }, [open]);
  return (
    <Modal open={open} title="Send parts to rework" onClose={onClose}>
      <form onSubmit={(e) => (e.preventDefault(), onSave(qty, reason))} className="space-y-4">
        <Field label="Parts to rework">
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value)))} autoFocus className="num text-lg" />
        </Field>
        <Field label="What needs fixing">
          <Select value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Choose a reason…</option>
            {REWORK_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <p className="text-xs text-muted">Reworked parts are counted separately; add them as good parts once they are fixed.</p>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy || !reason}>Send {qty} to rework</Button>
        </div>
      </form>
    </Modal>
  );
}

// ── Right panels ────────────────────────────────────────────────────────────

function Section({ title, children, right }: { title?: ReactNode; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-panel p-4 shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
      {title && (
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <h3 className="text-[15px] font-semibold uppercase tracking-wide">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

function DetailsPanel({ d, onOpen }: { d: OpView; onOpen: (opId: string) => void }) {
  const [routeOpen, setRouteOpen] = useState(true);
  const late = isPast(d.job.dueDate);
  return (
    <div className="space-y-3 overflow-y-auto p-3">
      <section className="overflow-hidden rounded-2xl bg-panel shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
        <div className="flex items-start justify-between gap-3 p-4">
          <div className="min-w-0">
            <div className="num truncate text-[26px] font-semibold leading-tight">{d.part?.partNumber ?? d.job.number}</div>
            <div className="truncate text-lg text-muted">{d.part?.name ?? d.job.description}</div>
          </div>
          {d.customerName && <div className="line-clamp-2 max-w-[50%] text-right text-xl font-extrabold italic leading-tight tracking-tight">{d.customerName}</div>}
        </div>
        <div className="grid grid-cols-2 gap-y-1 border-t border-line px-4 py-3 text-[17px]">
          <span className="font-medium">{d.customerName ?? "Stock job"}</span>
          <span className="text-right">{d.salesOrderNumber ? `SO ${d.salesOrderNumber}` : ""}</span>
          <span className={cx(late && "font-semibold text-bad")}>Due {date(d.job.dueDate)}</span>
          <span className="text-right">{d.customerPo ? `PO ${d.customerPo}` : ""}</span>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
          <span className="num text-[17px] font-semibold">{num(d.job.quantity, 4)} pieces</span>
          {d.workCenter && (
            <span className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm ring-1 ring-line">
              {d.workCenter.code} {d.workCenter.name}
              <ChevronDown className="h-4 w-4 text-muted" aria-hidden />
            </span>
          )}
        </div>
      </section>
      <Section title={`${d.workCenter?.name ?? "Operation"} instructions`}>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{d.operation.description || "No instructions for this step."}</p>
      </Section>
      {d.job.notes && (
        <Section title="Job notes">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{d.job.notes}</p>
        </Section>
      )}
      <section className="overflow-hidden rounded-2xl bg-panel shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
        <button type="button" onClick={() => setRouteOpen(!routeOpen)} aria-expanded={routeOpen} className="flex w-full items-center justify-between gap-2 border-b border-line px-4 py-3.5 text-left">
          <span className="text-xl font-semibold">
            Item routing <span className="text-sm font-normal text-muted">{d.route.length} steps</span>
          </span>
          <ChevronDown className={cx("h-5 w-5 transition-transform", routeOpen && "rotate-180")} aria-hidden />
        </button>
        {routeOpen && (
          <ol className="relative space-y-2 px-4 py-3">
            <span aria-hidden className="absolute bottom-6 left-[34px] top-6 border-l-2 border-line" />
            {d.route.map((r) => {
              const current = r.id === d.operation.id;
              const done = r.status === "done";
              const Icon = done ? Check : current ? Flag : Hourglass;
              return (
                <li key={r.id} className="relative">
                  <button
                    type="button"
                    disabled={current}
                    onClick={() => onOpen(r.id)}
                    className={cx(
                      "flex items-center gap-2.5 rounded-full bg-panel pr-4 text-left ring-1",
                      current ? "w-full py-2 pl-1.5 text-lg font-semibold ring-2 ring-ink" : "py-1 pl-1 text-[15px] ring-line hover:ring-accent",
                    )}
                  >
                    <span className={cx("flex shrink-0 items-center justify-center rounded-full", current ? "h-10 w-10 bg-[#8fd3ff] text-ink" : "h-7 w-7", done ? "bg-ok text-white" : !current && "bg-panel-2 text-muted")}>
                      <Icon className={current ? "h-5 w-5" : "h-4 w-4"} />
                    </span>
                    <span className="num text-sm text-muted">{r.sequence / 10}</span>
                    <span className="truncate">{r.description || r.workCenterCode}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="overflow-hidden rounded-2xl bg-panel shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
        <div className="grid grid-cols-4 gap-2 border-b border-line px-4 py-2 text-xs text-muted">
          <span>NCR #</span>
          <span>Status</span>
          <span>Date created</span>
          <span className="text-right">Created by</span>
        </div>
        <div className="p-3">
          <button type="button" disabled title="Non-conformance reports are not built yet" className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#e3f3fd] py-3 text-lg text-[#1a73c9] disabled:cursor-not-allowed">
            <Plus className="h-5 w-5" /> Non-conformance report
          </button>
          <p className="mt-1.5 text-center text-xs text-muted">Not built yet. For now, record the reading under Inspect and send a Quality concern alert from Chat.</p>
        </div>
      </section>
    </div>
  );
}

function PickPanel({ d, onPick, busy, error, onClose }: { d: OpView; onPick: (mid: string, qty: number) => void; busy: boolean; error: unknown; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const list = d.materials.filter((m) => !q || m.description.toLowerCase().includes(q.toLowerCase()));
  const tool = "flex h-12 w-12 items-center justify-center rounded-xl bg-panel ring-1 ring-ink/70 hover:bg-panel-2";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 px-4 pt-4">
        <button type="button" className={tool} aria-label="Search materials" onClick={() => setSearching(!searching)}><Search className="h-6 w-6" /></button>
        <button type="button" className={cx(tool, "opacity-40")} disabled title="Adding materials from the floor comes with the Inventory module" aria-label="Add a material"><Plus className="h-6 w-6" /></button>
        <button type="button" className={cx(tool, "opacity-40")} disabled title="Scanning bin labels comes with the Inventory module" aria-label="Scan a label"><QrCode className="h-6 w-6" /></button>
        <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-12 w-12 items-center justify-center rounded-xl bg-[#111] text-white">
          <X className="h-6 w-6" />
        </button>
      </div>
      {searching && (
        <div className="px-4 pt-3">
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a material" aria-label="Find a material" />
        </div>
      )}
      <h2 className="px-5 pb-2 pt-5 text-2xl font-semibold">Materials list</h2>
      <div className="space-y-3 overflow-y-auto px-3 pb-3">
        {!list.length && <Section><p className="text-sm text-muted">{d.materials.length ? "No material matches." : "No materials on this job."}</p></Section>}
        {list.map((m) => (
          <PickCard key={m.id} m={m} busy={busy} onPick={(qty) => onPick(m.id, qty)} />
        ))}
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

function PickCard({ m, onPick, busy }: { m: OpView["materials"][number]; onPick: (q: number) => void; busy: boolean }) {
  const left = Math.max(0, Math.round((m.quantityRequired - m.quantityIssued) * 10000) / 10000);
  const [qty, setQty] = useState(String(left || ""));
  const [open, setOpen] = useState(true);
  const [remnant, setRemnant] = useState(false);
  useEffect(() => setQty(String(left || "")), [left]);
  const done = m.quantityIssued >= m.quantityRequired;
  return (
    <section className="rounded-2xl bg-panel p-4 shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 text-xl font-semibold leading-snug">{m.description}</div>
        <div className="shrink-0 text-right">
          <div className="num flex items-center justify-end gap-1.5 text-3xl font-semibold">
            {done && <Check className="h-6 w-6 text-ok" strokeWidth={3} />}
            {num(m.quantityIssued, 4)}
          </div>
          <div className="num text-sm text-muted">of {num(m.quantityRequired, 4)} picked</div>
        </div>
      </div>
      {m.kind === "material" ? (
        <>
          <div className="mt-4 rounded-xl ring-1 ring-line">
            <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between px-4 py-2.5 text-[15px] text-muted">
              <span className="flex items-center gap-2">
                <ChevronDown className={cx("h-4 w-4 transition-transform", !open && "-rotate-90")} aria-hidden /> Locations
              </span>
              <span className="flex gap-10">
                <span>On hand</span>
                <span>Picked</span>
              </span>
            </button>
            {open && (
              <div className="space-y-1.5 px-2 pb-2">
                {m.lots.length ? (
                  m.lots.map((l, k) => (
                    <div key={l.id} className={cx("flex items-center justify-between rounded-xl px-3 py-2.5 ring-1", k === 0 ? "bg-[#eaf2ff] ring-[#b9d1fb]" : "bg-panel ring-line")}>
                      <span className="flex min-w-0 items-center gap-3">
                        <span className={cx("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2", k === 0 ? "border-[#2f6fe4]" : "border-line")}>{k === 0 && <span className="h-3 w-3 rounded-full bg-[#2f6fe4]" />}</span>
                        <span className="min-w-0">
                          <span className="block text-lg leading-tight">{l.location}</span>
                          <span className="num block truncate text-xs text-muted">
                            {l.lotNumber}
                            {l.dimensions ? ` · ${l.dimensions}` : ""}
                            {l.remnant ? " · remnant" : ""}
                          </span>
                        </span>
                      </span>
                      <span className="num text-lg">{num(l.quantity, 4)}</span>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-between rounded-xl bg-panel-2 px-3 py-3 ring-1 ring-line">
                    <span className="text-lg">No stock recorded</span>
                    <span className="text-sm text-muted">Picks are logged as untracked</span>
                  </div>
                )}
                <p className="flex items-center justify-between px-2 pt-1 text-xs text-muted">
                  <span>{m.lots.length ? "Picking takes the oldest lot first." : "Receive this material under Inventory to track it."}</span>
                  {m.itemId && m.quantityIssued > 0 && (
                    <button type="button" onClick={() => setRemnant(true)} className="flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent hover:bg-accent hover:text-white" title="Put an off-cut back on the shelf">
                      <Scissors className="h-3.5 w-3.5" /> Save remnant
                    </button>
                  )}
                </p>
              </div>
            )}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button type="button" onClick={() => setQty(String(left || ""))} className="px-2 text-lg text-muted hover:text-ink">Reset</button>

            <Button className="ml-auto h-14 px-5" disabled={busy || !(Number(qty) > 0) || m.quantityIssued <= 0} onClick={() => onPick(-Number(qty))}>Return</Button>
            <input
              type="number"
              min={0}
              step="any"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              aria-label={`Quantity of ${m.description}`}
              className="num h-14 w-28 rounded-xl bg-panel text-center text-2xl outline-none ring-2 ring-[#2f6fe4]"
            />
            <Button variant="primary" className="h-14 px-5 text-base" disabled={busy || !(Number(qty) > 0)} onClick={() => onPick(Number(qty))}>Pick</Button>
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-muted">Outside service, handled by purchasing</div>
      )}
      {remnant && <RemnantModal m={m} onClose={() => setRemnant(false)} />}
    </section>
  );
}

function CompletePanel({ d, setupSecs, laborSecs, machineSecs, canClose, busy, error, onClose }: { d: OpView; setupSecs: number; laborSecs: number; machineSecs: number; canClose: boolean; busy: boolean; error: unknown; onClose: () => void }) {
  const mats = d.materials.filter((m) => m.kind === "material");
  const req = mats.reduce((a, m) => a + m.quantityRequired, 0);
  const picked = mats.reduce((a, m) => a + Math.min(m.quantityIssued, m.quantityRequired), 0);
  const setupPct = d.estimate.setupSeconds ? Math.round((setupSecs / d.estimate.setupSeconds) * 100) : null;
  const runPct = d.estimate.runSeconds ? Math.round(((laborSecs + machineSecs) / d.estimate.runSeconds) * 100) : null;
  const idx = d.route.findIndex((r) => r.id === d.operation.id);
  const next = d.route.slice(idx + 1).find((r) => r.status !== "done");
  const Over = ({ pct }: { pct: number | null }) => (pct != null && pct > 100 ? <span className="num rounded-full px-1.5 text-[11px] font-medium text-[#c25e00] ring-1 ring-[#f0a35e]">↑ {pct}%</span> : null);
  const Row = ({ label, value, blue, badge }: { label: string; value: ReactNode; blue?: boolean; badge?: ReactNode }) => (
    <div className="flex items-center gap-3 py-1.5">
      <span className="flex shrink-0 items-center gap-2 text-lg font-semibold">
        {label} {badge}
      </span>
      <span aria-hidden className="h-0 flex-1 border-b-2 border-dotted border-line" />
      <span className={cx("num min-w-[150px] rounded-xl px-3 py-2.5 text-center text-lg", blue ? "bg-[#eaf4fd] text-[#1a73c9] ring-1 ring-[#b9daf5]" : "bg-panel-2")}>{value}</span>
    </div>
  );
  return (
    <div className="space-y-3 overflow-y-auto p-3">
      <Section>
        <Row label="Total to complete" value={num(d.job.quantity, 4)} />
        <Row label="Quantity completed" value={`${num(d.operation.quantityGood, 4)} / ${num(d.job.quantity, 4)}`} blue />
      </Section>
      <Section>
        <Row label="Picking" value={req ? `${Math.round((picked / req) * 100)}%` : "—"} blue />
      </Section>
      <Section>
        <Row label="Rework" value={num(d.operation.quantityRework, 4)} />
        <Row label="Scrap" value={num(d.operation.quantityScrap, 4)} />
      </Section>
      <Section>
        <Row label="Setup" value={clock(setupSecs)} blue badge={<Over pct={setupPct} />} />
        <Row label="Labor" value={clock(laborSecs)} blue badge={<Over pct={runPct} />} />
        <Row label="Machine" value={clock(machineSecs)} blue />
      </Section>
      <ErrorNote error={error} />
      <button
        type="button"
        disabled={!canClose || busy}
        onClick={onClose}
        title={canClose ? undefined : "Log time or parts first"}
        className="h-14 w-full rounded-2xl bg-[#1f7ae0] text-lg font-semibold uppercase tracking-wide text-white shadow-sm transition hover:brightness-110 disabled:opacity-40"
      >
        Close operation
      </button>
      <section className="flex items-center justify-between gap-2 rounded-2xl bg-panel px-4 py-3 shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
        <span className="text-sm">Next operation:</span>
        {next ? <span className="rounded-xl bg-[#23272e] px-4 py-2 text-sm font-medium text-white">{next.description || next.workCenterCode}</span> : <span className="font-medium">Last step: the job completes</span>}
      </section>
    </div>
  );
}

function ChatPanel({ jobId, me }: { jobId: string; me: Me }) {
  const qc = useQueryClient();
  const key = ["job-messages", jobId];
  const msgs = useQuery({ queryKey: key, queryFn: () => api<Message[]>(`/jobs/${jobId}/messages`), refetchInterval: 4000 });
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const photo = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const send = useMutation({
    mutationFn: (b: { kind?: string; body?: string; reason?: string; attachmentId?: string }) => api<Message>(`/jobs/${jobId}/messages`, "POST", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`/api/v1/files?entity=job&entityId=${jobId}`, { method: "POST", body, credentials: "same-origin" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, data?.error?.message ?? "The photo could not be uploaded");
      await api(`/jobs/${jobId}/messages`, "POST", { attachmentId: data.id, body: text.trim() || null });
    },
    onSuccess: () => (setText(""), qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ["files", "job", jobId] })),
  });
  const data = msgs.data ?? [];
  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [data.length]);
  const days = useMemo(() => {
    const out: { day: string; items: Message[] }[] = [];
    for (const m of data) {
      const day = new Date(m.createdAt).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
      if (out.at(-1)?.day !== day) out.push({ day, items: [] });
      out.at(-1)!.items.push(m);
    }
    return out;
  }, [data]);
  const submit = () => {
    const body = text.trim();
    if (!body) return photo.current?.click();
    send.mutate({ body }, { onSuccess: () => setText("") });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <Section>
        <div className="flex items-center gap-2">
          <span className="mr-auto shrink-0 text-lg font-semibold">Send an alert</span>
          <Select value={reason} onChange={(e) => setReason(e.target.value)} className="h-12 w-auto! min-w-0 flex-1 sm:max-w-48" aria-label="Alert reason">
            <option value="">Select reason</option>
            {ALERT_REASONS.map((r) => <option key={r}>{r}</option>)}
          </Select>
          <Button className="h-12 shrink-0 px-4" disabled={!reason || send.isPending} onClick={() => send.mutate({ kind: "alert", reason }, { onSuccess: () => setReason("") })}>Send alert</Button>
        </div>
      </Section>
      <section className="flex min-h-0 flex-1 flex-col rounded-2xl bg-panel shadow-[0_2px_10px_rgba(23,34,48,0.07)]">
        <h3 className="border-b border-line px-4 py-3.5 text-xl font-semibold">Chat</h3>
        <div ref={list} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {!data.length && <p className="py-8 text-center text-sm text-muted">No messages yet. Ask the office or the next operator about this job.</p>}
          {days.map((g) => (
            <div key={g.day} className="space-y-3">
              <div className="relative text-center">
                <span className="absolute inset-x-0 top-1/2 border-t border-line" aria-hidden />
                <span className="relative rounded-full bg-panel px-2 py-0.5 text-[11px] text-muted ring-1 ring-line">{g.day}</span>
              </div>
              {g.items.map((m) => (
                <Bubble key={m.id} m={m} mine={m.userId === me.user.id} />
              ))}
            </div>
          ))}
        </div>
        <ErrorNote error={send.error ?? upload.error} />
        <form onSubmit={(e) => (e.preventDefault(), submit())} className="flex items-center gap-2 border-t border-line p-3">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Message about this job…"
            aria-label="Message"
            className="h-12 min-w-0 flex-1 rounded-xl bg-panel px-3 text-[15px] ring-1 ring-line outline-none focus:ring-2 focus:ring-accent"
          />
          <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => (e.target.files?.[0] && upload.mutate(e.target.files[0]), (e.target.value = ""))} />
          <button
            type="submit"
            disabled={send.isPending || upload.isPending}
            aria-label={text.trim() ? "Send message" : "Add a photo"}
            className="flex h-12 w-14 shrink-0 items-center justify-center rounded-xl bg-ink text-panel disabled:opacity-50"
          >
            {text.trim() ? <Send className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
          </button>
        </form>
      </section>
    </div>
  );
}

/** One chat message; @Names are shown in bold, alerts stand out in red. */
function Bubble({ m, mine }: { m: Message; mine: boolean }) {
  const time = new Date(m.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const parts = (m.body ?? "").split(/(@\w+)/g);
  return (
    <div className={cx("flex items-end gap-2", mine && "flex-row-reverse")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{initials(m.userName)}</span>
      <div className={cx("max-w-[78%]", mine && "text-right")}>
        <div className="mb-0.5 text-[11px] text-muted">
          {m.userName ?? "Former user"} {time}
        </div>
        <div className={cx("inline-block rounded-xl px-3 py-2 text-left text-sm", m.kind === "alert" ? "bg-bad-soft text-bad ring-1 ring-bad/30" : mine ? "bg-accent-soft" : "bg-panel-2")}>
          {m.kind === "alert" && <div className="font-semibold">Alert: {m.reason}</div>}
          {m.attachmentId && (
            <a href={fileUrl(m.attachmentId)} target="_blank" rel="noreferrer" className="mb-1 block">
              <img src={fileUrl(m.attachmentId)} alt={m.attachmentName ?? "Photo"} className="max-h-48 rounded-lg" />
            </a>
          )}
          {parts.map((p, i) => (p.startsWith("@") ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
        </div>
      </div>
    </div>
  );
}

/** Save an off-cut as a remnant lot: it comes off the job and goes back on the shelf. */
function RemnantModal({ m, onClose }: { m: OpView["materials"][number]; onClose: () => void }) {
  const qc = useQueryClient();
  const [qty, setQty] = useState("");
  const [size, setSize] = useState("");
  const save = useMutation({
    mutationFn: () => api(`/floor/materials/${m.id}/remnant`, "POST", { quantity: Number(qty), dimensions: size }),
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["floor-op"] }), onClose()),
  });
  return (
    <Modal open onClose={onClose} title="Save a remnant">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="text-sm text-muted">{m.description}. The off-cut gets its own lot number, keeps the original lot's cost and certificate, and comes off this job's material.</p>
        <Field label="Size, as you'd describe it">
          <Input value={size} onChange={(e) => setSize(e.target.value)} placeholder="e.g. 14 in drop, 20 x 30 sheet" required />
        </Field>
        <Field label="Amount, in the material's unit" hint={`Up to ${num(m.quantityIssued, 4)} (what was picked)`}>
          <Input type="number" min={0} step="any" value={qty} onChange={(e) => setQty(e.target.value)} required />
        </Field>
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}>Save remnant</Button>
        </div>
      </form>
    </Modal>
  );
}
