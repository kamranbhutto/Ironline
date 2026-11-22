/**
 * Packaging: pick a part, choose what to compare (containers, pallets, trucks) and how to pack,
 * and every combination is counted and costed per part instantly in the browser. The best one can
 * be saved as the part's packing spec, shown on its jobs, and printed as a one-page report.
 * The Library tab holds the shop's containers, pallets and vehicles.
 */
import {
  bestCartons,
  BOARD_GRADES,
  DEFAULT_PACK_SETTINGS,
  rankOptions,
  returnableRoi,
  type PackContainer,
  type PackOption,
  type PackPallet,
  type PackPart,
  type PackSettings,
  type PackVehicle,
} from "@ironline/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, Boxes, Check, Layers, ListChecks, Pencil, Plus, Printer, Repeat, Ruler, Save, Sparkles, Truck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, ApiError, type Item, type ItemDetail, type PackAsset, type PackSpec } from "../api.ts";
import { fileUrl, type FileRow } from "../components/Files.tsx";
import { PackView3D, type PackViewMode } from "../components/PackView3D.tsx";
import { Badge, Button, Card, cx, ErrorNote, Field, Input, Loading, Modal, PillTabs, R, Select, Table, Td, ViewTabs } from "../components/ui.tsx";
import { money, num } from "../format.ts";

const KIND_LABEL: Record<PackAsset["kind"], string> = { carton: "Carton", tote: "Tote", crate: "Crate", pallet: "Pallet", vehicle: "Truck or container" };
const METHODS: [PackSettings["method"], string, string][] = [
  ["layers", "Flat layers", "Parts lie in grid layers, turned whichever way fits most."],
  ["cells", "One per cell", "Each part in its own cell, with board dividers between them."],
  ["nest", "Nested stacks", "Parts that slide into each other, stacked in columns."],
];
const LIMIT_LABEL: Record<string, string> = { space: "space", weight: "weight", height: "height", strength: "box strength", floor: "floor space" };
const cost4 = (n: number | null | undefined) => money(n, n != null && Math.abs(n) < 1 ? 4 : 2);

type Panel = "part" | "pack" | "ship" | "compare" | "payback";
type Study = PackSettings & { containers: string[]; pallets: string[]; vehicles: string[]; winMin: number; winMax: number; annualParts: number; cycleDays: number };

const toContainer = (a: PackAsset): PackContainer => ({ id: a.id, kind: a.kind as PackContainer["kind"], name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, wall: a.wall, tare: a.tare, maxLoad: a.maxLoad, cost: a.cost, returnable: a.returnable, tripCost: a.tripCost, lifeTrips: a.lifeTrips, grade: a.grade });
const toPallet = (a: PackAsset): PackPallet => ({ id: a.id, name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, tare: a.tare, maxLoad: a.maxLoad, maxHeight: a.maxHeight || a.h + 1500, cost: a.cost, returnable: a.returnable, tripCost: a.tripCost, lifeTrips: a.lifeTrips });
/** A study starts with the largest trailer in the library; others can be ticked on. */
const defaultVehicle = (list: PackAsset[]) => {
  const v = list.filter((a) => a.kind === "vehicle").sort((a, b) => b.l * b.w - a.l * a.w)[0];
  return v ? [v.id] : [];
};
const toVehicle = (a: PackAsset): PackVehicle => ({ id: a.id, name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, payload: a.maxLoad });

export function PackagingPage() {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "library" ? "library" : "study";
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Packaging</h1>
        <span className="hidden text-sm text-muted md:inline">Cheapest way to pack and ship each part</span>
        <div className="ml-auto">
          <ViewTabs views={[{ key: "study", label: "Packing study" }, { key: "library", label: "Library" }]} value={view} onChange={(v) => setParams(v === "library" ? { view: "library" } : params.get("item") ? { item: params.get("item")! } : {})} />
        </div>
      </div>
      {view === "library" ? <Library /> : <StudyView />}
    </>
  );
}

// ── Packing study ───────────────────────────────────────────────────────────

