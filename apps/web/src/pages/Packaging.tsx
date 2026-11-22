/**
 * Packaging. The library of containers, pallets and trucks lives inside the app; the packing
 * studio is full screen: settings on the left, a large 3D workspace in the middle and the ranked
 * options on the right. Every combination is counted and costed instantly in the browser; the
 * chosen one is saved as the part's packing spec, shown on its jobs, and printed as a report.
 */
import {
  bestCartons,
  BOARD_GRADES,
  bottomLoadKg,
  cartonStrengthN,
  compareOptions,
  DEFAULT_PACK_SETTINGS,
  rankOptions,
  returnableRoi,
  truckFill,
  type PackContainer,
  type PackOption,
  type PackPallet,
  type PackPart,
  type PackSettings,
  type PackVehicle,
} from "@ironline/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Award, BarChart3, Box, Boxes, Check, ChevronRight, Eye, EyeOff, FileText, Pencil, Plus, Printer, Ruler, SlidersHorizontal, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { api, ApiError, type Item, type ItemDetail, type PackAsset, type PackSpec } from "../api.ts";
import { FilePreview, fileUrl, type FileRow } from "../components/Files.tsx";
import { PackView3D, renderStills, type PackViewMode } from "../components/PackView3D.tsx";
import { Badge, Button, Card, cx, ErrorNote, Field, Input, Loading, Modal, R, Select, Table, Td, Textarea, ViewTabs } from "../components/ui.tsx";
import { money, num } from "../format.ts";

const KIND_LABEL: Record<PackAsset["kind"], string> = { carton: "Carton", tote: "Tote", crate: "Crate", pallet: "Pallet", vehicle: "Truck or container" };
const METHODS: [PackSettings["method"], string, string][] = [
  ["layers", "Flat layers", "Parts lie in grid layers, turned whichever way fits most."],
  ["cells", "One per cell", "Each part in its own cell, with board dividers between them."],
  ["nest", "Nested stacks", "Parts that slide into each other, stacked in columns."],
];
const LIMIT_LABEL: Record<string, string> = { space: "space", weight: "weight", height: "height", strength: "box strength", floor: "floor space" };
const cost4 = (n: number | null | undefined) => money(n, n != null && Math.abs(n) < 1 ? 4 : 2);

type Study = PackSettings & { containers: string[]; pallets: string[]; vehicles: string[]; winMin: number; winMax: number; annualParts: number; cycleDays: number };

const toContainer = (a: PackAsset): PackContainer => ({ id: a.id, kind: a.kind as PackContainer["kind"], name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, wall: a.wall, tare: a.tare, maxLoad: a.maxLoad, cost: a.cost, returnable: a.returnable, tripCost: a.tripCost, lifeTrips: a.lifeTrips, grade: a.grade });
const toPallet = (a: PackAsset): PackPallet => ({ id: a.id, name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, tare: a.tare, maxLoad: a.maxLoad, maxHeight: a.maxHeight || a.h + 1500, cost: a.cost, returnable: a.returnable, tripCost: a.tripCost, lifeTrips: a.lifeTrips });
/** A study starts with the largest trailer in the library; others can be ticked on. */
const defaultVehicle = (list: PackAsset[]) => {
  const v = list.filter((a) => a.kind === "vehicle").sort((a, b) => b.l * b.w - a.l * a.w)[0];
  return v ? [v.id] : [];
};
const toVehicle = (a: PackAsset): PackVehicle => ({ id: a.id, name: `${a.code} · ${a.name}`, l: a.l, w: a.w, h: a.h, payload: a.maxLoad });

/** Packaging inside the app: the library, and the way into the full-screen studio. */
export function PackagingPage() {
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Packaging</h1>
          <p className="text-sm text-muted">Your containers, pallets and trucks. Open the studio to work out how to pack a part.</p>
        </div>
        <Link to="/packaging/studio" className="ml-auto inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-ink hover:brightness-110">
          <Boxes className="h-4 w-4" /> Open packing studio
        </Link>
      </div>
      <Library />
    </>
  );
}

// ── Packing studio (full screen) ────────────────────────────────────────────

type Side = "configure" | "results";
type Section = "part" | "pack" | "limits" | "ship" | "returnables" | "compare";

