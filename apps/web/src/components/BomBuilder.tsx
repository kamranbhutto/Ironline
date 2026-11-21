import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight, ChevronUp, GripVertical, Pencil, Plus, Search, ShoppingCart, Trash2, Wrench, X } from "lucide-react";
import { useState, type DragEvent } from "react";
import { api, type Item, type ItemDetail, type WorkCenter } from "../api.ts";
import { money, num } from "../format.ts";
import { PartThumb } from "./PartThumb.tsx";
import { NewComponentModal, NewOperationModal } from "./QuickCreate.tsx";
import { Link } from "react-router";
import { Button, cx } from "./ui.tsx";

export type BuilderOp = { workCenterId: string; description: string; setupHours: string; runHoursPerUnit: string };
export type BuilderBom = { componentItemId: string; quantityPer: string; scrapPct: string };

const DRAG_ITEM = "application/x-ironline-item";
const DRAG_OP = "application/x-ironline-op";
const DRAG_WC = "application/x-ironline-wc";

/** Make or Buy, as a small tag next to a part number. */
function SourceTag({ type }: { type: string }) {
  const make = type === "manufactured";
  const label = make ? "Make" : type === "material" ? "Material" : type === "service" ? "Service" : "Buy";
  const Icon = make ? Wrench : ShoppingCart;
  return (
    <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium", make ? "bg-ok-soft text-ok" : "bg-info-soft text-info")}>
      <Icon className="h-3 w-3" aria-hidden /> {label}
    </span>
  );
}

/** "1 Saw › 2 Lathe › 3 Inspect" — a part's routing as a chain of numbered chips. */
function OpChain({
  ops,
  selected,
  onSelect,
  onAdd,
  onMove,
  onDropWorkCenter,
  tone = "ok",
}: {
  ops: { code: string; title: string }[];
  selected?: number | null;
  onSelect?: (i: number) => void;
  onAdd?: () => void;
  onMove?: (from: number, to: number) => void;
  onDropWorkCenter?: (wcId: string) => void;
  tone?: "ok" | "accent";
}) {
  const [over, setOver] = useState(false);
  const editable = !!onMove;
  const accept = (e: DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_OP) || e.dataTransfer.types.includes(DRAG_WC)) {
      e.preventDefault();
      setOver(true);
    }
  };
  return (
    <div
      onDragOver={editable ? accept : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const wc = e.dataTransfer.getData(DRAG_WC);
        if (wc && onDropWorkCenter) onDropWorkCenter(wc);
      }}
      className={cx(
        "flex min-h-9 flex-wrap items-center gap-1 rounded-lg px-2 py-1.5 text-[13px]",
        tone === "ok" ? "bg-ok-soft/70" : "bg-accent-soft/70",
        over && "ring-2 ring-accent",
      )}
    >
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      {!ops.length && <span className="px-1 text-muted">No operations</span>}
      {ops.map((o, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-muted" aria-hidden />}
          <button
            type="button"
            draggable={editable}
            onDragStart={(e) => e.dataTransfer.setData(DRAG_OP, String(i))}
            onDragOver={(e) => editable && e.dataTransfer.types.includes(DRAG_OP) && e.preventDefault()}
            onDrop={(e) => {
              const from = e.dataTransfer.getData(DRAG_OP);
              if (from !== "" && onMove) {
                e.stopPropagation();
                onMove(Number(from), i);
              }
            }}
            onClick={() => onSelect?.(i)}
            title={o.title}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-full py-0.5 pl-0.5 pr-2 font-medium",
              selected === i ? "bg-accent text-white" : onSelect ? "hover:bg-panel" : "cursor-default",
              editable && "cursor-grab",
            )}
          >
            <span className={cx("num flex h-5 w-5 items-center justify-center rounded-full text-[11px]", selected === i ? "bg-white/25" : tone === "ok" ? "bg-ok text-white" : "bg-accent text-white")}>{i + 1}</span>
            {o.code}
          </button>
        </span>
      ))}
      {onAdd && (
        <button type="button" onClick={onAdd} className="ml-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-accent hover:bg-panel">
          <Plus className="h-3.5 w-3.5" aria-hidden /> Add operation
        </button>
      )}
    </div>
  );
}

