/**
 * Packing maths: how many parts fit in a container, how many containers fit on a pallet, how many
 * pallets fit in a truck, and what that costs per part. Everything works on the part's bounding
 * box (length × width × height) with axis-aligned turns, which is exact for box-like parts and a
 * safe (pessimistic) count for odd shapes. Lengths are millimetres, weights kilograms.
 *
 * Floor layouts use a two-block pattern: one block of rows in one direction and the rest of the
 * floor turned 90°, which is the classic way to fill a pallet or a box floor by hand.
 */

export type Dims = { l: number; w: number; h: number };
export type Rect = { x: number; y: number; l: number; w: number };

export interface PackPart {
  l: number;
  w: number;
  h: number;
  /** kg per part */
  weight: number;
  /** Keep the part's height axis vertical (this side up). */
  upright?: boolean;
  /** For parts that nest into each other: extra height each additional part adds to a stack. */
  nestPitch?: number | null;
}

export type ContainerKind = "carton" | "tote" | "crate";

export interface PackContainer {
  id: string;
  kind: ContainerKind;
  name: string;
  /** inside dimensions */
  l: number;
  w: number;
  h: number;
  /** wall thickness; outside = inside + 2 × wall */
  wall: number;
  /** empty weight, kg */
  tare: number;
  /** most weight of parts it may hold, kg */
  maxLoad: number;
  /** price of one container */
  cost: number;
  returnable: boolean;
  /** returnable only: cost of each round trip (return freight, cleaning) */
  tripCost: number;
  /** returnable only: trips before it is worn out */
  lifeTrips: number;
  /** cartons only: board grade key, used for stacking strength */
  grade?: string | null;
}

export interface PackPallet {
  id: string;
  name: string;
  l: number;
  w: number;
  /** deck height */
  h: number;
  tare: number;
  maxLoad: number;
  /** tallest the loaded pallet may be, deck included */
  maxHeight: number;
  cost: number;
  returnable: boolean;
  tripCost: number;
  lifeTrips: number;
}

export interface PackVehicle {
  id: string;
  name: string;
  l: number;
  w: number;
  h: number;
  /** kg */
  payload: number;
}

export type PackMethod = "layers" | "cells" | "nest";

export interface PackSettings {
  /** layers: flat layers on a grid; cells: one part per divided cell; nest: parts stacked into each other */
  method: PackMethod;
  /** clearance around each part, mm */
  margin: number;
  /** board pad between layers, mm (0 = none) */
  padThickness: number;
  padCostPerM2: number;
  /** cells only: divider thickness, mm */
  dividerThickness: number;
  dividerCostPerM2: number;
  /** heaviest a filled container may be for one person to lift, kg (0 = no limit) */
  boxWeightCap: number;
  /** cartons: stacking safety factor applied to box compression strength */
  safetyFactor: number;
  /** pallets may be stacked on each other in the truck */
  stackPallets: boolean;
  wrapCostPerPallet: number;
  /** load: price for the whole truck; pallet: price per pallet (part loads) */
  freightMode: "load" | "pallet";
  freightFixed: number;
  freightPerKm: number;
  distanceKm: number;
  freightPerPallet: number;
  /** cost a real shipment of this many parts; 0 = cost a full truck */
  shipQty: number;
}

export const DEFAULT_PACK_SETTINGS: PackSettings = {
  method: "layers",
  margin: 2,
  padThickness: 0,
  padCostPerM2: 0.35,
  dividerThickness: 3,
  dividerCostPerM2: 0.45,
  boxWeightCap: 18,
  safetyFactor: 5,
  stackPallets: false,
  wrapCostPerPallet: 3,
  freightMode: "pallet",
  freightFixed: 200,
  freightPerKm: 1.2,
  distanceKm: 160,
  freightPerPallet: 85,
  shipQty: 0,
};

/**
 * Corrugated board grades for cartons. ECT is edge crush in lb/in (the usual published figure);
 * caliper and weight are typical values; price per m² is a starting point to edit.
 */
