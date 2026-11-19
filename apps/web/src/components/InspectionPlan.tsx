/**
 * The part's inspection plan: click on the drawing to drop numbered balloons, then say what each
 * one checks, how tight it is, at which routing step and how often. Saved as one plan; each new
 * job takes a copy.
 */
import { CHARACTERISTIC_KINDS, DEFAULT_TOLERANCES, defaultTolerance, toleranceText, type CharacteristicKind } from "@ironline/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Crosshair, ListPlus, Minus, Plus, Save, Star, Trash2, Undo2 } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { api, type Characteristic } from "../api.ts";
import type { FileRow } from "./Files.tsx";
import { Button, cx, ErrorNote, Loading } from "./ui.tsx";

const Drawing = lazy(() => import("./Drawing.tsx"));

export const KIND_LABEL: Record<CharacteristicKind, { label: string; sym: string }> = {
  length: { label: "Length", sym: "↔" },
  diameter: { label: "Diameter", sym: "⌀" },
  radius: { label: "Radius", sym: "R" },
  angle: { label: "Angle", sym: "∠" },
  position: { label: "Position", sym: "⌖" },
  flatness: { label: "Flatness", sym: "▱" },
  perpendicularity: { label: "Perpendicularity", sym: "⊥" },
  runout: { label: "Runout", sym: "↗" },
  roughness: { label: "Surface finish", sym: "Ra" },
  thread: { label: "Thread", sym: "M" },
  note: { label: "Note / visual", sym: "✎" },
};
const GEOMETRIC = new Set(["position", "flatness", "perpendicularity", "runout"]);
export const kindOf = (k: string) => KIND_LABEL[k as CharacteristicKind] ?? KIND_LABEL.length;

/** "⌀ 12.00 ±0.02 mm" — how a balloon reads in a list. */
/** Decimal places a number was written with (up to 6). */
const places = (n: number | null) => (n == null ? 0 : Math.min(6, (String(n).split(".")[1] ?? "").length));
/** The target written with as many decimals as its tolerance, so 2 ±0.005 reads "2.000". */
export const nominalText = (c: Pick<Characteristic, "nominal" | "tolPlus" | "tolMinus">) =>
  c.nominal == null ? "?" : c.nominal.toFixed(Math.max(places(c.nominal), places(c.tolPlus), places(c.tolMinus)));

export function targetText(c: Pick<Characteristic, "kind" | "nominal" | "tolPlus" | "tolMinus" | "unit" | "requirement" | "datums">) {
  if (c.kind === "note") return c.requirement || "Check";
  const unit = c.kind === "angle" ? "°" : ` ${c.unit}`;
  // Form and position tolerances read like a feature control frame: "⊥ 0.002 | A".
  if (GEOMETRIC.has(c.kind) && !c.nominal && c.tolMinus == null && c.tolPlus != null) return `${kindOf(c.kind).sym} ${c.tolPlus}${unit}${c.datums ? ` | ${c.datums}` : ""}`;
  if (c.tolMinus == null && c.tolPlus === 0) return `${kindOf(c.kind).sym} ${nominalText(c)} max${unit}`;
  const t = toleranceText(c);
  return `${kindOf(c.kind).sym} ${nominalText(c)}${t ? ` ${t}` : ""}${unit}`;
}

export const samplingText = (c: Pick<Characteristic, "sampling" | "everyN">) =>
  c.sampling === "first" ? "First piece" : c.sampling === "all" ? "Every piece" : `First + every ${c.everyN ?? "?"}`;

const blank = (number: number, attachmentId: string | null, page: number, x: number | null, y: number | null, kind: CharacteristicKind = "length"): Characteristic => ({
  number,
  kind,
  attachmentId,
  page,
  x,
  y,
  nominal: null,
  tolPlus: null,
  tolMinus: null,
  unit: "mm",
  datums: null,
  requirement: null,
  operationSeq: null,
  sampling: "first",
  everyN: null,
  gauge: null,
  critical: false,
});

const fieldCls = "w-full min-w-0 rounded-md bg-panel-2 px-2 py-1.5 text-sm text-ink outline-none ring-1 ring-line focus:ring-2 focus:ring-accent";