function StudyView() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const itemId = params.get("item") ?? "";
  const assets = useQuery({ queryKey: ["pack-assets"], queryFn: () => api<PackAsset[]>("/pack-assets") });
  const parts = useQuery({ queryKey: ["items", "", ""], queryFn: () => api<Item[]>("/items") });
  const item = useQuery({ queryKey: ["item", itemId], queryFn: () => api<ItemDetail>(`/items/${itemId}`), enabled: !!itemId });
  const files = useQuery({ queryKey: ["files", "item", itemId], queryFn: () => api<FileRow[]>(`/files?entity=item&entityId=${itemId}`), enabled: !!itemId });

  const [part, setPart] = useState({ l: "", w: "", h: "", weight: "", upright: false, nestPitch: "" });
  const [study, setStudy] = useState<Study | null>(null);
  const [selKey, setSelKey] = useState<string | null>(null);
  const [mode, setMode] = useState<PackViewMode>("box");
  const [explode, setExplode] = useState(0);
  const [fitted, setFitted] = useState<PackOption[]>([]);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("part");
  // On short screens the cost breakdown starts folded so the options list keeps its room.
  const [tallScreen] = useState(() => window.innerHeight >= 860);
  const [fillRef, fillHeight] = useFillHeight();

  const active = useMemo(() => (assets.data ?? []).filter((a) => a.active), [assets.data]);

  // A study starts from the part's saved settings, or from sensible defaults — once per part,
  // so saving (which refetches the part) keeps the options and the selected row.
  const startedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!assets.data || (itemId && !item.data)) return;
    if (startedFor.current === itemId) return;
    startedFor.current = itemId;
    const saved = (item.data?.packSettings ?? null) as Partial<Study> | null;
    const ids = (kinds: PackAsset["kind"][]) => active.filter((a) => kinds.includes(a.kind)).map((a) => a.id);
    const keep = (list: unknown, fallback: string[]) => {
      const ok = Array.isArray(list) ? (list as string[]).filter((id) => active.some((a) => a.id === id)) : [];
      return ok.length ? ok : fallback;
    };
    setStudy({
      ...DEFAULT_PACK_SETTINGS,
      winMin: 150,
      winMax: 600,
      annualParts: 20000,
      cycleDays: 10,
      ...(saved ?? {}),
      containers: keep(saved?.containers, ids(["carton", "tote", "crate"])),
      pallets: keep(saved?.pallets, ids(["pallet"])),
      vehicles: keep(saved?.vehicles, defaultVehicle(active)),
    } as Study);
    const d = item.data;
    setPart({
      l: d?.packL ? String(d.packL) : "",
      w: d?.packW ? String(d.packW) : "",
      h: d?.packH ? String(d.packH) : "",
      weight: d?.packWeight != null ? String(d.packWeight) : "",
      upright: !!d?.packUpright,
      nestPitch: d?.packNestPitch ? String(d.packNestPitch) : "",
    });
    setFitted([]);
    setSelKey(null);
  }, [assets.data, item.data, itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const packPart: PackPart | null = useMemo(() => {
    const l = Number(part.l), w = Number(part.w), h = Number(part.h), weight = Number(part.weight);
    if (!(l > 0 && w > 0 && h > 0) || !(weight >= 0) || part.weight === "") return null;
    return { l, w, h, weight, upright: part.upright, nestPitch: Number(part.nestPitch) > 0 ? Number(part.nestPitch) : null };
  }, [part]);

  const options = useMemo(() => {
    if (!study || !packPart) return [];
    const byId = new Map(active.map((a) => [a.id, a]));
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((a): a is PackAsset => !!a);
    const ranked = rankOptions(packPart, pick(study.containers).map(toContainer), pick(study.pallets).map(toPallet), pick(study.vehicles).map(toVehicle), study);
    return [...ranked, ...fitted].sort((a, b) => a.rankCost - b.rankCost || b.box.count - a.box.count);
  }, [study, packPart, active, fitted]);

  // The fitted cartons were sized for the old inputs; clear them when the inputs change.
  useEffect(() => setFitted([]), [packPart, study?.method, study?.margin, study?.padThickness, study?.dividerThickness]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyOf = (o: PackOption) => `${o.container.id}|${o.pallet.id}|${o.vehicle.id}`;
  const selected = options.find((o) => keyOf(o) === selKey) ?? options[0] ?? null;

  const savePacking = useMutation({
    mutationFn: (withSpec: boolean) => {
      const o = selected!;
      const spec: PackSpec | undefined = withSpec
        ? {
            method: study!.method,
            container: { code: o.container.name.split(" · ")[0]!, name: o.container.name.split(" · ").slice(1).join(" · ") || o.container.name, kind: o.container.kind, l: o.container.l, w: o.container.w, h: o.container.h, grade: o.container.grade ?? null },
            perBox: o.box.count,
            layers: o.box.layers,
            perLayer: o.box.perLayer,
            vertical: o.box.vertical,
            boxGross: Math.round(o.boxGross * 1000) / 1000,
            pallet: { code: o.pallet.name.split(" · ")[0]!, name: o.pallet.name.split(" · ").slice(1).join(" · ") },
            boxesPerPallet: o.palletLoad.boxes,
            partsPerPallet: o.partsPerPallet,
            vehicle: { code: o.vehicle.name.split(" · ")[0]!, name: o.vehicle.name.split(" · ").slice(1).join(" · ") },
            palletsPerLoad: o.load.pallets,
            partsPerLoad: o.partsPerLoad,
            costPerPart: o.rankCost,
            savedAt: new Date().toISOString(),
          }
        : undefined;
      const { containers, pallets, vehicles, ...rest } = study!;
      const settings: Record<string, number | string | boolean | string[]> = { ...rest, containers, pallets, vehicles };
      return api(`/items/${itemId}/packing`, "PUT", {
        packL: Number(part.l) || null,
        packW: Number(part.w) || null,
        packH: Number(part.h) || null,
        packWeight: part.weight === "" ? null : Number(part.weight),
        packUpright: part.upright,
        packNestPitch: Number(part.nestPitch) > 0 ? Number(part.nestPitch) : null,
        packSettings: settings,
        ...(spec && { packSpec: spec }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["item", itemId] }),
  });

  const model = (files.data ?? []).find((f) => f.kind === "cad" || f.kind === "mesh");
  const measure = async () => {
    if (!model) return;
    setMeasuring("Measuring the 3D model…");
    try {
      const { measureModel } = await import("../components/Viewer3D.tsx");
      const prepared = model.kind === "cad" && model.preview === "ready";
      const m = await measureModel(prepared ? `${fileUrl(model.id)}/preview` : fileUrl(model.id), model.fileName, prepared);
      const r = (v: number) => String(Math.round(v * 10) / 10);
      setPart((p) => ({ ...p, l: r(m.dims[0]), w: r(m.dims[1]), h: r(m.dims[2]) }));
      setMeasuring(`Measured ${model.fileName}: ${num(m.dims[0], 1)} × ${num(m.dims[1], 1)} × ${num(m.dims[2], 1)} mm. Check the units, and set the weight.`);
    } catch (e) {
      setMeasuring((e as Error).message);
    }
  };

  const runFit = () => {
    if (!packPart || !study) return;
    const pallet = active.find((a) => a.id === (selected?.pallet.id ?? study.pallets[0]));
    const vehicle = active.find((a) => a.id === (selected?.vehicle.id ?? study.vehicles[0]));
    if (!pallet || !vehicle) return;
    const found = bestCartons(packPart, toPallet(pallet), toVehicle(vehicle), study, { min: study.winMin, max: study.winMax });
    setFitted(found);
    if (found[0]) setSelKey(keyOf(found[0]));
  };

  if (assets.isLoading || parts.isLoading || (itemId && item.isLoading) || !study) return <Loading />;
  if (assets.error) return <ErrorNote error={assets.error} />;
  const set = <K extends keyof Study>(k: K, v: Study[K]) => setStudy({ ...study, [k]: v });
  const toggle = (k: "containers" | "pallets" | "vehicles", id: string) => set(k, study[k].includes(id) ? study[k].filter((x) => x !== id) : [...study[k], id]);
  const best = options[0];
  const oneWay = options.find((o) => !o.container.returnable);
  const returnable = options.find((o) => o.container.returnable);
  const spec = item.data?.packSpec;

  const PANELS: { key: Panel; label: string; icon: typeof Box }[] = [
    { key: "part", label: "Part", icon: Ruler },
    { key: "pack", label: "Packing", icon: Layers },
    { key: "ship", label: "Shipping", icon: Truck },
    { key: "compare", label: "Compare", icon: ListChecks },
    { key: "payback", label: "Payback", icon: Repeat },
  ];
  const sel = selected;

  return (
    <div ref={fillRef} style={fillHeight ? { height: fillHeight } : undefined} className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)_minmax(0,340px)]">
      {/* Left: one settings section at a time, chosen from the icon strip. */}
      <aside className="flex min-h-0 overflow-hidden rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
        <nav className="flex w-[68px] shrink-0 flex-col gap-1 border-r border-line bg-panel-2/60 p-1.5" aria-label="Study settings">
          {PANELS.map((x) => (
            <button
              key={x.key}
              type="button"
              aria-pressed={panel === x.key}
              onClick={() => setPanel(x.key)}
              className={cx("flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[11px] font-medium transition", panel === x.key ? "bg-accent text-accent-ink shadow-sm" : "text-muted hover:bg-panel hover:text-ink")}
            >
              <x.icon className="h-5 w-5" aria-hidden />
              {x.label}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto p-4">
          {panel === "part" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Part</h2>
              <Field label="Part">
                <Select value={itemId} onChange={(e) => setParams(e.target.value ? { item: e.target.value } : {})}>
                  <option value="">Type a size without a part</option>
                  {(parts.data ?? []).filter((p) => p.type !== "service").map((p) => (
                    <option key={p.id} value={p.id}>{p.partNumber} · {p.description}</option>
                  ))}
                </Select>
              </Field>
              {itemId && model && (
                <Button onClick={measure} className="w-full"><Ruler className="h-4 w-4" /> Measure from the 3D model</Button>
              )}
              {measuring && <p className="text-xs text-muted">{measuring}</p>}
              <div className="grid grid-cols-3 gap-2">
                <Num label="Length mm" value={part.l} onChange={(v) => setPart({ ...part, l: v })} />
                <Num label="Width mm" value={part.w} onChange={(v) => setPart({ ...part, w: v })} />
                <Num label="Height mm" value={part.h} onChange={(v) => setPart({ ...part, h: v })} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Weight kg" value={part.weight} onChange={(v) => setPart({ ...part, weight: v })} step="0.001" />
                {study.method === "nest" && <Num label="Nest step mm" value={part.nestPitch} onChange={(v) => setPart({ ...part, nestPitch: v })} hint="Height each extra part adds" />}
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={part.upright} onChange={(e) => setPart({ ...part, upright: e.target.checked })} /> This side up (height stays vertical)</label>
              {!packPart && <p className="rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Enter the part's length, width, height and weight to see packing options.</p>}
              {spec && (
                <p className="flex gap-2 rounded-lg bg-ok-soft px-3 py-2 text-xs text-ink"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /> <span>Saved packing for this part: <b>{spec.perBox} per {spec.container.code}</b>, {spec.boxesPerPallet} per pallet, {cost4(spec.costPerPart)} a part.</span></p>
              )}
            </div>
          )}
          {panel === "pack" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">How to pack</h2>
              <div className="space-y-1.5">
                {METHODS.map(([k, l, d]) => (
                  <label key={k} className={cx("flex cursor-pointer gap-2 rounded-lg px-3 py-2 ring-1", study.method === k ? "bg-accent-soft ring-accent" : "ring-line hover:bg-panel-2")}>
                    <input type="radio" name="method" checked={study.method === k} onChange={() => set("method", k)} className="mt-1" />
                    <span><span className="text-sm font-medium">{l}</span><span className="block text-xs text-muted">{d}</span></span>
                  </label>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Num label="Clearance mm" value={String(study.margin)} onChange={(v) => set("margin", Number(v) || 0)} hint="Around each part" />
                {study.method === "cells" ? (
                  <Num label="Divider mm" value={String(study.dividerThickness)} onChange={(v) => set("dividerThickness", Number(v) || 0)} />
                ) : (
                  <Num label="Layer pad mm" value={String(study.padThickness)} onChange={(v) => set("padThickness", Number(v) || 0)} hint="0 = none" />
                )}
                <Num label="Lift limit kg" value={String(study.boxWeightCap)} onChange={(v) => set("boxWeightCap", Number(v) || 0)} hint="Cartons and totes" />
                <Num label="Stack safety" value={String(study.safetyFactor)} onChange={(v) => set("safetyFactor", Number(v) || 1)} hint="Cartons, ×" />
              </div>
              {study.method === "nest" && !part.nestPitch && <p className="text-xs text-muted">Set the nest step on the Part tab.</p>}
            </div>
          )}
          {panel === "ship" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Shipping</h2>
              <Num label="Parts in this shipment" value={String(study.shipQty)} onChange={(v) => set("shipQty", Math.max(0, Math.floor(Number(v) || 0)))} hint="0 = cost a full truck" />
              <Field label="Freight priced">
                <Select value={study.freightMode} onChange={(e) => set("freightMode", e.target.value as Study["freightMode"])}>
                  <option value="pallet">Per pallet (part loads)</option>
                  <option value="load">Per truck (full loads)</option>
                </Select>
              </Field>
              {study.freightMode === "pallet" ? (
                <Num label="Price per pallet" value={String(study.freightPerPallet)} onChange={(v) => set("freightPerPallet", Number(v) || 0)} />
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  <Num label="Fixed" value={String(study.freightFixed)} onChange={(v) => set("freightFixed", Number(v) || 0)} />
                  <Num label="Per km" value={String(study.freightPerKm)} onChange={(v) => set("freightPerKm", Number(v) || 0)} />
                  <Num label="km" value={String(study.distanceKm)} onChange={(v) => set("distanceKm", Number(v) || 0)} />
                </div>
              )}
              <Num label="Wrap per pallet" value={String(study.wrapCostPerPallet)} onChange={(v) => set("wrapCostPerPallet", Number(v) || 0)} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={study.stackPallets} onChange={(e) => set("stackPallets", e.target.checked)} /> Pallets may be stacked in the truck</label>
            </div>
          )}
          {panel === "compare" && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-semibold">Compare</h2>
                <Link to="/packaging?view=library" className="text-sm text-accent hover:underline">Edit library</Link>
              </div>
              {(["containers", "pallets", "vehicles"] as const).map((k) => {
                const kinds: PackAsset["kind"][] = k === "containers" ? ["carton", "tote", "crate"] : k === "pallets" ? ["pallet"] : ["vehicle"];
                const list = active.filter((a) => kinds.includes(a.kind));
                return (
                  <fieldset key={k} className="mb-4 last:mb-0">
                    <legend className="mb-1 flex w-full items-center justify-between text-xs font-medium text-muted">
                      <span>{k === "containers" ? "Containers" : k === "pallets" ? "Pallets" : "Trucks and containers"}</span>
                      <span className="space-x-2">
                        <button type="button" className="hover:text-accent" onClick={() => set(k, list.map((a) => a.id))}>All</button>
                        <button type="button" className="hover:text-accent" onClick={() => set(k, [])}>None</button>
                      </span>
                    </legend>
                    <div className="space-y-0.5">
                      {list.map((a) => (
                        <label key={a.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-panel-2">
                          <input type="checkbox" checked={study[k].includes(a.id)} onChange={() => toggle(k, a.id)} />
                          <span className="num min-w-0 flex-1 truncate" title={a.name}>{a.code} <span className="text-muted">{a.name}</span></span>
                          {a.returnable && <Badge tone="ok">Returnable</Badge>}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
              <div className="mt-2 rounded-lg bg-panel-2 p-3 text-xs text-muted">
                <div className="mb-1.5 font-medium text-ink">Made-to-size carton search</div>
                Sides from
                <input aria-label="Smallest carton side, mm" type="number" min={50} value={study.winMin} onChange={(e) => set("winMin", Number(e.target.value) || 0)} className="num mx-1 w-16 rounded-md bg-panel px-1.5 py-0.5 ring-1 ring-line" />
                to
                <input aria-label="Largest carton side, mm" type="number" min={100} value={study.winMax} onChange={(e) => set("winMax", Number(e.target.value) || 0)} className="num mx-1 w-16 rounded-md bg-panel px-1.5 py-0.5 ring-1 ring-line" />
                mm.
              </div>
            </div>
          )}
          {panel === "payback" && (
            <div className="space-y-3">
              <h2 className="text-base font-semibold">Returnable or one-way?</h2>
              {oneWay && returnable ? (
                <Roi oneWay={oneWay} returnable={returnable} annualParts={study.annualParts} cycleDays={study.cycleDays} onAnnual={(v) => set("annualParts", v)} onCycle={(v) => set("cycleDays", v)} />
              ) : (
                <p className="text-sm text-muted">Tick at least one returnable tote and one one-way container under Compare to see the payback.</p>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Centre: the 3D workspace. */}
      <section className="relative min-h-[460px] overflow-hidden rounded-xl bg-gradient-to-b from-panel-2 to-panel shadow-panel ring-1 ring-line/70 lg:min-h-0">
        {sel ? (
          <div data-packview className="absolute inset-0">
            <PackView3D option={sel} mode={mode} explode={explode} className="h-full w-full" />
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <Boxes className="h-10 w-10 text-accent" />
            <p className="max-w-sm text-sm">{packPart ? "Nothing in the selection fits this part. Choose larger containers under Compare." : "Choose a part and enter its size and weight on the left. The best way to pack it appears here in 3D."}</p>
          </div>
        )}
        {sel && (
          <>
            <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
              <div className="pointer-events-auto rounded-xl bg-panel/95 p-1 shadow-panel ring-1 ring-line">
                <PillTabs<PackViewMode> tabs={[{ key: "box", label: "Inside" }, { key: "pallet", label: "Pallet" }, { key: "truck", label: "Truck" }]} value={mode} onChange={setMode} />
              </div>
              <div className="pointer-events-auto max-w-[60%] rounded-lg bg-panel/95 px-3 py-1.5 text-right text-xs shadow-panel ring-1 ring-line">
                <div className="truncate font-medium text-ink">{sel.container.name}</div>
                <div className="text-muted">
                  {mode === "box" && `${sel.box.perLayer} a layer × ${sel.box.layers} ${sel.box.layers === 1 ? "layer" : "layers"}${sel.box.perStack > 1 ? ` × ${sel.box.perStack} nested` : ""} · fill ${num(sel.box.fill * 100, 0)}%`}
                  {mode === "pallet" && `${sel.pallet.name.split(" · ")[0]} · ${sel.palletLoad.perLayer} a layer × ${sel.palletLoad.layers} · ${num(sel.palletLoad.height, 0)} mm · ${num(sel.palletLoad.gross, 0)} kg`}
                  {mode === "truck" && `${sel.vehicle.name.split(" · ")[0]} · ${sel.load.perFloor} on the floor${sel.load.tiers > 1 ? ` × ${sel.load.tiers} high` : ""} · ${sel.load.pallets} pallets`}
                </div>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
              <div className="pointer-events-auto grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                <Chip label="Cost per part" value={cost4(sel.rankCost)} strong />
                <Chip label="Per container" value={num(sel.box.count, 0)} />
                <Chip label="Per pallet" value={num(sel.partsPerPallet, 0)} />
                <Chip label="Per truck" value={num(sel.partsPerLoad, 0)} />
              </div>
              {mode !== "truck" && (
                <label className="pointer-events-auto flex items-center gap-2 rounded-lg bg-panel/95 px-3 py-1.5 text-xs shadow-panel ring-1 ring-line">
                  Spread layers
                  <input type="range" min={0} max={1} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
                </label>
              )}
            </div>
          </>
        )}
      </section>

      {/* Right: the options, cheapest first, and what the selected one costs. */}
      <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-panel shadow-panel ring-1 ring-line/70">
        <div className="shrink-0 space-y-2 border-b border-line p-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold"><Boxes className="h-4 w-4 text-accent" /> Options</h2>
            <span className="text-xs text-muted">{options.length ? `${options.length}, cheapest first` : ""}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button onClick={runFit} disabled={!packPart || !study.pallets.length || !study.vehicles.length} className="col-span-2"><Sparkles className="h-4 w-4" /> Find best carton size</Button>
            {itemId && <Button variant="primary" onClick={() => savePacking.mutate(true)} disabled={!sel || savePacking.isPending}><Check className="h-4 w-4" /> Use for part</Button>}
            <Button onClick={() => sel && printReport(sel, item.data ?? null, packPart!, study)} disabled={!sel} className={itemId ? "" : "col-span-2"}><Printer className="h-4 w-4" /> Report</Button>
          </div>
          {itemId && (
            <div className="flex items-center justify-between text-xs">
              <button type="button" onClick={() => savePacking.mutate(false)} disabled={savePacking.isPending} className="inline-flex items-center gap-1 text-muted hover:text-accent"><Save className="h-3.5 w-3.5" /> Save inputs only</button>
              {savePacking.isSuccess && <span className="text-ok">Saved</span>}
            </div>
          )}
          <ErrorNote error={savePacking.error} />
        </div>
        <ul className="min-h-[200px] flex-1 space-y-1.5 overflow-y-auto p-2" aria-label="Packing options">
          {options.slice(0, 80).map((o, i) => {
            const k = keyOf(o);
            const on = sel && keyOf(sel) === k;
            const limits = [o.box.limitedBy === "weight" && "lift weight", o.palletLoad.limitedBy !== "height" && `pallet ${LIMIT_LABEL[o.palletLoad.limitedBy]}`, o.load.limitedBy === "weight" && "truck payload"].filter(Boolean);
            return (
              <li key={k}>
                <button type="button" onClick={() => setSelKey(k)} aria-pressed={!!on} className={cx("w-full rounded-lg px-3 py-2 text-left ring-1 transition", on ? "bg-accent-soft ring-2 ring-accent" : "ring-line hover:bg-panel-2")}>
                  <div className="flex items-center gap-1.5">
                    {i === 0 && <Badge tone="ok">Best</Badge>}
                    {o.container.id.startsWith("fit-") && <Badge tone="accent">Made to size</Badge>}
                    {o.container.returnable && <Badge tone="ok">Returnable</Badge>}
                    <span className="num ml-auto text-sm font-semibold">{cost4(o.rankCost)}</span>
                  </div>
                  <div className="mt-1 truncate text-sm font-medium" title={o.container.name}>{o.container.name}</div>
                  <div className="mt-0.5 flex justify-between gap-2 text-xs text-muted">
                    <span className="truncate">{o.pallet.name.split(" · ")[0]} · {o.vehicle.name.split(" · ")[0]}</span>
                    <span className="num shrink-0">{num(o.box.count, 0)} / {num(o.partsPerPallet, 0)} / {num(o.partsPerLoad, 0)}</span>
                  </div>
                  {limits.length > 0 && <div className="mt-0.5 text-[11px] text-warn">Limited by {limits.join(", ")}</div>}
                </button>
              </li>
            );
          })}
          {!options.length && <li className="px-3 py-8 text-center text-sm text-muted">{packPart ? "Nothing fits. Choose larger containers under Compare." : "Enter the part size to compare options."}</li>}
        </ul>
        {sel && (
          <details className="shrink-0 border-t border-line p-3" open={tallScreen}>
            <summary className="cursor-pointer text-sm font-semibold">Cost per part and instruction</summary>
            <dl className="mt-2 space-y-1 text-sm">
              <Line label={sel.container.returnable ? "Container trips and wear" : "Container"} value={cost4(sel.perPart.container)} />
              <Line label="Pads and dividers" value={cost4(sel.perPart.dunnage)} />
              <Line label="Pallet and wrap" value={cost4(sel.perPart.pallet)} />
              <Line label="Freight" value={cost4(sel.perPart.freight)} />
              <div className="border-t border-line pt-1"><Line label={<b>On a full truck</b>} value={<b>{cost4(sel.perPart.total)}</b>} /></div>
              {sel.shipment && (
                <Line label={`${num(sel.shipment.qty, 0)} parts: ${sel.shipment.boxes} containers, ${sel.shipment.pallets} ${sel.shipment.pallets === 1 ? "pallet" : "pallets"}`} value={<b>{money(sel.shipment.total)}</b>} />
              )}
            </dl>
            <p className="mt-2 text-xs text-muted">{instruction(sel, study.method)}</p>
          </details>
        )}
      </aside>
    </div>
  );
}

/** A small figure over the 3D view. */
function Chip({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cx("rounded-lg px-3 py-1.5 shadow-panel ring-1", strong ? "bg-accent text-accent-ink ring-accent" : "bg-panel/95 ring-line")}>
      <div className={cx("text-[11px]", strong ? "opacity-85" : "text-muted")}>{label}</div>
      <div className="num text-base font-semibold leading-tight">{value}</div>
    </div>
  );
}

/** On large screens the workspace fills the window below its top edge, so nothing scrolls. */
function useFillHeight() {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [h, setH] = useState<number | null>(null);
  useEffect(() => {
    if (!el) return;
    const measure = () => setH(window.innerWidth < 1024 ? null : Math.max(520, Math.floor(window.innerHeight - el.getBoundingClientRect().top - 28)));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [el]);
  return [setEl, h] as const;
}

function instruction(o: PackOption, method: PackSettings["method"]) {
  const turn = o.box.vertical === "h" ? "standing on its base" : o.box.vertical === "w" ? "on its side" : "on its end";
  const how = method === "cells" ? `one part per cell, ${o.box.perLayer} cells` : method === "nest" ? `${o.box.perLayer} stacks of ${o.box.perStack} nested parts` : `${o.box.perLayer} a layer, ${o.box.layers} ${o.box.layers === 1 ? "layer" : "layers"}${o.box.pads ? " with a pad between layers" : ""}`;
  return `Pack ${o.box.count} parts ${turn} in ${o.container.name.split(" · ")[0]} (${how}), about ${num(o.boxGross, 1)} kg full. Put ${o.palletLoad.boxes} on a ${o.pallet.name.split(" · ")[0]} pallet, ${o.palletLoad.perLayer} a layer, ${num(o.palletLoad.height, 0)} mm tall.`;
}

function Roi({ oneWay, returnable, annualParts, cycleDays, onAnnual, onCycle }: { oneWay: PackOption; returnable: PackOption; annualParts: number; cycleDays: number; onAnnual: (v: number) => void; onCycle: (v: number) => void }) {
  const r = returnableRoi({
    annualParts,
    partsPerContainer: returnable.box.count,
    containerPrice: returnable.container.cost,
    cycleDays,
    oneWayPerPart: oneWay.perPart.total,
    returnablePerPart: returnable.perPart.total - returnable.perPart.capital,
  });
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Num label="Parts a year" value={String(annualParts)} onChange={(v) => onAnnual(Math.max(0, Number(v) || 0))} />
        <Num label="Days a container is away" value={String(cycleDays)} onChange={(v) => onCycle(Math.max(1, Number(v) || 1))} hint="Out, unload, and back" />
      </div>
      <div className="space-y-2 text-sm">
        <p className="text-muted">
          Best one-way: <b className="text-ink">{oneWay.container.name.split(" · ")[0]}</b> at {cost4(oneWay.perPart.total)} a part. Best returnable: <b className="text-ink">{returnable.container.name.split(" · ")[0]}</b> at {cost4(returnable.perPart.total - returnable.perPart.capital)} a part to run, before buying the fleet.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Fleet needed" value={`${num(r.fleet, 0)}`} />
          <MiniStat label="Fleet cost" value={money(r.capital, 0)} />
          <MiniStat label="Saving a year" value={money(r.annualSaving, 0)} tone={r.annualSaving > 0 ? "ok" : "bad"} />
          <MiniStat label="Pays back in" value={r.breakEvenMonths == null ? "Never" : `${num(r.breakEvenMonths, 1)} months`} tone={r.breakEvenMonths == null ? "bad" : r.breakEvenMonths <= 12 ? "ok" : undefined} />
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: ReactNode; tone?: "ok" | "bad" }) {
  return (
    <div className="rounded-lg bg-panel-2 px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={cx("num text-lg font-semibold", tone === "ok" && "text-ok", tone === "bad" && "text-bad")}>{value}</div>
    </div>
  );
}

function Line({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function Num({ label, value, onChange, hint, step = "any" }: { label: string; value: string; onChange: (v: string) => void; hint?: string; step?: string }) {
  return (
    <Field label={label} hint={hint}>
      <Input type="number" min={0} step={step} value={value} onChange={(e) => onChange(e.target.value)} className="num" />
    </Field>
  );
}

// ── One-page report ─────────────────────────────────────────────────────────

function printReport(o: PackOption, item: ItemDetail | null, part: PackPart, s: Study) {
  const canvas = document.querySelector<HTMLCanvasElement>("[data-packview] canvas");
  const img = canvas ? canvas.toDataURL("image/png") : "";
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return;
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`;
  const grade = BOARD_GRADES.find((g) => g.key === o.container.grade);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Packing ${esc(item?.partNumber ?? "study")}</title>
<style>@page{size:A4;margin:14mm}body{font:12px system-ui,sans-serif;color:#111}h1{font-size:20px;margin:0 0 2px}h2{font-size:13px;margin:14px 0 4px;color:#333}.m{color:#555}.g{display:grid;grid-template-columns:1fr 1fr;gap:14px}table{width:100%;border-collapse:collapse}th,td{padding:4px 6px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}th{color:#555;font-weight:500;width:45%}.big{font-size:22px;font-weight:700}img{width:100%;border:1px solid #ddd;border-radius:6px}.box{border:1px solid #ddd;border-radius:6px;padding:8px}</style></head><body>
<h1>Packing report${item ? ` · ${esc(item.partNumber)} rev ${esc(item.revision)}` : ""}</h1>
<div class="m">${esc(item?.description ?? "Part entered by size")} · ${new Date().toLocaleDateString()}</div>
<div class="g" style="margin-top:12px"><div>${img ? `<img src="${img}" alt="">` : ""}</div>
<div><div class="box"><div class="m">Cost per part${o.shipment ? ` (shipping ${o.shipment.qty})` : " (full truck)"}</div><div class="big">${esc(cost4(o.rankCost))}</div></div>
<h2>Part</h2><table>${row("Size", `${part.l} × ${part.w} × ${part.h} mm`)}${row("Weight", `${part.weight} kg`)}${row("Orientation", part.upright ? "This side up" : "Any way up")}</table></div></div>
<div class="g"><div><h2>Container</h2><table>${row("Container", o.container.name)}${row("Inside", `${num(o.container.l, 0)} × ${num(o.container.w, 0)} × ${num(o.container.h, 0)} mm`)}${grade ? row("Board", grade.label) : ""}${row("Parts per container", `${o.box.count} (${o.box.perLayer} × ${o.box.layers}${o.box.perStack > 1 ? ` × ${o.box.perStack}` : ""})`)}${row("Weight full", `${num(o.boxGross, 1)} kg`)}${row("Fill", `${num(o.box.fill * 100, 0)}%`)}</table></div>
<div><h2>Pallet and truck</h2><table>${row("Pallet", o.pallet.name)}${row("Containers per pallet", `${o.palletLoad.boxes} (${o.palletLoad.perLayer} × ${o.palletLoad.layers})`)}${row("Parts per pallet", num(o.partsPerPallet, 0))}${row("Pallet height / weight", `${num(o.palletLoad.height, 0)} mm / ${num(o.palletLoad.gross, 0)} kg`)}${row("Truck", o.vehicle.name)}${row("Pallets per truck", String(o.load.pallets))}${row("Parts per truck", num(o.partsPerLoad, 0))}</table></div></div>
<h2>Cost per part on a full truck</h2><table>${row("Container", cost4(o.perPart.container))}${row("Pads and dividers", cost4(o.perPart.dunnage))}${row("Pallet and wrap", cost4(o.perPart.pallet))}${row("Freight", cost4(o.perPart.freight))}${row("Total", cost4(o.perPart.total))}</table>
${o.shipment ? `<h2>This shipment</h2><table>${row("Parts", String(o.shipment.qty))}${row("Containers / pallets", `${o.shipment.boxes} / ${o.shipment.pallets}`)}${row("Total", money(o.shipment.total))}</table>` : ""}
<h2>Packing instruction</h2><p>${esc(instruction(o, s.method))}</p>
<p class="m">Counts use the part's bounding box with ${s.margin} mm clearance. Check the first pack on the floor.</p></body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

// ── Library ─────────────────────────────────────────────────────────────────

const blankAsset: Omit<PackAsset, "id"> = { kind: "carton", code: "", name: "", l: 0, w: 0, h: 0, wall: 4, tare: 0, maxLoad: 0, maxHeight: 0, cost: 0, returnable: false, tripCost: 0, lifeTrips: 1, grade: "C32", active: true };

function Library() {
  const list = useQuery({ queryKey: ["pack-assets"], queryFn: () => api<PackAsset[]>("/pack-assets") });
  const [edit, setEdit] = useState<(Omit<PackAsset, "id"> & { id?: string }) | null>(null);
  const [kind, setKind] = useState("");
  if (list.isLoading) return <Loading />;
  if (list.error) return <ErrorNote error={list.error} />;
  const rows = (list.data ?? []).filter((a) => !kind || (kind === "containers" ? ["carton", "tote", "crate"].includes(a.kind) : a.kind === kind));
  return (
    <Card
      pad={false}
      title={<span className="flex items-center gap-2"><Box className="h-4 w-4 text-accent" /> Containers, pallets and trucks</span>}
      actions={<Button variant="primary" onClick={() => setEdit({ ...blankAsset, kind: kind === "pallet" || kind === "vehicle" ? kind : "carton" })}><Plus className="h-4 w-4" /> Add</Button>}
    >
      <div className="border-b border-line px-4 py-2">
        <ViewTabs views={[{ key: "", label: "All" }, { key: "containers", label: "Containers" }, { key: "pallet", label: "Pallets" }, { key: "vehicle", label: "Trucks" }]} value={kind} onChange={setKind} />
      </div>
      <Table head={["Code", "Name", "Type", R("Size mm"), R("Empty kg"), R("Max kg"), R("Price"), "Use"]} empty="Nothing here yet.">
        {rows.map((a) => (
          <tr key={a.id} className={cx("cursor-pointer hover:bg-panel-2", !a.active && "opacity-50")} onClick={() => setEdit(a)}>
            <Td className="num font-medium">{a.code}</Td>
            <Td>{a.name}</Td>
            <Td><span className="rounded-md bg-panel-2 px-2 py-0.5 text-xs">{KIND_LABEL[a.kind]}</span></Td>
            <Td right className="num">{num(a.l, 0)} × {num(a.w, 0)} × {num(a.h, 0)}</Td>
            <Td right>{a.kind === "vehicle" ? "—" : num(a.tare, 2)}</Td>
            <Td right>{a.maxLoad ? num(a.maxLoad, 0) : "—"}</Td>
            <Td right>{a.kind === "vehicle" ? "—" : money(a.cost)}</Td>
            <Td>{a.kind === "vehicle" ? "" : a.returnable ? <Badge tone="ok">Returnable · {money(a.tripCost)} a trip</Badge> : <Badge>One-way</Badge>}</Td>
          </tr>
        ))}
      </Table>
      {edit && <AssetModal value={edit} onClose={() => setEdit(null)} />}
    </Card>
  );
}

function AssetModal({ value, onClose }: { value: Omit<PackAsset, "id"> & { id?: string }; onClose: () => void }) {
  const qc = useQueryClient();
  // New items start with empty number boxes rather than "0".
  const [f, setF] = useState(() => Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "number" ? (v === 0 && !value.id ? "" : String(v)) : v])) as Record<string, string | boolean | null>);
  const save = useMutation({
    mutationFn: () => {
      const n = (k: string) => Number(f[k] || 0);
      const body = {
        kind: f.kind, code: f.code, name: f.name,
        l: n("l"), w: n("w"), h: n("h"), wall: n("wall"), tare: n("tare"), maxLoad: n("maxLoad"), maxHeight: n("maxHeight"),
        cost: n("cost"), returnable: !!f.returnable, tripCost: n("tripCost"), lifeTrips: Math.max(1, Math.floor(n("lifeTrips"))),
        grade: f.kind === "carton" ? f.grade || null : null, active: !!f.active,
      };
      return value.id ? api(`/pack-assets/${value.id}`, "PUT", body) : api("/pack-assets", "POST", body);
    },
    onSuccess: () => (qc.invalidateQueries({ queryKey: ["pack-assets"] }), onClose()),
  });
  const k = f.kind as PackAsset["kind"];
  const container = k === "carton" || k === "tote" || k === "crate";
  const fields = save.error instanceof ApiError ? save.error.fields ?? {} : {};
  const N = ({ name, label, hint }: { name: string; label: string; hint?: string }) => (
    <Field label={label} hint={hint} error={fields[name]}>
      <Input type="number" min={0} step="any" className="num" value={String(f[name] ?? "")} onChange={(e) => setF({ ...f, [name]: e.target.value })} />
    </Field>
  );
  return (
    <Modal open title={value.id ? `Edit ${value.code}` : "Add to the packaging library"} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Type">
            <Select value={k} onChange={(e) => setF({ ...f, kind: e.target.value })} disabled={!!value.id}>
              {(Object.keys(KIND_LABEL) as PackAsset["kind"][]).map((x) => <option key={x} value={x}>{KIND_LABEL[x]}</option>)}
            </Select>
          </Field>
          <Field label="Code" error={fields.code}><Input value={String(f.code ?? "")} onChange={(e) => setF({ ...f, code: e.target.value })} required maxLength={30} /></Field>
          <Field label="Name" error={fields.name}><Input value={String(f.name ?? "")} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={120} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {N({ name: "l", label: k === "pallet" ? "Length mm" : "Inside length mm" })}
          {N({ name: "w", label: k === "pallet" ? "Width mm" : "Inside width mm" })}
          {N({ name: "h", label: k === "pallet" ? "Deck height mm" : "Inside height mm" })}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {container && N({ name: "wall", label: "Wall mm" })}
          {k !== "vehicle" && N({ name: "tare", label: "Empty weight kg" })}
          {N({ name: "maxLoad", label: k === "vehicle" ? "Payload kg" : "Max load kg", hint: "0 = no limit" })}
          {k === "pallet" && N({ name: "maxHeight", label: "Max loaded height mm", hint: "Deck included" })}
        </div>
        {k === "carton" && (
          <Field label="Board grade" hint="Used to check how high cartons can be stacked">
            <Select value={String(f.grade ?? "")} onChange={(e) => setF({ ...f, grade: e.target.value || null })}>
              <option value="">Not set (no strength check)</option>
              {BOARD_GRADES.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
            </Select>
          </Field>
        )}
        {k !== "vehicle" && (
          <>
            <div className="grid grid-cols-3 gap-3">
              {N({ name: "cost", label: "Price each" })}
              <label className="mt-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.returnable} onChange={(e) => setF({ ...f, returnable: e.target.checked })} /> Returnable</label>
            </div>
            {f.returnable && (
              <div className="grid grid-cols-3 gap-3">
                {N({ name: "tripCost", label: "Cost per trip", hint: "Return freight, cleaning" })}
                {N({ name: "lifeTrips", label: "Trips it lasts" })}
              </div>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> In use (shown in studies)</label>
        {!Object.keys(fields).length && <ErrorNote error={save.error} />}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={save.isPending}><Pencil className="h-4 w-4" /> {save.isPending ? "Saving…" : "Save"}</Button>
        </div>
      </form>
    </Modal>
  );
}