export const BOARD_GRADES = [
  { key: "B32", label: "Single wall B, ECT 32", ect: 32, caliper: 3, kgPerM2: 0.5, pricePerM2: 0.42 },
  { key: "C32", label: "Single wall C, ECT 32", ect: 32, caliper: 4, kgPerM2: 0.55, pricePerM2: 0.48 },
  { key: "C44", label: "Single wall C, ECT 44", ect: 44, caliper: 4, kgPerM2: 0.65, pricePerM2: 0.62 },
  { key: "BC48", label: "Double wall BC, ECT 48", ect: 48, caliper: 6.5, kgPerM2: 0.9, pricePerM2: 0.85 },
  { key: "BC61", label: "Double wall BC, ECT 61", ect: 61, caliper: 7, kgPerM2: 1.05, pricePerM2: 1.05 },
] as const;
export type BoardGrade = (typeof BOARD_GRADES)[number];
export const gradeOf = (key?: string | null) => BOARD_GRADES.find((g) => g.key === key);

/** Converting cost added to the board price of each made-to-size carton. */
export const CARTON_CONVERSION = 0.35;
const EPS = 1e-6;
const G = 9.81;

/** Board in a regular slotted carton blank, m²: (2L + 2W + 35 mm glue flap) × (H + W for the flaps). */
export function cartonBlankArea(outer: Dims) {
  return ((2 * (outer.l + outer.w) + 35) * (outer.h + outer.w)) / 1e6;
}

/** Price of a made-to-size carton in a board grade. */
export function cartonPrice(outer: Dims, grade: BoardGrade) {
  return round(cartonBlankArea(outer) * grade.pricePerM2 + CARTON_CONVERSION, 4);
}

/** Top-load strength of a carton in newtons (McKee short formula: 5.87 × ECT × √(caliper × perimeter), in lb units). */
export function cartonStrengthN(outer: Dims, grade: BoardGrade) {
  const inch = 25.4;
  const perimeter = (2 * (outer.l + outer.w)) / inch;
  const lbf = 5.87 * grade.ect * Math.sqrt((grade.caliper / inch) * perimeter);
  return lbf * 4.448;
}

// ── Floor layouts ───────────────────────────────────────────────────────────

interface Block { x: number; y: number; nx: number; ny: number; a: number; b: number }

const fit = (len: number, d: number) => (d > 0 ? Math.floor((len + EPS) / d) : 0);

const floorCache = new Map<string, { count: number; rects: Rect[] }>();

/** Most a×b rectangles (either way round) on an L×W floor, with their positions. Results are shared: do not change them. */
export function floorFill(L: number, W: number, a: number, b: number, uniformOnly = false): { count: number; rects: Rect[] } {
  const key = `${L}|${W}|${a}|${b}|${uniformOnly ? 1 : 0}`;
  const hit = floorCache.get(key);
  if (hit) return hit;
  if (floorCache.size > 20000) floorCache.clear();
  const result = computeFloorFill(L, W, a, b, uniformOnly);
  floorCache.set(key, result);
  return result;
}

function computeFloorFill(L: number, W: number, a: number, b: number, uniformOnly: boolean): { count: number; rects: Rect[] } {
  let best: Block[] = [];
  let bestN = 0;
  const consider = (blocks: Block[]) => {
    const n = blocks.reduce((s, k) => s + k.nx * k.ny, 0);
    if (n > bestN) (bestN = n), (best = blocks);
  };
  for (const [p, q] of [[a, b], [b, a]] as const) {
    consider([{ x: 0, y: 0, nx: fit(L, p), ny: fit(W, q), a: p, b: q }]);
    if (uniformOnly) continue;
    // Columns of p×q along the length, the rest of the length turned.
    for (let i = 1; i < fit(L, p); i++) {
      const rest = L - i * p;
      consider([
        { x: 0, y: 0, nx: i, ny: fit(W, q), a: p, b: q },
        { x: i * p, y: 0, nx: fit(rest, q), ny: fit(W, p), a: q, b: p },
      ]);
    }
    // Rows of p×q across the width, the rest of the width turned.
    for (let j = 1; j < fit(W, q); j++) {
      const rest = W - j * q;
      consider([
        { x: 0, y: 0, nx: fit(L, p), ny: j, a: p, b: q },
        { x: 0, y: j * q, nx: fit(L, q), ny: fit(rest, p), a: q, b: p },
      ]);
    }
  }
  const rects: Rect[] = [];
  for (const k of best) for (let i = 0; i < k.nx; i++) for (let j = 0; j < k.ny; j++) rects.push({ x: k.x + i * k.a, y: k.y + j * k.b, l: k.a, w: k.b });
  return { count: bestN, rects };
}

// ── Parts in a container ────────────────────────────────────────────────────