/** A made-in-house component, shown with its own routing and parts, read from its part record. */
function SubAssembly({ itemId, depth, seen, expandAll }: { itemId: string; depth: number; seen: string[]; expandAll: boolean }) {
  const d = useQuery({ queryKey: ["item", itemId], queryFn: () => api<ItemDetail>(`/items/${itemId}`) });
  if (!d.data) return <div className="ml-6 h-8 animate-pulse rounded-lg bg-panel-2" />;
  if (seen.includes(itemId)) return <div className="ml-6 text-xs text-bad">This part contains itself — check its bill of material.</div>;
  return (
    <div className="ml-5 space-y-2 border-l-2 border-ok/40 pl-3">
      <OpChain ops={d.data.routing.map((r) => ({ code: r.description || r.workCenterCode, title: `${r.workCenterCode} · setup ${r.setupHours} h · ${num(r.runHoursPerUnit * 60, 2)} min/pc` }))} />
      {d.data.bom.map((b) => (
        <TreeRow key={b.id} itemId={b.componentItemId} partNumber={b.partNumber} description={b.description} type={b.type} qty={b.quantityPer} cost={b.unitCost * b.quantityPer * (1 + b.scrapPct / 100)} depth={depth + 1} seen={[...seen, itemId]} expandAll={expandAll} />
      ))}
    </div>
  );
}