export function InspectionPlan({ itemId, files, operations }: { itemId: string; files: FileRow[]; operations: { sequence: number; label: string }[] }) {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["inspection-plan", itemId], queryFn: () => api<Characteristic[]>(`/items/${itemId}/inspection-plan`) });
  const drawings = files.filter((f) => f.kind === "pdf" || f.kind === "image");
  const [rows, setRows] = useState<Characteristic[]>([]);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [placing, setPlacing] = useState(false);
  const [moving, setMoving] = useState<number | null>(null);

  useEffect(() => {
    if (plan.data && !dirty) setRows(plan.data);
  }, [plan.data, dirty]);
  useEffect(() => {
    if (!fileId && drawings[0]) setFileId(drawings[0].id);
  }, [drawings, fileId]);

  const file = drawings.find((f) => f.id === fileId) ?? null;
  const save = useMutation({
    mutationFn: () => api<Characteristic[]>(`/items/${itemId}/inspection-plan`, "PUT", { characteristics: rows.map(({ id: _id, ...r }) => r) }),
    onSuccess: (data) => {
      qc.setQueryData(["inspection-plan", itemId], data);
      setDirty(false);
    },
  });

  const change = (next: Characteristic[]) => {
    setRows(next);
    setDirty(true);
  };
  const nextNumber = () => rows.reduce((m, r) => Math.max(m, r.number), 0) + 1;
  const update = (number: number, patch: Partial<Characteristic>) => change(rows.map((r) => (r.number === number ? { ...r, ...patch } : r)));

  const place = (x: number, y: number) => {
    if (moving != null) {
      update(moving, { x, y, attachmentId: fileId, page });
      setMoving(null);
      return;
    }
    const n = nextNumber();
    // A new balloon uses the same unit as the previous one (a drawing is usually all inch or all mm).
    change([...rows, { ...blank(n, fileId, page, x, y), unit: rows.at(-1)?.unit ?? "mm" }]);
    setSel(n);
  };

  const marks = useMemo(
    () =>
      rows
        .filter((r) => r.attachmentId === fileId && r.page === page && r.x != null && r.y != null)
        .map((r) => ({ key: String(r.number), number: r.number, x: r.x!, y: r.y!, tone: sel === r.number ? ("selected" as const) : ("plan" as const) })),
    [rows, fileId, page, sel],
  );

  if (plan.isLoading) return <Loading />;

  return (
    <section
      className="mt-5 rounded-xl bg-panel shadow-panel ring-1 ring-line/70"
      // The plan sits inside the part's form: Enter in a field commits the value instead of saving the part.
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
          e.preventDefault();
          e.target.blur();
        }
      }}
    >
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="mr-auto">
          <h2 className="text-xl font-semibold">Inspection plan</h2>
          <p className="text-sm text-muted">
            {rows.length ? `${rows.length} balloon${rows.length === 1 ? "" : "s"}` : "No balloons yet"} · each new job takes a copy, and the floor records readings against it.
          </p>
        </div>
        {dirty && (
          <Button type="button" variant="ghost" onClick={() => (setDirty(false), setRows(plan.data ?? []), setSel(null))}>
            <Undo2 className="h-4 w-4" /> Discard changes
          </Button>
        )}
        <Button type="button" variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          <Save className="h-4 w-4" /> {save.isPending ? "Saving…" : dirty ? "Save plan" : "Saved"}
        </Button>
      </header>
      {save.error && (
        <div className="px-4 pt-3">
          <ErrorNote error={save.error} />
        </div>
      )}

      <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className={cx(fieldCls, "w-auto! max-w-72")} value={fileId ?? ""} onChange={(e) => (setFileId(e.target.value || null), setPage(1))} aria-label="Drawing">
              {!drawings.length && <option value="">No PDF or image drawing yet</option>}
              {drawings.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.fileName}
                </option>
              ))}
            </select>
            {pages > 1 && (
              <span className="flex items-center gap-1 text-sm">
                <button type="button" className="rounded p-1 hover:bg-panel-2 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="num">
                  Page {page} / {pages}
                </span>
                <button type="button" className="rounded p-1 hover:bg-panel-2 disabled:opacity-40" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </span>
            )}
            <span className="flex items-center gap-1 rounded-md bg-panel-2 px-1 ring-1 ring-line">
              <button type="button" className="p-1" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">
                <Minus className="h-4 w-4" />
              </button>
              <span className="num w-11 text-center text-sm">{Math.round(zoom * 100)}%</span>
              <button type="button" className="p-1" onClick={() => setZoom(Math.min(3, zoom + 0.25))} aria-label="Zoom in">
                <Plus className="h-4 w-4" />
              </button>
            </span>
            <div className="ml-auto flex gap-2">
              <Button type="button" variant={placing ? "primary" : "secondary"} disabled={!file} onClick={() => (setPlacing(!placing), setMoving(null))} aria-pressed={placing}>
                <Crosshair className="h-4 w-4" /> {placing ? "Click the drawing… (done)" : "Add balloons"}
              </Button>
              <Button type="button" onClick={() => {
                const n = nextNumber();
                change([...rows, blank(n, null, 1, null, null, "note")]);
                setSel(n);
              }}>
                <ListPlus className="h-4 w-4" /> Add check without balloon
              </Button>
            </div>
          </div>
          {moving != null && <p className="mb-2 rounded-md bg-accent-soft px-3 py-1.5 text-sm text-accent">Click the drawing where balloon {moving} should go.</p>}
          {file ? (
            <Suspense fallback={<Loading />}>
              <Drawing
                file={file}
                page={page}
                zoom={zoom}
                balloons={marks}
                placing={placing || moving != null}
                onPlace={place}
                onBalloon={(k) => setSel(Number(k))}
                onPages={setPages}
                className="h-[680px]"
              />
            </Suspense>
          ) : (
            <div className="flex h-[300px] flex-col items-center justify-center gap-2 rounded-xl bg-panel-2 text-center text-sm text-muted">
              <p>Upload the part's drawing as a PDF or image under Drawings &amp; 3D above.</p>
              <p>Then click "Add balloons" and click each dimension you want checked.</p>
            </div>
          )}
          <p className="mt-2 text-xs text-muted">
            Title-block tolerance used when you leave a tolerance empty: X ±{DEFAULT_TOLERANCES.linear[0]} · X.X ±{DEFAULT_TOLERANCES.linear[1]} · X.XX ±{DEFAULT_TOLERANCES.linear[2]} · X.XXX ±{DEFAULT_TOLERANCES.linear[3]} · angles ±{DEFAULT_TOLERANCES.angular}°
          </p>
        </div>

        <div className="flex max-h-[760px] min-w-0 flex-col gap-2 overflow-y-auto pr-1">
          {!rows.length && <p className="rounded-xl bg-panel-2 p-4 text-sm text-muted">Balloons you add show up here, numbered in the order you click them.</p>}
          {rows
            .slice()
            .sort((a, b) => a.number - b.number)
            .map((r) => (
              <CharacteristicCard
                key={r.number}
                c={r}
                open={sel === r.number}
                onOpen={() => {
                  setSel(sel === r.number ? null : r.number);
                  if (r.attachmentId && r.attachmentId !== fileId) setFileId(r.attachmentId);
                  if (r.attachmentId) setPage(r.page);
                }}
                operations={operations}
                onChange={(p) => update(r.number, p)}
                onRemove={() => (change(rows.filter((x) => x.number !== r.number)), setSel(null))}
                onMove={() => (setMoving(r.number), setPlacing(false))}
                canMove={!!file}
              />
            ))}
        </div>
      </div>
    </section>
  );
}