export interface BoxFill {
  count: number;
  /** part size as placed (with margin), and which original axis stands vertical */
  cell: Dims;
  vertical: "h" | "w" | "l";
  perLayer: number;
  layers: number;
  /** nest method: parts per stack */
  perStack: number;
  rects: Rect[];
  /** height of one layer including its pad (layers), or the pitch (nest) */
  layerStep: number;
  /** share of the inside volume the parts' bounding boxes take */
  fill: number;
  limitedBy: "space" | "weight";
  pads: number;
  /** m² of divider board (cells) */
  dividerM2: number;
}

/**
 * How many parts fit in a container and how they sit. The lift limit only applies to containers
 * people carry (cartons and totes); crates go by forklift.
 */
export function fillContainer(part: PackPart, inner: Dims, tare: number, maxLoad: number, s: PackSettings, handLifted = true): BoxFill | null {
  const m = s.margin * 2;
  const choices: { vertical: BoxFill["vertical"]; p: number; q: number; r: number }[] = [{ vertical: "h", p: part.l, q: part.w, r: part.h }];
  if (!part.upright && s.method !== "nest") choices.push({ vertical: "w", p: part.l, q: part.h, r: part.w }, { vertical: "l", p: part.w, q: part.h, r: part.l });
  const capKg = Math.min(maxLoad > 0 ? maxLoad : Infinity, handLifted && s.boxWeightCap > 0 ? s.boxWeightCap - tare : Infinity);
  const weightCap = part.weight > 0 ? Math.max(0, Math.floor(capKg / part.weight + EPS)) : Infinity;
  let best: BoxFill | null = null;
  for (const c of choices) {
    const div = s.method === "cells" ? s.dividerThickness : 0;
    const a = c.p + m + div;
    const b = c.q + m + div;
    const ch = c.r + m;
    const floor = floorFill(inner.l, inner.w, a, b, s.method === "cells");
    if (!floor.count || ch > inner.h + EPS) continue;
    let layers: number;
    let perStack = 1;
    let step = ch;
    if (s.method === "nest") {
      const pitch = part.nestPitch && part.nestPitch > 0 ? part.nestPitch : ch;
      perStack = 1 + Math.floor((inner.h - ch + EPS) / pitch);
      layers = 1;
      step = pitch;
    } else {
      const pad = s.padThickness;
      layers = Math.floor((inner.h + pad + EPS) / (ch + pad));
      step = ch + pad;
    }
    const space = floor.count * layers * perStack;
    const count = Math.min(space, weightCap);
    if (count <= 0) continue;
    if (!best || count > best.count) {
      const usedLayers = s.method === "nest" ? 1 : Math.ceil(count / floor.count);
      let dividerM2 = 0;
      if (s.method === "cells" && floor.rects.length) {
        // A uniform grid: (columns − 1) walls across the width and (rows − 1) along the length, full height.
        const cols = Math.round(floor.rects.reduce((mx, r) => Math.max(mx, r.x), 0) / floor.rects[0]!.l) + 1;
        const rows = Math.round(floor.rects.reduce((mx, r) => Math.max(mx, r.y), 0) / floor.rects[0]!.w) + 1;
        dividerM2 = ((cols - 1) * inner.w + (rows - 1) * inner.l) * inner.h / 1e6;
      }
      best = {
        count,
        cell: { l: a, w: b, h: ch },
        vertical: c.vertical,
        perLayer: floor.count,
        layers: usedLayers,
        perStack,
        rects: floor.rects,
        layerStep: step,
        fill: (count * part.l * part.w * part.h) / (inner.l * inner.w * inner.h),
        limitedBy: count < space ? "weight" : "space",
        pads: s.method === "layers" && s.padThickness > 0 ? Math.max(0, usedLayers - 1) : 0,
        dividerM2,
      };
    }
  }
  return best;
}

// ── Containers on a pallet, pallets in a truck ──────────────────────────────

export interface PalletLoad {
  perLayer: number;
  layers: number;
  boxes: number;
  rects: Rect[];
  /** loaded height, deck included */
  height: number;
  gross: number;
  limitedBy: "height" | "weight" | "strength" | "space";
}