export function PackingStudio() {
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
  const [dunnage, setDunnage] = useState(true);
  const [fitted, setFitted] = useState<PackOption[]>([]);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [side, setSide] = useState<Side>("configure");
  const [open, setOpen] = useState<Record<Section, boolean>>({ part: true, pack: true, limits: false, ship: false, returnables: false, compare: false });
  const [palletFilter, setPalletFilter] = useState<string | null>(null);
  const [report, setReport] = useState(false);

  const active = useMemo(() => (assets.data ?? []).filter((a) => a.active), [assets.data]);

  // A study starts from the part's saved settings, or from sensible defaults — once per part,
  // so saving (which refetches the part) keeps the options and the selection.
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
      objective: "cost",
      ignoreWeight: false,
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
    setPalletFilter(null);
    setSide("configure");
  }, [assets.data, item.data, itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const packPart: PackPart | null = useMemo(() => {
    const l = Number(part.l), w = Number(part.w), h = Number(part.h), weight = Number(part.weight);
    if (!(l > 0 && w > 0 && h > 0) || !(weight >= 0) || part.weight === "") return null;
    return { l, w, h, weight, upright: part.upright, nestPitch: Number(part.nestPitch) > 0 ? Number(part.nestPitch) : null };
  }, [part]);

  const allOptions = useMemo(() => {
    if (!study || !packPart) return [];
    const byId = new Map(active.map((a) => [a.id, a]));
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((a): a is PackAsset => !!a);
    const ranked = rankOptions(packPart, pick(study.containers).map(toContainer), pick(study.pallets).map(toPallet), pick(study.vehicles).map(toVehicle), study);
    return [...ranked, ...fitted].sort(compareOptions(study));
  }, [study, packPart, active, fitted]);
  const options = palletFilter ? allOptions.filter((o) => o.pallet.id === palletFilter) : allOptions;

  // The fitted cartons were sized for the old inputs; clear them when the inputs change.
  useEffect(() => setFitted([]), [packPart, study?.method, study?.margin, study?.padThickness, study?.dividerThickness, study?.ignoreWeight]); // eslint-disable-line react-hooks/exhaustive-deps

  const keyOf = (o: PackOption) => `${o.container.id}|${o.pallet.id}|${o.vehicle.id}`;
  const sel = options.find((o) => keyOf(o) === selKey) ?? options[0] ?? null;

  const savePacking = useMutation({
    mutationFn: (withSpec: boolean) => {
      const o = sel!;
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
      const settings: Record<string, number | string | boolean | string[]> = {};
      for (const [k, v] of Object.entries({ ...rest, containers, pallets, vehicles })) if (v !== undefined) settings[k] = v as number | string | boolean | string[];
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
      setMeasuring(`Measured ${model.fileName}: ${num(m.dims[0], 1)} × ${num(m.dims[1], 1)} × ${num(m.dims[2], 1)} mm. Check the units and which side is up.`);
    } catch (e) {
      setMeasuring((e as Error).message);
    }
  };

  const runFit = () => {
    if (!packPart || !study) return;
    const pallet = active.find((a) => a.id === (palletFilter ?? sel?.pallet.id ?? study.pallets[0]));
    const vehicle = active.find((a) => a.id === (sel?.vehicle.id ?? study.vehicles[0]));
    if (!pallet || !vehicle) return;
    const found = bestCartons(packPart, toPallet(pallet), toVehicle(vehicle), study, { min: study.winMin, max: study.winMax });
    setFitted(found);
    if (found[0]) setSelKey(keyOf(found[0]));
  };

  if (assets.error) return <div className="p-6"><ErrorNote error={assets.error} /></div>;
  if (assets.isLoading || parts.isLoading || (itemId && item.isLoading) || !study) return <div className="p-6"><Loading /></div>;
  const set = <K extends keyof Study>(k: K, v: Study[K]) => setStudy({ ...study, [k]: v });
  const toggle = (k: "containers" | "pallets" | "vehicles", id: string) => set(k, study[k].includes(id) ? study[k].filter((x) => x !== id) : [...study[k], id]);
  const oneWay = allOptions.find((o) => !o.container.returnable);
  const returnable = allOptions.find((o) => o.container.returnable);
  const spec = item.data?.packSpec;
  const sectionProps = (k: Section) => ({ open: open[k], onToggle: () => setOpen({ ...open, [k]: !open[k] }) });
  const selectedPallets = active.filter((a) => study.pallets.includes(a.id));
  const selectedVehicles = active.filter((a) => study.vehicles.includes(a.id));
  const medal = ["text-[#d4a514]", "text-[#9aa4ae]", "text-[#b87333]"];

  return (
    <div className="flex h-dvh flex-col bg-bg text-ink">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3">
        <Link to="/packaging" className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink" title="Back to Ironline">
          <ArrowLeft className="h-4 w-4" /> Ironline
        </Link>
        <div className="h-6 w-px bg-line" />
        <Boxes className="h-5 w-5 text-accent" />
        <span className="hidden font-semibold sm:inline">Packing studio</span>
        <select aria-label="Part" value={itemId} onChange={(e) => setParams(e.target.value ? { item: e.target.value } : {})} className="ml-2 max-w-[260px] truncate rounded-lg bg-panel-2 px-2.5 py-1.5 text-sm ring-1 ring-line">
          <option value="">Part typed by size</option>
          {(parts.data ?? []).filter((p) => p.type !== "service").map((p) => (
            <option key={p.id} value={p.id}>{p.partNumber} · {p.description}</option>
          ))}
        </select>
        <div className="ml-auto flex items-center gap-2">
          <Segmented value={study.objective ?? "cost"} onChange={(v) => set("objective", v)} options={[["cost", "Lowest cost"], ["loadout", "Most per truck"]]} label="Rank options by" />
          <Segmented value={study.ignoreWeight ? "ignore" : "use"} onChange={(v) => set("ignoreWeight", v === "ignore")} options={[["use", "Weight limits on"], ["ignore", "Ignore weight"]]} label="Weight limits" />
          <Link to="/packaging" className="hidden rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-panel-2 hover:text-ink md:inline">Library</Link>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[340px_minmax(0,1fr)_340px] lg:overflow-hidden xl:grid-cols-[370px_minmax(0,1fr)_370px]">
        {/* Left: configure or read the results */}
        <aside className="flex min-h-0 flex-col border-r border-line bg-panel max-lg:min-h-[75dvh]">
          <div className="grid shrink-0 grid-cols-2 gap-1 p-2">
            {(["configure", "results"] as const).map((k) => (
              <button key={k} type="button" aria-pressed={side === k} onClick={() => setSide(k)} className={cx("flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium", side === k ? "bg-accent text-accent-ink" : "bg-panel-2 text-muted hover:text-ink")}>
                {k === "configure" ? <SlidersHorizontal className="h-4 w-4" /> : <BarChart3 className="h-4 w-4" />}
                {k === "configure" ? "Configure" : "Results"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 pb-3">
            {side === "configure" ? (
              <>
                {!packPart && <p className="mx-1 rounded-lg bg-warn-soft px-3 py-2 text-xs text-warn">Enter the part's length, width, height and weight to see packing options.</p>}
                <Fold title="Part" {...sectionProps("part")}>
                  {itemId && model && <Button onClick={measure} className="w-full"><Ruler className="h-4 w-4" /> Measure from the 3D model</Button>}
                  {measuring && <p className="text-xs text-muted">{measuring}</p>}
                  <div className="grid grid-cols-3 gap-2">
                    <Num label="Length mm" value={part.l} onChange={(v) => setPart({ ...part, l: v })} />
                    <Num label="Width mm" value={part.w} onChange={(v) => setPart({ ...part, w: v })} />
                    <Num label="Height mm" value={part.h} onChange={(v) => setPart({ ...part, h: v })} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Weight kg" value={part.weight} onChange={(v) => setPart({ ...part, weight: v })} step="0.001" />
                    <Num label="Nest step mm" value={part.nestPitch} onChange={(v) => setPart({ ...part, nestPitch: v })} hint="Nested stacks only" />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={part.upright} onChange={(e) => setPart({ ...part, upright: e.target.checked })} /> This side up (height stays vertical)</label>
                  {spec && <p className="flex gap-2 rounded-lg bg-ok-soft px-3 py-2 text-xs"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" /><span>Saved for this part: <b>{spec.perBox} per {spec.container.code}</b>, {spec.boxesPerPallet} per pallet, {cost4(spec.costPerPart)} a part.</span></p>}
                </Fold>
                <Fold title="Packing" {...sectionProps("pack")}>
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
                      <Num label="Divider mm" value={String(study.dividerThickness)} onChange={(v) => set("dividerThickness", Number(v) || 0)} hint="Board between cells" />
                    ) : (
                      <Num label="Layer pad mm" value={String(study.padThickness)} onChange={(v) => set("padThickness", Number(v) || 0)} hint="0 = no pads" />
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Pad board per m²" value={String(study.padCostPerM2)} onChange={(v) => set("padCostPerM2", Number(v) || 0)} />
                    <Num label="Divider board per m²" value={String(study.dividerCostPerM2)} onChange={(v) => set("dividerCostPerM2", Number(v) || 0)} />
                  </div>
                </Fold>
                <Fold title="Limits" {...sectionProps("limits")}>
                  <div className="grid grid-cols-2 gap-2">
                    <Num label="Lift limit kg" value={String(study.boxWeightCap)} onChange={(v) => set("boxWeightCap", Number(v) || 0)} hint="Cartons and totes; 0 = none" />
                    <Num label="Stack safety ×" value={String(study.safetyFactor)} onChange={(v) => set("safetyFactor", Number(v) || 1)} hint="Carton strength" />
                  </div>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!study.ignoreWeight} onChange={(e) => set("ignoreWeight", e.target.checked)} /> Ignore all weight limits</label>
                </Fold>
                <Fold title="Shipping" {...sectionProps("ship")}>
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
                </Fold>
                <Fold title="Returnables" {...sectionProps("returnables")}>
                  {oneWay && returnable ? (
                    <Roi oneWay={oneWay} returnable={returnable} annualParts={study.annualParts} cycleDays={study.cycleDays} onAnnual={(v) => set("annualParts", v)} onCycle={(v) => set("cycleDays", v)} />
                  ) : (
                    <p className="text-sm text-muted">Tick at least one returnable tote and one one-way container under Containers to compare them.</p>
                  )}
                </Fold>
                <Fold title="Containers, pallets and trucks" {...sectionProps("compare")}>
                  {(["containers", "pallets", "vehicles"] as const).map((k) => {
                    const kinds: PackAsset["kind"][] = k === "containers" ? ["carton", "tote", "crate"] : k === "pallets" ? ["pallet"] : ["vehicle"];
                    const list = active.filter((a) => kinds.includes(a.kind));
                    return (
                      <fieldset key={k}>
                        <legend className="mb-1 flex w-full items-center justify-between text-xs font-medium text-muted">
                          <span>{k === "containers" ? "Containers" : k === "pallets" ? "Pallets" : "Trucks and containers"}</span>
                          <span className="space-x-2">
                            <button type="button" className="hover:text-accent" onClick={() => set(k, list.map((a) => a.id))}>All</button>
                            <button type="button" className="hover:text-accent" onClick={() => set(k, [])}>None</button>
                          </span>
                        </legend>
                        {list.map((a) => (
                          <label key={a.id} className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-panel-2">
                            <input type="checkbox" checked={study[k].includes(a.id)} onChange={() => toggle(k, a.id)} />
                            <span className="num min-w-0 flex-1 truncate" title={a.name}>{a.code} <span className="text-muted">{a.name}</span></span>
                            {a.returnable && <Badge tone="ok">Returnable</Badge>}
                          </label>
                        ))}
                      </fieldset>
                    );
                  })}
                  <div className="rounded-lg bg-panel-2 p-2.5 text-xs text-muted">
                    Made-to-size cartons: sides from
                    <input aria-label="Smallest carton side, mm" type="number" min={50} value={study.winMin} onChange={(e) => set("winMin", Number(e.target.value) || 0)} className="num mx-1 w-16 rounded-md bg-panel px-1.5 py-0.5 ring-1 ring-line" />
                    to
                    <input aria-label="Largest carton side, mm" type="number" min={100} value={study.winMax} onChange={(e) => set("winMax", Number(e.target.value) || 0)} className="num mx-1 w-16 rounded-md bg-panel px-1.5 py-0.5 ring-1 ring-line" />
                    mm
                  </div>
                  <Link to="/packaging" className="block text-sm text-accent hover:underline">Edit the library</Link>
                </Fold>
              </>
            ) : sel ? (
              <Results o={sel} study={study} part={packPart!} itemName={item.data ? `${item.data.partNumber} · ${item.data.description}` : "Part typed by size"} onReport={() => setReport(true)} onUse={itemId ? () => savePacking.mutate(true) : undefined} saving={savePacking.isPending} saved={savePacking.isSuccess} error={savePacking.error} />
            ) : (
              <p className="px-2 py-8 text-center text-sm text-muted">No option yet. Fill in the part under Configure.</p>
            )}
          </div>
        </aside>

        {/* Centre: the big 3D workspace */}
        <section className="relative min-h-[420px] overflow-hidden bg-gradient-to-b from-panel-2 to-bg lg:min-h-0">
          {sel ? (
            <div data-packview className="absolute inset-0">
              <PackView3D option={sel} mode={mode} explode={explode} dunnage={dunnage} className="h-full w-full" />
            </div>
          ) : itemId && model && !packPart ? (
            <div className="absolute inset-0"><FilePreview file={model} immersive /></div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <Boxes className="h-12 w-12 text-accent" />
              <p className="max-w-sm text-sm">{packPart ? "Nothing in the selection fits this part. Turn on larger containers under Containers, pallets and trucks." : "Choose a part at the top and enter its size and weight. The best way to pack it appears here in 3D."}</p>
            </div>
          )}
          {sel && (
            <>
              <div className="pointer-events-none absolute left-4 top-3 max-w-[70%]">
                <div className="truncate text-base font-semibold">{sel.container.name}</div>
                <div className="num text-sm text-muted">
                  {mode === "box" && `Outside ${num(sel.outer.l, 0)} × ${num(sel.outer.w, 0)} × ${num(sel.outer.h, 0)} mm · ${sel.box.count} parts · fill ${num(sel.box.fill * 100, 0)}%`}
                  {mode === "pallet" && `${sel.pallet.name} · ${sel.palletLoad.boxes} containers · ${num(sel.pallet.l, 0)} × ${num(sel.pallet.w, 0)} × ${num(sel.palletLoad.height, 0)} mm`}
                  {mode === "truck" && `${sel.vehicle.name} · ${sel.load.pallets} pallets · ${num(sel.partsPerLoad, 0)} parts · ${num(truckFill(sel) * 100, 0)}% of the space`}
                </div>
              </div>
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-end justify-between gap-2">
                <div className="pointer-events-auto flex flex-wrap items-end gap-2">
                <div className="flex overflow-hidden rounded-lg bg-panel shadow-panel ring-1 ring-line" role="tablist" aria-label="View">
                  {(["box", "pallet", "truck"] as const).map((k) => (
                    <button key={k} type="button" role="tab" aria-selected={mode === k} onClick={() => setMode(k)} className={cx("px-4 py-2 text-sm font-medium", mode === k ? "bg-accent text-accent-ink" : "hover:bg-panel-2")}>
                      {k === "box" ? "Box" : k === "pallet" ? "Pallet" : "Truck"}
                    </button>
                  ))}
                </div>
                {mode === "box" && (
                  <button type="button" aria-pressed={dunnage} onClick={() => setDunnage(!dunnage)} className="inline-flex items-center gap-1.5 rounded-lg bg-panel px-3 py-2 text-sm shadow-panel ring-1 ring-line hover:bg-panel-2">
                    {dunnage ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />} {dunnage ? "Hide dividers" : "Show dividers"}
                  </button>
                )}
                {mode !== "truck" && (
                  <label className="flex items-center gap-2 rounded-lg bg-panel px-3 py-2 text-sm shadow-panel ring-1 ring-line">
                    Spread
                    <input type="range" min={0} max={1} step={0.05} value={explode} onChange={(e) => setExplode(Number(e.target.value))} />
                  </label>
                )}
                </div>
                <div className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-right text-accent-ink shadow-panel">
                  <div className="text-[11px] opacity-85">Cost per part</div>
                  <div className="num text-lg font-semibold leading-tight">{cost4(sel.rankCost)}</div>
                </div>
              </div>

            </>
          )}
        </section>

        {/* Right: options, pallets and truck */}
        <aside className="flex min-h-0 flex-col border-l border-line bg-panel max-lg:min-h-[85dvh]">
          <div className="shrink-0 space-y-2 border-b border-line p-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold">Packaging options</h2>
              <span className="text-xs text-muted">{options.length} · {study.objective === "loadout" ? "most per truck first" : "cheapest first"}</span>
            </div>
            <Button onClick={runFit} disabled={!packPart || !study.pallets.length || !study.vehicles.length} className="w-full"><Sparkles className="h-4 w-4" /> Find best carton size</Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Packing options">
            {options.slice(0, 100).map((o, i) => {
              const k = keyOf(o);
              const on = sel && keyOf(sel) === k;
              return (
                <li key={k} className="border-b border-line">
                  <button type="button" aria-pressed={!!on} onClick={() => setSelKey(k)} className={cx("w-full px-3 py-2 text-left", on ? "bg-accent-soft" : "hover:bg-panel-2")}>
                    <div className="flex items-center gap-1.5">
                      <span className={cx("min-w-0 flex-1 truncate text-sm font-semibold", on ? "text-accent" : "")} title={o.container.name}>{o.container.name.split(" · ")[0]}</span>
                      {o.container.id.startsWith("fit-") && <Badge tone="accent">Made to size</Badge>}
                      {o.container.returnable && <Badge tone="ok">Returnable</Badge>}
                      {i < 3 && <Award className={cx("h-4 w-4 shrink-0", medal[i])} aria-label={["Best", "Second", "Third"][i]} />}
                    </div>
                    <dl className="num mt-1 grid grid-cols-[1fr_auto] gap-x-3 text-xs">
                      <dt className="text-muted">Outside</dt><dd className="text-right">{num(o.outer.l, 0)} × {num(o.outer.w, 0)} × {num(o.outer.h, 0)} mm</dd>
                      <dt className="text-muted">Cost per part</dt><dd className="text-right font-semibold">{cost4(o.rankCost)}</dd>
                      <dt className="text-muted">Per container (per truck)</dt><dd className="text-right">{num(o.box.count, 0)} ({num(o.partsPerLoad, 0)})</dd>
                      <dt className="text-muted">Pallet</dt><dd className="text-right">{o.pallet.name.split(" · ")[0]}</dd>
                    </dl>
                  </button>
                </li>
              );
            })}
            {!options.length && <li className="px-3 py-8 text-center text-sm text-muted">{packPart ? "Nothing fits. Turn on more containers." : "Enter the part size to see options."}</li>}
          </ul>
          <div className="shrink-0 border-t border-line">
            <div className="flex items-center justify-between px-3 pt-2 text-xs font-medium text-muted">
              <span>Pallets</span>
              {palletFilter && <button type="button" className="text-accent hover:underline" onClick={() => setPalletFilter(null)}>Show all</button>}
            </div>
            <ul className="max-h-32 overflow-y-auto px-1.5 py-1">
              {selectedPallets.map((p) => (
                <li key={p.id}>
                  <button type="button" aria-pressed={palletFilter === p.id} onClick={() => setPalletFilter(palletFilter === p.id ? null : p.id)} className={cx("flex w-full justify-between rounded-md px-1.5 py-1 text-sm", palletFilter === p.id ? "bg-accent-soft text-accent" : "hover:bg-panel-2")}>
                    <span className="truncate">{p.name}</span>
                    <span className="num shrink-0 text-xs text-muted">{num(p.l, 0)} × {num(p.w, 0)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="border-t border-line px-3 py-2 text-sm">
              {selectedVehicles.map((v) => (
                <div key={v.id} className="flex justify-between gap-2">
                  <span className="truncate">{v.name}</span>
                  <span className="num shrink-0 text-xs text-muted">{num(v.l / 1000, 1)} × {num(v.w / 1000, 2)} × {num(v.h / 1000, 2)} m</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
      {report && sel && <ReportModal o={sel} item={item.data ?? null} part={packPart!} study={study} onClose={() => setReport(false)} />}
    </div>
  );
}

/** Two-choice switch in the top bar. */
function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div role="group" aria-label={label} className="hidden overflow-hidden rounded-lg ring-1 ring-line md:flex">
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cx("px-3 py-1.5 text-xs font-medium", value === v ? "bg-accent text-accent-ink" : "bg-panel text-muted hover:text-ink")}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** A folding section of the left panel. */
function Fold({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <section className="rounded-lg ring-1 ring-line">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-panel-2">
        <ChevronRight className={cx("h-4 w-4 text-muted transition-transform", open && "rotate-90")} /> {title}
      </button>
      {open && <div className="space-y-3 border-t border-line p-3">{children}</div>}
    </section>
  );
}

/** Results for the selected option: container, pallet, truck and cost. */
function Results({ o, study, part, itemName, onReport, onUse, saving, saved, error }: { o: PackOption; study: Study; part: PackPart; itemName: string; onReport: () => void; onUse?: () => void; saving: boolean; saved: boolean; error: unknown }) {
  const grade = BOARD_GRADES.find((g) => g.key === o.container.grade);
  const strengthKg = grade ? cartonStrengthN(o.outer, grade) / 9.81 : null;
  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <div className="flex justify-between gap-3 border-b border-line/60 py-1 text-sm last:border-0">
      <dt className="text-muted">{k}</dt>
      <dd className="num text-right">{v}</dd>
    </div>
  );
  const mm = (d: { l: number; w: number; h: number }) => `${num(d.l, 0)} × ${num(d.w, 0)} × ${num(d.h, 0)} mm`;
  return (
    <div className="space-y-3 px-1">
      <div>
        <div className="truncate text-xs text-muted">{itemName}</div>
        <div className="text-lg font-semibold leading-snug">{o.container.name.split(" · ")[0]}</div>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button onClick={onReport}><FileText className="h-4 w-4" /> Report</Button>
        {onUse ? <Button variant="primary" onClick={onUse} disabled={saving}><Check className="h-4 w-4" /> {saved ? "Saved" : "Use for part"}</Button> : <span />}
      </div>
      <ErrorNote error={error} />
      <div className="rounded-lg bg-accent-soft px-3 py-2">
        <div className="text-xs text-muted">{o.shipment ? `Cost per part, shipping ${num(o.shipment.qty, 0)}` : "Cost per part, full truck"}</div>
        <div className="num text-2xl font-semibold">{cost4(o.rankCost)}</div>
      </div>
      <h3 className="pt-1 text-sm font-semibold">Container</h3>
      <dl>
        <Row k="Outside" v={mm(o.outer)} />
        <Row k="Inside" v={mm(o.container)} />
        {grade && <Row k="Board" v={grade.label} />}
        {grade && <Row k="Crush strength" v={`${num(strengthKg, 0)} kg`} />}
        <Row k="Empty weight" v={`${num(o.container.tare, 2)} kg`} />
        {o.container.maxLoad > 0 && <Row k="Capacity" v={`${num(o.container.maxLoad, 0)} kg`} />}
        <Row k="Price" v={o.container.returnable ? `${money(o.container.cost)} (${money(o.container.tripCost)} a trip)` : money(o.container.cost)} />
        <Row k="Parts" v={`${o.box.count} (${o.box.perLayer} × ${o.box.layers}${o.box.perStack > 1 ? ` × ${o.box.perStack}` : ""})`} />
        <Row k="Turned" v={o.box.vertical === "h" ? "Standing on its base" : o.box.vertical === "w" ? "On its side" : "On its end"} />
        <Row k="Fill" v={`${num(o.box.fill * 100, 1)}%`} />
        <Row k="Parts weight" v={`${num(o.box.count * part.weight, 2)} kg`} />
        <Row k="Weight full" v={`${num(o.boxGross, 2)} kg`} />
        <Row k="Load on the bottom one" v={`${num(bottomLoadKg(o), 1)} kg`} />
      </dl>
      <h3 className="pt-1 text-sm font-semibold">Pallet</h3>
      <dl>
        <Row k="Pallet" v={o.pallet.name} />
        <Row k="Containers a layer" v={o.palletLoad.perLayer} />
        <Row k="Layers" v={o.palletLoad.layers} />
        <Row k="Containers" v={o.palletLoad.boxes} />
        <Row k="Parts" v={num(o.partsPerPallet, 0)} />
        <Row k="Load size" v={`${num(o.pallet.l, 0)} × ${num(o.pallet.w, 0)} × ${num(o.palletLoad.height, 0)} mm`} />
        <Row k="Weight loaded" v={`${num(o.palletLoad.gross, 0)} kg`} />
        <Row k="Limited by" v={LIMIT_LABEL[o.palletLoad.limitedBy]} />
      </dl>
      <h3 className="pt-1 text-sm font-semibold">Truck</h3>
      <dl>
        <Row k="Truck" v={o.vehicle.name} />
        <Row k="Inside" v={mm(o.vehicle)} />
        <Row k="Pallets" v={`${o.load.pallets} (${o.load.perFloor} on the floor${o.load.tiers > 1 ? ` × ${o.load.tiers}` : ""})`} />
        <Row k="Containers" v={num(o.palletLoad.boxes * o.load.pallets, 0)} />
        <Row k="Parts" v={num(o.partsPerLoad, 0)} />
        <Row k="Space used" v={`${num(truckFill(o) * 100, 0)}%`} />
        <Row k="Cargo weight" v={`${num(o.palletLoad.gross * o.load.pallets, 0)} kg`} />
      </dl>
      <h3 className="pt-1 text-sm font-semibold">Cost per part on a full truck</h3>
      <dl>
        <Row k={o.container.returnable ? "Container trips and wear" : "Container"} v={cost4(o.perPart.container)} />
        <Row k="Pads and dividers" v={cost4(o.perPart.dunnage)} />
        <Row k="Pallet and wrap" v={cost4(o.perPart.pallet)} />
        <Row k="Freight" v={cost4(o.perPart.freight)} />
        <Row k="Total" v={<b>{cost4(o.perPart.total)}</b>} />
      </dl>
      <h3 className="pt-1 text-sm font-semibold">Packing instruction</h3>
      <p className="text-sm text-muted">{instruction(o, study.method)}</p>
    </div>
  );
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


// ── Packing report ──────────────────────────────────────────────────────────

/** Preview of the one-page packing report: add a title and notes, then print or save as PDF. */
function ReportModal({ o, item, part, study, onClose }: { o: PackOption; item: ItemDetail | null; part: PackPart; study: Study; onClose: () => void }) {
  const [title, setTitle] = useState(item ? `Packing for ${item.partNumber}` : "Packing study");
  const [notes, setNotes] = useState("");
  const [shots, setShots] = useState<string[] | null>(null);
  useEffect(() => {
    // Draw the pictures once the dialog is on screen.
    const t = setTimeout(() => {
      try {
        setShots(
          renderStills(o, [
            { mode: "box", view: "iso" },
            { mode: "box", view: "front" },
            { mode: "box", view: "side" },
            { mode: "box", view: "top" },
            { mode: "pallet", view: "iso" },
            { mode: "pallet", view: "side" },
            { mode: "pallet", view: "top" },
            { mode: "truck", view: "iso" },
          ]),
        );
      } catch {
        setShots([]);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [o]);
  const lines = reportLines(o, study);
  const grade = BOARD_GRADES.find((g) => g.key === o.container.grade);
  const facts = {
    part: [
      ["Size", `${part.l} × ${part.w} × ${part.h} mm`],
      ["Weight", `${part.weight} kg`],
      ["Packing cost per part", cost4(o.perPart.container + o.perPart.dunnage + o.perPart.pallet)],
      ["Freight per part", cost4(o.perPart.freight)],
      ["Total per part", cost4(o.perPart.total)],
    ],
    box: [
      ["Outside", `${num(o.outer.l, 0)} × ${num(o.outer.w, 0)} × ${num(o.outer.h, 0)} mm`],
      ["Inside", `${num(o.container.l, 0)} × ${num(o.container.w, 0)} × ${num(o.container.h, 0)} mm`],
      ...(grade ? [["Board", grade.label], ["Crush strength", `${num(cartonStrengthN(o.outer, grade) / 9.81, 0)} kg`]] : []),
      ["Price", money(o.container.cost)],
      ["Parts per container", String(o.box.count)],
      ["Pads / dividers", o.box.pads ? `${o.box.pads} pads` : o.box.dividerM2 ? `${num(o.box.dividerM2, 2)} m² dividers` : "None"],
      ["Weight full", `${num(o.boxGross, 1)} kg`],
      ["Load on the bottom one", `${num(bottomLoadKg(o), 1)} kg`],
    ],
    pallet: [
      ["Pallet", o.pallet.name],
      ["Containers per pallet", `${o.palletLoad.boxes} (${o.palletLoad.perLayer} × ${o.palletLoad.layers})`],
      ["Parts per pallet", num(o.partsPerPallet, 0)],
      ["Load size", `${num(o.pallet.l, 0)} × ${num(o.pallet.w, 0)} × ${num(o.palletLoad.height, 0)} mm`],
      ["Weight loaded", `${num(o.palletLoad.gross, 0)} kg`],
    ],
    truck: [
      ["Truck", o.vehicle.name],
      ["Pallets", String(o.load.pallets)],
      ["Containers", num(o.palletLoad.boxes * o.load.pallets, 0)],
      ["Parts", num(o.partsPerLoad, 0)],
      ["Space used", `${num(truckFill(o) * 100, 0)}%`],
      ["Cargo weight", `${num(o.palletLoad.gross * o.load.pallets, 0)} kg`],
    ],
  };
  const print = () => {
    const w = window.open("", "_blank", "width=960,height=1100");
    if (!w || !shots) return;
    const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    const table = (rows: string[][]) => `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`;
    const img = (i: number, cap = "") => (shots[i] ? `<figure><img src="${shots[i]}" alt="">${cap ? `<figcaption>${esc(cap)}</figcaption>` : ""}</figure>` : "");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4;margin:12mm}body{font:11.5px system-ui,sans-serif;color:#111;margin:0}h1{font-size:19px;margin:0}h2{font-size:13px;margin:12px 0 4px;padding-top:8px;border-top:1px solid #ccc}.m{color:#555}.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start}.g3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}table{width:100%;border-collapse:collapse}th,td{padding:3px 5px;border-bottom:1px solid #e3e3e3;text-align:left}th{color:#555;font-weight:500}td.r,th.r{text-align:right}figure{margin:0}img{width:100%;border:1px solid #e3e3e3;border-radius:4px}figcaption{text-align:center;color:#666;font-size:10px}.tot td{font-weight:700}.notes{white-space:pre-wrap;border:1px solid #ddd;border-radius:4px;padding:6px;min-height:30px}.sec{break-inside:avoid}</style></head><body>
<h1>${esc(title)}</h1><div class="m">${esc(item ? `${item.partNumber} rev ${item.revision} · ${item.description}` : "Part entered by size")} · ${new Date().toLocaleDateString()}</div>
<div class="sec"><h2>Part</h2><div class="g2">${table(facts.part)}${img(0)}</div></div>
<div class="sec"><h2>Container · ${esc(o.container.name)}</h2><div class="g2">${table(facts.box)}<div></div></div><div class="g3">${img(1, "Front")}${img(2, "Side")}${img(3, "Top")}</div></div>
<div class="sec"><h2>Pallet</h2><div class="g2">${table(facts.pallet)}${img(4)}</div><div class="g3">${img(5, "Side")}${img(6, "Top")}<div></div></div></div>
<div class="sec"><h2>Truck</h2><div class="g2">${table(facts.truck)}${img(7)}</div>
<table style="margin-top:8px"><tr><th>Line</th><th class="r">Qty</th><th class="r">Each</th><th class="r">Cost</th></tr>${lines.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="r">${esc(r.qty)}</td><td class="r">${esc(r.each)}</td><td class="r">${esc(money(r.total))}</td></tr>`).join("")}<tr class="tot"><td>Cost per truckload</td><td></td><td></td><td class="r">${esc(money(lines.total))}</td></tr></table></div>
<h2>Packing instruction</h2><p>${esc(instruction(o, study.method))}</p>
${notes.trim() ? `<h2>Notes</h2><div class="notes">${esc(notes)}</div>` : ""}
<p class="m">Counts use the part's bounding box with ${study.margin} mm clearance. Check the first pack on the floor.</p></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };
  const Facts = ({ rows }: { rows: string[][] }) => (
    <dl className="text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-3 border-b border-line/60 py-1">
          <dt className="text-muted">{k}</dt>
          <dd className="num text-right">{v}</dd>
        </div>
      ))}
    </dl>
  );
  const Pic = ({ i, cap }: { i: number; cap?: string }) => (
    <figure className="overflow-hidden rounded-lg bg-white ring-1 ring-line">
      {shots?.[i] ? <img src={shots[i]} alt={cap ?? ""} className="w-full" /> : <div className="aspect-[16/11] animate-pulse bg-panel-2" />}
      {cap && <figcaption className="py-1 text-center text-xs text-muted">{cap}</figcaption>}
    </figure>
  );
  return (
    <Modal open wide title="Packing report" onClose={onClose}>
      <div className="max-h-[72vh] space-y-4 overflow-y-auto pr-1">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></Field>
          <Field label="Notes (printed at the end)"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} /></Field>
        </div>
        <section className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-1 font-semibold">Part</h3><Facts rows={facts.part} /></div><Pic i={0} /></section>
        <section><h3 className="mb-1 font-semibold">Container · {o.container.name}</h3><div className="grid gap-4 md:grid-cols-2"><Facts rows={facts.box} /><div /></div><div className="mt-2 grid grid-cols-3 gap-2"><Pic i={1} cap="Front" /><Pic i={2} cap="Side" /><Pic i={3} cap="Top" /></div></section>
        <section className="grid gap-4 md:grid-cols-2"><div><h3 className="mb-1 font-semibold">Pallet</h3><Facts rows={facts.pallet} /><div className="mt-2 grid grid-cols-2 gap-2"><Pic i={5} cap="Side" /><Pic i={6} cap="Top" /></div></div><Pic i={4} /></section>
        <section className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 font-semibold">Truck</h3>
            <Facts rows={facts.truck} />
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-xs text-muted"><th className="py-1 text-left font-medium">Line</th><th className="text-right font-medium">Qty</th><th className="text-right font-medium">Each</th><th className="text-right font-medium">Cost</th></tr></thead>
              <tbody>
                {lines.rows.map((r) => (
                  <tr key={r.label} className="border-t border-line/60"><td className="py-1">{r.label}</td><td className="num text-right">{r.qty}</td><td className="num text-right">{r.each}</td><td className="num text-right">{money(r.total)}</td></tr>
                ))}
                <tr className="border-t border-line font-semibold"><td className="py-1">Cost per truckload</td><td /><td /><td className="num text-right">{money(lines.total)}</td></tr>
              </tbody>
            </table>
          </div>
          <Pic i={7} />
        </section>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>Close</Button>
        <Button variant="primary" onClick={print} disabled={!shots}><Printer className="h-4 w-4" /> {shots ? "Print or save as PDF" : "Drawing pictures…"}</Button>
      </div>
    </Modal>
  );
}

/** What one full truckload costs, line by line. */
function reportLines(o: PackOption, s: Study) {
  const boxes = o.palletLoad.boxes * o.load.pallets;
  const parts = o.partsPerLoad;
  const each = (perPart: number, qty: number) => (qty ? (perPart * parts) / qty : 0);
  const freightTotal = o.perPart.freight * parts;
  const rows = [
    { label: o.container.returnable ? "Container trips" : "Containers", qty: num(boxes, 0), each: money(each(o.perPart.container, boxes)), total: o.perPart.container * parts },
    { label: "Pads and dividers", qty: num(boxes, 0), each: money(each(o.perPart.dunnage, boxes)), total: o.perPart.dunnage * parts },
    { label: "Pallets and wrap", qty: num(o.load.pallets, 0), each: money(each(o.perPart.pallet, o.load.pallets)), total: o.perPart.pallet * parts },
    s.freightMode === "load"
      ? { label: `Freight (${money(s.freightFixed)} + ${num(s.distanceKm, 0)} km × ${money(s.freightPerKm)})`, qty: "1", each: money(freightTotal), total: freightTotal }
      : { label: "Freight per pallet", qty: num(o.load.pallets, 0), each: money(s.freightPerPallet), total: freightTotal },
  ];
  return { rows, total: rows.reduce((a, r) => a + r.total, 0) };
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
