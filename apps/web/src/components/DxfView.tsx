import DxfParser from "dxf-parser";
import { Ruler } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cx } from "./ui.tsx";

type P = { x: number; y: number };
type Ent = { type: string; vertices?: P[]; shape?: boolean; center?: P; radius?: number; startAngle?: number; endAngle?: number };

/** How close (in screen pixels) a click must be to a corner or hole centre to snap to it. */
const SNAP_PX = 14;

/** Flat-pattern viewer: draws lines, polylines, circles and arcs, reports size and cut length, and measures. */
export default function DxfView({ url }: { url: string }) {
  const [data, setData] = useState<{ paths: string[]; snaps: P[]; box: [number, number, number, number]; cut: number; holes: number } | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [picks, setPicks] = useState<P[]>([]);
  const svg = useRef<SVGSVGElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      try {
        const text = await (await fetch(url, { credentials: "same-origin" })).text();
        const dxf = new DxfParser().parseSync(text) as { entities: Ent[] } | null;
        if (!dxf) throw new Error("Empty drawing");
        const paths: string[] = [];
        // Points a measurement can snap to, in SVG coordinates (y flipped).
        const snaps: P[] = [];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, cut = 0, holes = 0;
        const grow = (x: number, y: number) => {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        };
        for (const e of dxf.entities) {
          if ((e.type === "LINE" || e.type === "LWPOLYLINE" || e.type === "POLYLINE") && e.vertices?.length) {
            const v = e.shape ? [...e.vertices, e.vertices[0]!] : e.vertices;
            paths.push("M" + v.map((p) => `${p.x},${-p.y}`).join("L"));
            e.vertices.forEach((p) => snaps.push({ x: p.x, y: -p.y }));
            v.forEach((p, i) => (grow(p.x, p.y), i && (cut += Math.hypot(p.x - v[i - 1]!.x, p.y - v[i - 1]!.y))));
          } else if (e.type === "CIRCLE" && e.center && e.radius) {
            const { x, y } = e.center, r = e.radius;
            paths.push(`M${x - r},${-y}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0`);
            grow(x - r, y - r); grow(x + r, y + r);
            snaps.push({ x, y: -y }, { x: x - r, y: -y }, { x: x + r, y: -y }, { x, y: -y - r }, { x, y: -y + r });
            cut += 2 * Math.PI * r;
            holes++;
          } else if (e.type === "ARC" && e.center && e.radius != null && e.startAngle != null && e.endAngle != null) {
            const { x, y } = e.center, r = e.radius;
            let sweep = e.endAngle - e.startAngle;
            if (sweep < 0) sweep += 2 * Math.PI;
            const sx = x + r * Math.cos(e.startAngle), sy = y + r * Math.sin(e.startAngle);
            const ex = x + r * Math.cos(e.endAngle), ey = y + r * Math.sin(e.endAngle);
            paths.push(`M${sx},${-sy}A${r},${r} 0 ${sweep > Math.PI ? 1 : 0},0 ${ex},${-ey}`);
            grow(sx, sy); grow(ex, ey);
            snaps.push({ x: sx, y: -sy }, { x: ex, y: -ey }, { x, y: -y });
            cut += r * sweep;
          }
        }
        if (!paths.length) throw new Error("No lines, arcs or circles found in this DXF");
        if (!off) setData({ paths, snaps, box: [minX, -maxY, maxX - minX, maxY - minY], cut, holes });
      } catch (err) {
        if (!off) setError((err as Error).message);
      }
    })();
    return () => {
      off = true;
    };
  }, [url]);

  if (error) return <div className="flex h-full items-center justify-center text-sm text-bad">{error}</div>;
  if (!data) return <div className="flex h-full items-center justify-center text-sm text-muted">Loading drawing…</div>;
  const [x, y, w, h] = data.box;
  const pad = Math.max(w, h) * 0.05;
  const unit = Math.max(w, h) / 600;

  const pick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!measuring || !svg.current) return;
    const m = svg.current.getScreenCTM();
    if (!m) return;
    let p: P = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    // Snap to the nearest corner, end point or hole centre near the click.
    let best = SNAP_PX / m.a;
    for (const s of data.snaps) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < best) {
        best = d;
        p = s;
      }
    }
    setPicks((prev) => (prev.length >= 2 ? [p] : [...prev, p]));
  };
  const [a, b] = picks;
  const dist = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  const hint = !measuring ? null : !a ? "Click the first point on the drawing" : !b ? "Now click the second point" : "Click again to start a new measurement";
  return (
    <div className="relative h-full min-h-[320px] w-full rounded-xl bg-panel-2">
      <svg
        ref={svg}
        viewBox={`${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}`}
        className={cx("h-full w-full p-4", measuring && "cursor-crosshair")}
        onClick={pick}
      >
        {data.paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="var(--accent)" strokeWidth={Math.max(w, h) / 600} vectorEffect="non-scaling-stroke" />
        ))}
        {picks.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={unit * 5} fill="#F5C518" stroke="#172230" strokeWidth={unit} />
        ))}
        {a && b && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#F5C518" strokeWidth={2} vectorEffect="non-scaling-stroke" />}
      </svg>
      {dist != null && (
        <div className="num pointer-events-none absolute right-3 top-3 rounded-md bg-[#F5C518] px-2.5 py-1 text-sm font-semibold text-[#172230] shadow-lg">
          {dist.toFixed(2)} mm
          <div className="text-xs font-normal">
            X {Math.abs(a!.x - b!.x).toFixed(2)} · Y {Math.abs(a!.y - b!.y).toFixed(2)}
          </div>
        </div>
      )}
      {hint && <div className="pointer-events-none absolute bottom-16 left-1/2 -translate-x-1/2 rounded-lg bg-[#172230]/85 px-3 py-1.5 text-xs text-white">{hint}</div>}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-[#172230]/90 p-1 shadow-xl">
        <button
          type="button"
          title="Measure: click two points"
          aria-label="Measure"
          aria-pressed={measuring}
          className={cx("flex h-9 w-9 items-center justify-center rounded-lg transition-colors", measuring ? "bg-[#4f6fe0] text-white" : "text-white/85 hover:bg-white/10 hover:text-white")}
          onClick={() => {
            setMeasuring((v) => !v);
            setPicks([]);
          }}
        >
          <Ruler className="h-4 w-4" />
        </button>
      </div>
      <div className="num absolute left-3 top-3 rounded-lg bg-panel/90 px-2.5 py-1.5 text-xs shadow-panel">
        <div className="text-muted">Flat size</div>
        <div className="font-medium">{w.toFixed(2)} × {h.toFixed(2)}</div>
        <div className="mt-1 text-muted">Cut length {data.cut.toFixed(1)} · {data.holes} holes</div>
      </div>
    </div>
  );
}