function CharacteristicCard({
  c,
  open,
  onOpen,
  operations,
  onChange,
  onRemove,
  onMove,
  canMove,
}: {
  c: Characteristic;
  open: boolean;
  onOpen: () => void;
  operations: { sequence: number; label: string }[];
  onChange: (p: Partial<Characteristic>) => void;
  onRemove: () => void;
  onMove: () => void;
  canMove: boolean;
}) {
  const [nomText, setNomText] = useState(c.nominal == null ? "" : String(c.nominal));
  useEffect(() => setNomText(c.nominal == null ? "" : String(c.nominal)), [c.nominal]);
  const numOrNull = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  const isNote = c.kind === "note";
  const missing = !isNote && c.nominal == null;
  const op = operations.find((o) => o.sequence === c.operationSeq);

  return (
    <div className={cx("rounded-xl bg-panel ring-1 transition", open ? "ring-2 ring-accent" : missing ? "ring-warn" : "ring-line")}>
      <button type="button" onClick={onOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className={cx("num flex h-8 min-w-8 items-center justify-center rounded-full text-sm font-bold ring-2", open ? "bg-accent text-white ring-accent" : "bg-white text-accent ring-accent")}>{c.number}</span>
        <span className="min-w-0 flex-1">
          <span className="num block truncate font-medium">{missing ? <span className="text-warn">Set the target value</span> : targetText(c)}</span>
          <span className="block truncate text-xs text-muted">
            {samplingText(c)}
            {op ? ` · ${op.label}` : " · any step"}
            {c.gauge ? ` · ${c.gauge}` : ""}
            {c.x == null && !isNote ? " · not on drawing" : ""}
          </span>
        </span>
        {c.critical && <Star className="h-4 w-4 shrink-0 fill-warn text-warn" aria-label="Critical" />}
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-line px-3 py-3 text-sm">
          <label className="col-span-2">
            <span className="mb-1 block text-xs text-muted">What it checks</span>
            <select className={fieldCls} value={c.kind} onChange={(e) => onChange({ kind: e.target.value as CharacteristicKind, ...(e.target.value === "note" ? { nominal: null, tolPlus: null, tolMinus: null } : {}) })}>
              {CHARACTERISTIC_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k].sym} {KIND_LABEL[k].label}
                </option>
              ))}
            </select>
          </label>
          {isNote ? (
            <label className="col-span-2">
              <span className="mb-1 block text-xs text-muted">Requirement (pass or fail)</span>
              <textarea rows={2} className={fieldCls} value={c.requirement ?? ""} placeholder="e.g. Deburr all edges, no tool marks on face A" onChange={(e) => onChange({ requirement: e.target.value || null })} />
            </label>
          ) : (
            <>
              <label>
                <span className="mb-1 block text-xs text-muted">Target</span>
                <input
                  className={cx(fieldCls, "num")}
                  inputMode="decimal"
                  value={nomText}
                  onChange={(e) => setNomText(e.target.value)}
                  onBlur={() => {
                    const n = numOrNull(nomText);
                    const p: Partial<Characteristic> = { nominal: n };
                    // Fill the title-block tolerance from the decimals typed, if none is set yet.
                    if (n != null && c.tolPlus == null && c.tolMinus == null) {
                      const t = defaultTolerance(nomText, c.kind as CharacteristicKind, DEFAULT_TOLERANCES);
                      if (t != null) Object.assign(p, { tolPlus: t, tolMinus: t });
                    }
                    onChange(p);
                  }}
                />
              </label>
              <label>
                <span className="mb-1 block text-xs text-muted">Unit</span>
                <select className={fieldCls} value={c.unit} onChange={(e) => onChange({ unit: e.target.value })}>
                  {["mm", "in", "µm", "µin", "deg"].map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-xs text-muted">Plus tolerance (+)</span>
                <input className={cx(fieldCls, "num")} inputMode="decimal" placeholder="no max" value={c.tolPlus ?? ""} onChange={(e) => onChange({ tolPlus: numOrNull(e.target.value) == null ? null : Math.abs(numOrNull(e.target.value)!) })} />
              </label>
              <label>
                <span className="mb-1 block text-xs text-muted">Minus tolerance (−)</span>
                <input className={cx(fieldCls, "num")} inputMode="decimal" placeholder="no min" value={c.tolMinus ?? ""} onChange={(e) => onChange({ tolMinus: numOrNull(e.target.value) == null ? null : Math.abs(numOrNull(e.target.value)!) })} />
              </label>
              <label className="col-span-2">
                <span className="mb-1 block text-xs text-muted">Datums (optional)</span>
                <input className={fieldCls} value={c.datums ?? ""} placeholder="e.g. A-B" onChange={(e) => onChange({ datums: e.target.value || null })} />
              </label>
            </>
          )}
          <label className="col-span-2">
            <span className="mb-1 block text-xs text-muted">Checked at routing step</span>
            <select className={fieldCls} value={c.operationSeq ?? ""} onChange={(e) => onChange({ operationSeq: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Any step (final inspection)</option>
              {operations.map((o) => (
                <option key={o.sequence} value={o.sequence}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">How often</span>
            <select className={fieldCls} value={c.sampling} onChange={(e) => onChange({ sampling: e.target.value as Characteristic["sampling"], everyN: e.target.value === "every_n" ? (c.everyN ?? 5) : null })}>
              <option value="first">First piece</option>
              <option value="every_n">First + every N</option>
              <option value="all">Every piece</option>
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs text-muted">N (pieces)</span>
            <input className={cx(fieldCls, "num")} type="number" min={1} disabled={c.sampling !== "every_n"} value={c.everyN ?? ""} onChange={(e) => onChange({ everyN: e.target.value ? Math.max(1, Math.floor(Number(e.target.value))) : null })} />
          </label>
          <label className="col-span-2">
            <span className="mb-1 block text-xs text-muted">Gauge or tool</span>
            <input className={fieldCls} value={c.gauge ?? ""} placeholder="e.g. Caliper, Pin gauge, CMM" onChange={(e) => onChange({ gauge: e.target.value || null })} />
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={c.critical} onChange={(e) => onChange({ critical: e.target.checked })} />
            <span>Critical feature (highlighted for the operator and on the report)</span>
          </label>
          <div className="col-span-2 mt-1 flex gap-2">
            {canMove && (
              <Button type="button" onClick={onMove}>
                <Crosshair className="h-4 w-4" /> {c.x == null ? "Place on drawing" : "Move balloon"}
              </Button>
            )}
            <Button type="button" variant="ghost" className="ml-auto text-bad" onClick={onRemove}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