export function loadPallet(outer: Dims, boxGross: number, pallet: PackPallet, strengthN: number | null, safety: number): PalletLoad | null {
  const floor = floorFill(pallet.l, pallet.w, outer.l, outer.w);
  if (!floor.count) return null;
  const byHeight = Math.floor((pallet.maxHeight - pallet.h + EPS) / outer.h);
  if (byHeight < 1) return null;
  let layers = byHeight;
  let limitedBy: PalletLoad["limitedBy"] = "height";
  if (strengthN != null && boxGross > 0) {
    // The bottom box carries every box above it.
    const byStrength = 1 + Math.floor(strengthN / (safety * boxGross * G) + EPS);
    if (byStrength < layers) (layers = byStrength), (limitedBy = "strength");
  }
  let boxes = floor.count * layers;
  if (pallet.maxLoad > 0 && boxGross > 0) {
    const byWeight = Math.floor(pallet.maxLoad / boxGross + EPS);
    if (byWeight < boxes) (boxes = byWeight), (limitedBy = "weight");
  }
  if (boxes < 1) return null;
  const usedLayers = Math.ceil(boxes / floor.count);
  return { perLayer: floor.count, layers: usedLayers, boxes, rects: floor.rects, height: pallet.h + usedLayers * outer.h, gross: pallet.tare + boxes * boxGross, limitedBy };
}

export interface VehicleLoad {
  perFloor: number;
  tiers: number;
  pallets: number;
  rects: Rect[];
  limitedBy: "floor" | "weight";
}

export function loadVehicle(foot: { l: number; w: number }, height: number, gross: number, v: PackVehicle, stack: boolean): VehicleLoad | null {
  const floor = floorFill(v.l, v.w, foot.l, foot.w);
  if (!floor.count || height > v.h + EPS) return null;
  const tiers = stack ? Math.max(1, Math.floor((v.h + EPS) / height)) : 1;
  let pallets = floor.count * tiers;
  let limitedBy: VehicleLoad["limitedBy"] = "floor";
  if (v.payload > 0 && gross > 0) {
    const byWeight = Math.floor(v.payload / gross + EPS);
    if (byWeight < pallets) (pallets = byWeight), (limitedBy = "weight");
  }
  if (pallets < 1) return null;
  return { perFloor: floor.count, tiers, pallets, rects: floor.rects, limitedBy };
}

// ── One complete option, costed ─────────────────────────────────────────────

export interface PackOption {
  container: PackContainer;
  pallet: PackPallet;
  vehicle: PackVehicle;
  outer: Dims;
  box: BoxFill;
  boxGross: number;
  palletLoad: PalletLoad;
  load: VehicleLoad;
  partsPerPallet: number;
  partsPerLoad: number;
  /** cost per part on a full truck */
  perPart: { container: number; dunnage: number; pallet: number; freight: number; total: number; capital: number };
  /** cost of a real shipment of settings.shipQty parts */
  shipment: { qty: number; boxes: number; pallets: number; loads: number; total: number; perPart: number } | null;
  /** what the options are ranked by */
  rankCost: number;
}

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/** Price of one use of a container or pallet: its price, or for returnables a trip plus wear. */
const perUse = (x: { cost: number; returnable: boolean; tripCost: number; lifeTrips: number }) =>
  x.returnable ? x.tripCost + x.cost / Math.max(1, x.lifeTrips) : x.cost;

export function evaluate(part: PackPart, container: PackContainer, pallet: PackPallet, vehicle: PackVehicle, s: PackSettings): PackOption | null {
  const box = fillContainer(part, { l: container.l, w: container.w, h: container.h }, container.tare, container.maxLoad, s, container.kind !== "crate");
  return box ? evaluateFilled(part, container, box, pallet, vehicle, s) : null;
}