function TreeRow(p: {
  itemId: string;
  partNumber: string;
  description: string;
  type: string;
  qty: number;
  cost: number;
  depth: number;
  seen: string[];
  expandAll: boolean;
  uom?: string;
  edit?: { quantityPer: string; scrapPct: string; onQty: (v: string) => void; onScrap: (v: string) => void; onRemove: () => void; onMove?: (dir: -1 | 1) => void };
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? p.expandAll;
  const make = p.type === "manufactured" && p.depth < 6;
  return (
    <div className="space-y-2">
      <div className={cx("flex flex-wrap items-center gap-3 rounded-lg bg-panel px-2 py-2 ring-1 ring-line", p.edit && "border-l-4 border-l-ok")}>
        {p.edit && <GripVertical className="h-4 w-4 shrink-0 text-muted" aria-hidden />}
        <PartThumb itemId={p.itemId} className="h-11 w-14" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/items/${p.itemId}`} className="num font-semibold hover:text-accent hover:underline">{p.partNumber}</Link>
            <SourceTag type={p.type} />
          </div>
          <div className="truncate text-xs text-muted">{p.description}</div>
        </div>
        {p.edit ? (
          <>
            <label className="w-24 rounded-md bg-panel-2 px-2 py-1">
              <span className="block text-[10px] text-muted">Qty per</span>
              <input type="number" min={0} step="0.0001" value={p.edit.quantityPer} onChange={(e) => p.edit!.onQty(e.target.value)} className="num w-full bg-transparent text-sm outline-none" />
            </label>
            <label className="w-20 rounded-md bg-panel-2 px-2 py-1">
              <span className="block text-[10px] text-muted">Scrap %</span>
              <input type="number" min={0} step="0.1" value={p.edit.scrapPct} onChange={(e) => p.edit!.onScrap(e.target.value)} className="num w-full bg-transparent text-sm outline-none" />
            </label>
          </>
        ) : (
          <div className="w-24 rounded-md bg-panel-2 px-2 py-1 text-center">
            <div className="text-[10px] text-muted">Total qty</div>
            <div className="num text-sm">{num(p.qty, 4)}</div>
          </div>
        )}
        <div className="num w-24 text-right text-sm">
          {money(p.cost)}
          <div className="text-[10px] text-muted">per piece</div>
        </div>
        <div className="flex items-center">
          {p.edit?.onMove && (
            <>
              <button type="button" aria-label="Move up" onClick={() => p.edit!.onMove!(-1)} className="rounded p-1 text-muted hover:bg-panel-2"><ChevronUp className="h-4 w-4" /></button>
              <button type="button" aria-label="Move down" onClick={() => p.edit!.onMove!(1)} className="rounded p-1 text-muted hover:bg-panel-2"><ChevronDown className="h-4 w-4" /></button>
            </>
          )}
          {p.edit && (
            <button type="button" aria-label="Remove from bill of material" onClick={p.edit.onRemove} className="rounded p-1 text-muted hover:bg-bad-soft hover:text-bad"><Trash2 className="h-4 w-4" /></button>
          )}
          {make && (
            <button type="button" aria-label={expanded ? "Collapse" : "Expand"} aria-expanded={expanded} onClick={() => setOpen(!expanded)} className="rounded p-1 text-muted hover:bg-panel-2">
              <ChevronDown className={cx("h-4 w-4 transition-transform", expanded && "rotate-180")} />
            </button>
          )}
        </div>
      </div>
      {make && expanded && <SubAssembly itemId={p.itemId} depth={p.depth} seen={p.seen} expandAll={p.expandAll} />}
    </div>
  );
}

type LibTab = "items" | "ops" | "materials";

/**
 * Bill of materials and routing as one tree: the part, its operations as a chain, then its
 * components; made-in-house components open to show their own operations and parts.
 * In edit mode a library on the left adds parts, materials and operations (click or drag).
 */
export function BomBuilder(p: {
  partId?: string;
  partNumber: string;
  description: string;
  uom: string;
  routing: BuilderOp[];
  bom: BuilderBom[];
  onRouting: (r: BuilderOp[]) => void;
  onBom: (b: BuilderBom[]) => void;
  workCenters: WorkCenter[];
  parts: Item[];
  unitCost: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [expandAll, setExpandAll] = useState(true);
  const [tree, setTree] = useState(0); // remounts rows so "expand all" overrides per-row choices
  const [lib, setLib] = useState<LibTab>("items");
  const [q, setQ] = useState("");
  const [buy, setBuy] = useState(true);
  const [make, setMake] = useState(true);
  const [sel, setSel] = useState<number | null>(null);
  const [dropOver, setDropOver] = useState(false);
  const [creating, setCreating] = useState<null | "op" | "part" | "material">(null);

  const wc = (id: string) => p.workCenters.find((w) => w.id === id);
  const components = p.parts.filter((x) => x.id !== p.partId);
  const inBom = new Set(p.bom.map((b) => b.componentItemId));
  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());
  const libItems = components.filter(
    (x) => (lib === "materials" ? x.type === "material" : x.type !== "material" && ((buy && x.type !== "manufactured") || (make && x.type === "manufactured"))) && match(`${x.partNumber} ${x.description}`),
  );
  const libOps = p.workCenters.filter((w) => w.active && match(`${w.code} ${w.name}`));

  const addPart = (id: string) => !inBom.has(id) && p.onBom([...p.bom, { componentItemId: id, quantityPer: "1", scrapPct: "0" }]);
  const addOp = (wcId: string) => {
    p.onRouting([...p.routing, { workCenterId: wcId, description: "", setupHours: "0", runHoursPerUnit: "0" }]);
    setSel(p.routing.length);
  };
  const moveOp = (from: number, to: number) => {
    if (from === to || to < 0 || to >= p.routing.length) return;
    const next = [...p.routing];
    const [o] = next.splice(from, 1);
    next.splice(to, 0, o!);
    p.onRouting(next);
    setSel(to);
  };
  const setOp = (i: number, patch: Partial<BuilderOp>) => p.onRouting(p.routing.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setBom = (i: number, patch: Partial<BuilderBom>) => p.onBom(p.bom.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const moveBom = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= p.bom.length) return;
    const next = [...p.bom];
    [next[i], next[j]] = [next[j]!, next[i]!];
    p.onBom(next);
  };
  const op = sel != null ? p.routing[sel] : undefined;
  const total = (p.unitCost ?? 0) * 1;

  return (
    <section className="mt-5 min-w-0 overflow-hidden rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel-2/60 px-4 py-2.5">
        <h2 className="text-lg font-semibold">Bill of materials &amp; routing</h2>
        <span className="hidden text-sm text-muted lg:inline">{editing ? "Click or drag from the library. Drag operation chips to reorder." : "Changes apply to new quotes and jobs; existing jobs keep their own copy."}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button variant="ghost" onClick={() => (setExpandAll(false), setTree(tree + 1))}><ChevronUp className="h-4 w-4" /> Collapse all</Button>
          <Button variant="ghost" onClick={() => (setExpandAll(true), setTree(tree + 1))}><ChevronDown className="h-4 w-4" /> Expand all</Button>
          {editing ? (
            <Button variant="primary" onClick={() => (setEditing(false), setSel(null))}><Check className="h-4 w-4" /> Done editing</Button>
          ) : (
            <Button onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /> Edit</Button>
          )}
        </div>
      </header>

      <div className={cx("grid min-w-0", editing && "lg:grid-cols-[300px_minmax(0,1fr)]")}>
        {editing && (
          <aside className="min-w-0 border-b border-line bg-panel-2/40 p-3 lg:border-b-0 lg:border-r">
            {op && sel != null ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-ok-soft px-3 py-2">
                  <span className="font-semibold text-ok">Operation {sel + 1}</span>
                  <button type="button" aria-label="Close operation settings" onClick={() => setSel(null)} className="rounded p-1 text-ok hover:bg-panel"><X className="h-4 w-4" /></button>
                </div>
                <label className="block">
                  <span className="text-xs text-muted">Work center</span>
                  <select value={op.workCenterId} onChange={(e) => setOp(sel, { workCenterId: e.target.value })} className="mt-1 w-full rounded-lg bg-panel px-2.5 py-2 text-sm ring-1 ring-line">
                    {p.workCenters.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs text-muted">Instructions for the operator</span>
                  <textarea rows={3} value={op.description} placeholder={wc(op.workCenterId)?.name} onChange={(e) => setOp(sel, { description: e.target.value })} className="mt-1 w-full resize-y rounded-lg bg-panel px-2.5 py-2 text-sm ring-1 ring-line" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="text-xs text-muted">Setup (hours, once)</span>
                    <input type="number" min={0} step="0.01" value={op.setupHours} onChange={(e) => setOp(sel, { setupHours: e.target.value })} className="num mt-1 w-full rounded-lg bg-panel px-2.5 py-2 text-sm ring-1 ring-line" />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted">Run (minutes / piece)</span>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={op.runHoursPerUnit === "" ? "" : String(Math.round(Number(op.runHoursPerUnit) * 60 * 10000) / 10000)}
                      onChange={(e) => setOp(sel, { runHoursPerUnit: e.target.value === "" ? "" : String(Number(e.target.value) / 60) })}
                      className="num mt-1 w-full rounded-lg bg-panel px-2.5 py-2 text-sm ring-1 ring-line"
                    />
                  </label>
                </div>
                <div className="rounded-lg bg-panel px-3 py-2 text-xs text-muted ring-1 ring-line">
                  Cost: <span className="num font-medium text-ink">{money(Number(op.setupHours || 0) * (wc(op.workCenterId)?.hourlyRate ?? 0))}</span> setup +{" "}
                  <span className="num font-medium text-ink">{money(Number(op.runHoursPerUnit || 0) * (wc(op.workCenterId)?.hourlyRate ?? 0))}</span> per piece at {money(wc(op.workCenterId)?.hourlyRate ?? 0)}/h
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => moveOp(sel, sel - 1)} disabled={sel === 0}><ArrowLeft className="h-4 w-4" /> Earlier</Button>
                  <Button onClick={() => moveOp(sel, sel + 1)} disabled={sel === p.routing.length - 1}>Later <ArrowRight className="h-4 w-4" /></Button>
                  <Button variant="ghost" className="text-bad" onClick={() => (p.onRouting(p.routing.filter((_, j) => j !== sel)), setSel(null))}><Trash2 className="h-4 w-4" /> Remove</Button>
                </div>
              </div>
            ) : (
              <>
                <div role="tablist" className="grid grid-cols-3 gap-0.5 rounded-xl bg-panel-2 p-1">
                  {(
                    [
                      ["items", "Items"],
                      ["ops", "Operations"],
                      ["materials", "Materials"],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} type="button" role="tab" aria-selected={lib === k} onClick={() => setLib(k)} className={cx("rounded-lg py-1.5 text-sm font-medium", lib === k ? "bg-ink text-panel" : "hover:bg-panel")}>
                      {l}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 rounded-lg bg-panel px-2.5 py-2 ring-1 ring-line">
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={lib === "ops" ? "Search operations" : lib === "materials" ? "Search materials" : "Search parts"} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="Search the library" />
                  <Search className="h-4 w-4 text-muted" aria-hidden />
                </label>
                <div className="mt-2 flex items-center gap-4 text-sm">
                  {lib === "items" && (
                    <>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={buy} onChange={(e) => setBuy(e.target.checked)} /> Buy</label>
                      <label className="flex items-center gap-1.5"><input type="checkbox" checked={make} onChange={(e) => setMake(e.target.checked)} /> Make</label>
                    </>
                  )}
                  <button type="button" onClick={() => setCreating(lib === "ops" ? "op" : lib === "materials" ? "material" : "part")} className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">
                    <Plus className="h-3.5 w-3.5" /> {lib === "ops" ? "New operation" : lib === "materials" ? "New material" : "New part"}
                  </button>
                </div>
                <ul className="mt-3 max-h-[520px] space-y-1.5 overflow-y-auto pr-1">
                  {lib === "ops"
                    ? libOps.map((w) => (
                        <li key={w.id} draggable onDragStart={(e) => e.dataTransfer.setData(DRAG_WC, w.id)} className="group flex cursor-grab items-center gap-2 rounded-lg bg-panel px-2.5 py-2 ring-1 ring-line">
                          <span className="h-3 w-3 shrink-0 rounded-full bg-ok" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{w.code}</div>
                            <div className="truncate text-xs text-muted">{w.name}</div>
                          </div>
                          {w.kind === "outside" && <span className="rounded bg-info-soft px-1.5 py-0.5 text-[10px] text-info">Outside</span>}
                          <button type="button" onClick={() => addOp(w.id)} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">+ Add</button>
                        </li>
                      ))
                    : libItems.map((x) => {
                        const added = inBom.has(x.id);
                        return (
                          <li key={x.id} draggable={!added} onDragStart={(e) => e.dataTransfer.setData(DRAG_ITEM, x.id)} className={cx("flex items-center gap-2 rounded-lg bg-panel px-2 py-1.5 ring-1 ring-line", added ? "opacity-70" : "cursor-grab", added && "border-l-4 border-l-accent")}>
                            <PartThumb itemId={x.id} className="h-9 w-11" />
                            <div className="min-w-0 flex-1">
                              {added && <div className="text-[10px] font-medium text-accent">✓ In the BOM</div>}
                              <div className="num truncate text-sm font-medium">{x.partNumber}</div>
                              <div className="truncate text-xs text-muted">{x.description}</div>
                            </div>
                            {!added && <button type="button" onClick={() => addPart(x.id)} className="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft">+ Add</button>}
                          </li>
                        );
                      })}
                  {(lib === "ops" ? libOps : libItems).length === 0 && <li className="py-6 text-center text-sm text-muted">{lib === "ops" ? "No matching operations. Use + New operation above." : lib === "materials" ? "No matching materials. Use + New material above." : "No matching parts. Use + New part above."}</li>}
                </ul>
              </>
            )}
          </aside>
        )}
        <NewOperationModal open={creating === "op"} onClose={() => setCreating(null)} onCreated={(w) => (setCreating(null), setQ(""), addOp(w.id))} />
        <NewComponentModal
          open={creating === "part" || creating === "material"}
          kind={creating === "material" ? "material" : "part"}
          onClose={() => setCreating(null)}
          onCreated={(x) => (setCreating(null), setQ(""), addPart(x.id))}
        />

        <div
          className={cx("min-w-0 space-y-2 p-4", dropOver && "bg-accent-soft/40")}
          onDragOver={(e) => {
            if (editing && e.dataTransfer.types.includes(DRAG_ITEM)) {
              e.preventDefault();
              setDropOver(true);
            }
          }}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => {
            setDropOver(false);
            const id = e.dataTransfer.getData(DRAG_ITEM);
            if (id) addPart(id);
          }}
        >
          <div className="flex flex-wrap items-center gap-4 rounded-xl p-3 ring-2 ring-ink/80">
            <PartThumb itemId={p.partId} className="h-20 w-28" />
            <div className="min-w-0 flex-1">
              <div className="num truncate text-xl font-semibold">{p.partNumber || "New part"}</div>
              <div className="truncate text-muted">{p.description}</div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                ["Quantity", `1 ${p.uom || "ea"}`],
                ["Unit cost", money(p.unitCost)],
                ["Total cost", money(total)],
              ].map(([k, v]) => (
                <div key={k} className="min-w-24 rounded-lg bg-panel-2 px-3 py-2 text-center">
                  <div className="text-xs text-muted">{k}</div>
                  <div className="num mt-0.5 font-semibold">{v}</div>
                </div>
              ))}
            </div>
          </div>

          <OpChain
            tone="accent"
            ops={p.routing.map((r) => ({ code: r.description || wc(r.workCenterId)?.code || "?", title: `${wc(r.workCenterId)?.code ?? ""} · setup ${r.setupHours || 0} h · ${num(Number(r.runHoursPerUnit || 0) * 60, 2)} min/pc` }))}
            selected={editing ? sel : null}
            onSelect={editing ? setSel : undefined}
            onAdd={editing ? () => (setLib("ops"), setSel(null)) : undefined}
            onMove={editing ? moveOp : undefined}
            onDropWorkCenter={editing ? addOp : undefined}
          />

          <div key={tree} className="space-y-2 pl-3">
            {p.bom.map((b, i) => {
              const c = p.parts.find((x) => x.id === b.componentItemId);
              if (!c) return null;
              const qty = Number(b.quantityPer || 0);
              return (
                <TreeRow
                  key={`${b.componentItemId}-${i}`}
                  itemId={c.id}
                  partNumber={c.partNumber}
                  description={c.description}
                  type={c.type}
                  qty={qty}
                  cost={c.unitCost * qty * (1 + Number(b.scrapPct || 0) / 100)}
                  depth={1}
                  seen={p.partId ? [p.partId] : []}
                  expandAll={expandAll}
                  edit={
                    editing
                      ? {
                          quantityPer: b.quantityPer,
                          scrapPct: b.scrapPct,
                          onQty: (v) => setBom(i, { quantityPer: v }),
                          onScrap: (v) => setBom(i, { scrapPct: v }),
                          onRemove: () => p.onBom(p.bom.filter((_, j) => j !== i)),
                          onMove: (dir) => moveBom(i, dir),
                        }
                      : undefined
                  }
                />
              );
            })}
            {!p.bom.length && (
              <div className="rounded-lg border-2 border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                {editing ? "Drag parts and materials here, or use + Add in the library." : "No components yet. Click Edit to add stock, hardware and sub-assemblies."}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
