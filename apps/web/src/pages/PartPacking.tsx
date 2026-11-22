import { PackageCheck } from "lucide-react";
import { Link } from "react-router";
import type { PackSpec } from "../api.ts";
import { money, num } from "../format.ts";

/** The part page's Packing tab: its saved packing spec, or a way to make one. */
export function PartPacking({ itemId, spec, size }: { itemId: string; spec: PackSpec | null; size: [number, number, number, number] | null }) {
  const open = (
    <Link to={`/packaging?item=${itemId}`} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-ink hover:brightness-110">
      <PackageCheck className="h-4 w-4" /> {spec ? "Open the packing study" : "Work out how to pack it"}
    </Link>
  );
  if (!spec) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="max-w-md text-sm text-muted">
          No packing set yet. Compare cartons, totes and crates, pallets and trucks, and save the cheapest way to ship this part. It then shows on every job for this part.
        </p>
        {size && <p className="num text-xs text-muted">Packing size {num(size[0], 1)} × {num(size[1], 1)} × {num(size[2], 1)} mm, {num(size[3], 3)} kg</p>}
        {open}
      </div>
    );
  }
  const rows: [string, string][] = [
    ["Container", `${spec.container.code} · ${spec.container.name}`],
    ["Inside size", `${num(spec.container.l, 0)} × ${num(spec.container.w, 0)} × ${num(spec.container.h, 0)} mm`],
    ["Parts per container", `${num(spec.perBox, 0)} (${spec.perLayer} a layer × ${spec.layers})`],
    ["Weight full", `${num(spec.boxGross, 1)} kg`],
    ["Pallet", `${spec.pallet.code} · ${num(spec.boxesPerPallet, 0)} containers, ${num(spec.partsPerPallet, 0)} parts`],
    ["Truck", `${spec.vehicle.code} · ${num(spec.palletsPerLoad, 0)} pallets, ${num(spec.partsPerLoad, 0)} parts`],
    ["Cost per part", money(spec.costPerPart, spec.costPerPart < 1 ? 4 : 2)],
  ];
  return (
    <div className="space-y-4">
      <dl className="divide-y divide-line rounded-lg ring-1 ring-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-3 py-2 text-sm">
            <dt className="text-muted">{k}</dt>
            <dd className="num text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-muted">Saved {new Date(spec.savedAt).toLocaleDateString()}</span>
        {open}
      </div>
    </div>
  );
}