/** Cost an option once the container's contents are known. */
function evaluateFilled(part: PackPart, container: PackContainer, box: BoxFill, pallet: PackPallet, vehicle: PackVehicle, s: PackSettings): PackOption | null {
  const outer = { l: container.l + 2 * container.wall, w: container.w + 2 * container.wall, h: container.h + 2 * container.wall };
  const boxGross = container.tare + box.count * part.weight;
  const grade = container.kind === "carton" ? gradeOf(container.grade) : undefined;
  const strength = grade ? cartonStrengthN(outer, grade) : null;
  const palletLoad = loadPallet(outer, boxGross, pallet, strength, s.safetyFactor);
  if (!palletLoad) return null;
  const load = loadVehicle({ l: pallet.l, w: pallet.w }, palletLoad.height, palletLoad.gross, vehicle, s.stackPallets);
  if (!load) return null;

  const partsPerPallet = palletLoad.boxes * box.count;
  const partsPerLoad = partsPerPallet * load.pallets;
  const dunnageEach = (box.pads * container.l * container.w) / 1e6 * s.padCostPerM2 + box.dividerM2 * s.dividerCostPerM2;
  const containerEach = perUse(container);
  const palletEach = perUse(pallet) + s.wrapCostPerPallet;
  const loadFreight = s.freightMode === "load" ? s.freightFixed + s.freightPerKm * s.distanceKm : s.freightPerPallet * load.pallets;
  const boxesPerLoad = palletLoad.boxes * load.pallets;
  const per = (x: number) => x / partsPerLoad;
  const perPart = {
    container: round(per(containerEach * boxesPerLoad)),
    dunnage: round(per(dunnageEach * boxesPerLoad)),
    pallet: round(per(palletEach * load.pallets)),
    freight: round(per(loadFreight)),
    total: 0,
    capital: round(per(((container.returnable ? container.cost / Math.max(1, container.lifeTrips) : 0) * boxesPerLoad) + (pallet.returnable ? pallet.cost / Math.max(1, pallet.lifeTrips) : 0) * load.pallets)),
  };
  perPart.total = round(perPart.container + perPart.dunnage + perPart.pallet + perPart.freight);

  let shipment: PackOption["shipment"] = null;
  if (s.shipQty > 0) {
    const boxes = Math.ceil(s.shipQty / box.count);
    const pallets = Math.ceil(boxes / palletLoad.boxes);
    const loads = Math.ceil(pallets / load.pallets);
    const freight = s.freightMode === "load" ? loads * (s.freightFixed + s.freightPerKm * s.distanceKm) : pallets * s.freightPerPallet;
    const total = round(boxes * (containerEach + dunnageEach) + pallets * palletEach + freight, 2);
    shipment = { qty: s.shipQty, boxes, pallets, loads, total, perPart: round(total / s.shipQty) };
  }
  return {
    container,
    pallet,
    vehicle,
    outer,
    box,
    boxGross: round(boxGross, 3),
    palletLoad,
    load,
    partsPerPallet,
    partsPerLoad,
    perPart,
    shipment,
    rankCost: shipment ? shipment.perPart : perPart.total,
  };
}

/** Every container × pallet × vehicle combination that works, cheapest per part first. */
export function rankOptions(part: PackPart, containers: PackContainer[], pallets: PackPallet[], vehicles: PackVehicle[], s: PackSettings): PackOption[] {
  const out: PackOption[] = [];
  for (const c of containers) for (const p of pallets) for (const v of vehicles) {
    const o = evaluate(part, c, p, v, s);
    if (o) out.push(o);
  }
  return out.sort((a, b) => a.rankCost - b.rankCost || b.box.count - a.box.count);
}

// ── Made-to-size carton search ──────────────────────────────────────────────

export interface CartonWindow {
  min: number;
  max: number;
  /** largest filled carton, kg (0 = only the per-person lift limit) */
  maxLoad?: number;
}

/**
 * Search carton sizes built exactly around whole numbers of parts (nx × ny × nz) inside the size
 * window, in every board grade, and return the cheapest per part for this pallet and truck.
 * Each candidate is costed with the full pallet, truck and freight rules, and the board grade is
 * the cheapest one that survives the pallet stack.
 */
export function bestCartons(part: PackPart, pallet: PackPallet, vehicle: PackVehicle, s: PackSettings, win: CartonWindow, keep = 5): PackOption[] {
  const m = s.margin * 2;
  const div = s.method === "cells" ? s.dividerThickness : 0;
  const poses: { vertical: BoxFill["vertical"]; p: number; q: number; r: number }[] = [{ vertical: "h", p: part.l, q: part.w, r: part.h }];
  if (!part.upright && s.method !== "nest") poses.push({ vertical: "w", p: part.l, q: part.h, r: part.w }, { vertical: "l", p: part.w, q: part.h, r: part.l });
  // Up to STEPS evenly spread counts per side keeps the search quick even for tiny parts.
  const STEPS = 14;
  const counts = (d: number, lo: number, hi: number, extra = 0) => {
    const nMin = Math.max(1, Math.ceil((lo + extra) / (d + extra)));
    const nMax = Math.floor((hi + extra) / (d + extra));
    const out: number[] = [];
    if (nMax < nMin) return out;
    const stride = Math.max(1, Math.ceil((nMax - nMin + 1) / STEPS));
    for (let n = nMin; n <= nMax; n += stride) out.push(n);
    if (out[out.length - 1] !== nMax) out.push(nMax);
    return out;
  };
  const liftKg = (s.boxWeightCap > 0 ? s.boxWeightCap : Infinity);
  const loadKg = win.maxLoad && win.maxLoad > 0 ? win.maxLoad : Infinity;
  const seen = new Set<string>();
  const results: PackOption[] = [];
  for (const pose of poses) {
    const a = pose.p + m + div;
    const b = pose.q + m + div;
    const ch = pose.r + m;
    const pitch = s.method === "nest" ? (part.nestPitch && part.nestPitch > 0 ? part.nestPitch : ch) : ch + s.padThickness;
    for (const nx of counts(a, win.min, win.max)) {
      for (const ny of counts(b, win.min, win.max)) {
        // nest: one stack of nz parts; layers: nz layers with pads between.
        const nzs = s.method === "nest" ? counts(pitch, Math.max(0, win.min - ch), win.max - ch).map((k) => k + 1).concat(win.min <= ch ? [1] : []) : counts(ch, win.min, win.max, s.padThickness);
        for (const nz of nzs) {
          const L = Math.ceil(nx * a);
          const W = Math.ceil(ny * b);
          const H = Math.ceil(s.method === "nest" ? ch + (nz - 1) * pitch : nz * ch + (nz - 1) * s.padThickness);
          if (H > win.max || H < win.min) continue;
          const count = nx * ny * nz;
          if (count * part.weight > loadKg) continue;
          const key = [L, W, H].sort((x, y) => x - y).join("x");
          if (seen.has(key)) continue;
          seen.add(key);
          const rects: Rect[] = [];
          for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) rects.push({ x: i * a, y: j * b, l: a, w: b });
          let dividerM2 = 0;
          if (s.method === "cells") dividerM2 = ((nx - 1) * W + (ny - 1) * L) * H / 1e6;
          let bestHere: PackOption | null = null;
          for (const g of BOARD_GRADES) {
            const outer = { l: L + 2 * g.caliper, w: W + 2 * g.caliper, h: H + 2 * g.caliper };
            const tare = round(cartonBlankArea(outer) * g.kgPerM2, 3);
            if (tare + count * part.weight > liftKg) continue;
            const c: PackContainer = {
              id: `fit-${key}-${g.key}`,
              kind: "carton",
              name: `Carton ${L}×${W}×${H} · ${g.label}`,
              l: L,
              w: W,
              h: H,
              wall: g.caliper,
              tare,
              maxLoad: win.maxLoad ?? 0,
              cost: cartonPrice(outer, g),
              returnable: false,
              tripCost: 0,
              lifeTrips: 1,
              grade: g.key,
            };
            const box: BoxFill = {
              count,
              cell: { l: a, w: b, h: ch },
              vertical: pose.vertical,
              perLayer: nx * ny,
              layers: s.method === "nest" ? 1 : nz,
              perStack: s.method === "nest" ? nz : 1,
              rects,
              layerStep: pitch,
              fill: (count * part.l * part.w * part.h) / (L * W * H),
              limitedBy: "space",
              pads: s.method === "layers" && s.padThickness > 0 ? nz - 1 : 0,
              dividerM2,
            };
            const o = evaluateFilled(part, c, box, pallet, vehicle, s);
            if (o && (!bestHere || o.rankCost < bestHere.rankCost)) bestHere = o;
          }
          if (bestHere) results.push(bestHere);
        }
      }
    }
  }
  return results.sort((x, y) => x.rankCost - y.rankCost || y.box.count - x.box.count).slice(0, keep);
}

// ── Returnable versus one-way ───────────────────────────────────────────────

export interface RoiInput {
  annualParts: number;
  partsPerContainer: number;
  containerPrice: number;
  /** days a container is away on one round trip */
  cycleDays: number;
  /** one-way packaging cost per part (container, dunnage, pallet; freight excluded) */
  oneWayPerPart: number;
  /** returnable running cost per part (trips, dunnage, pallet; no purchase price) */
  returnablePerPart: number;
  workDays?: number;
  /** extra containers kept as spares, share of the fleet */
  spare?: number;
}

export function returnableRoi(i: RoiInput) {
  const workDays = i.workDays ?? 250;
  const perDay = i.annualParts / workDays / Math.max(1, i.partsPerContainer);
  const fleet = Math.ceil(perDay * Math.max(1, i.cycleDays) * (1 + (i.spare ?? 0.1)));
  const capital = round(fleet * i.containerPrice, 2);
  const annualSaving = round((i.oneWayPerPart - i.returnablePerPart) * i.annualParts, 2);
  const breakEvenMonths = annualSaving > 0 ? round(capital / (annualSaving / 12), 1) : null;
  return { fleet, capital, annualSaving, breakEvenMonths };
}
