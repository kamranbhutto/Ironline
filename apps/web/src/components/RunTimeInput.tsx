import { useState } from "react";

/**
 * Run time per piece, typed in seconds or minutes but kept in hours (the value stored on
 * routings, quotes and jobs). Short cycles such as injection moulding read best in seconds,
 * so seconds are chosen when the time is under a minute.
 */
type Unit = "s" | "min";
const PER_HOUR: Record<Unit, number> = { s: 3600, min: 60 };

export function RunTimeInput(p: { hours: string; onChange: (hours: string) => void; label?: string; compact?: boolean; disabled?: boolean }) {
  const h = Number(p.hours || 0);
  const [unit, setUnit] = useState<Unit>(h > 0 && h < 1 / 60 ? "s" : "min");
  const shown = p.hours === "" ? "" : String(Math.round(h * PER_HOUR[unit] * 10000) / 10000);
  const box = p.compact ? "py-1.5 px-2" : "px-2.5 py-2";
  return (
    <div className="mt-1 flex rounded-lg bg-panel ring-1 ring-line focus-within:ring-accent">
      <input
        type="number"
        min={0}
        step="any"
        aria-label={p.label ?? `Run time per piece in ${unit === "s" ? "seconds" : "minutes"}`}
        disabled={p.disabled}
        value={shown}
        onChange={(e) => p.onChange(e.target.value === "" ? "" : String(Number(e.target.value) / PER_HOUR[unit]))}
        className={`num w-full min-w-0 rounded-l-lg bg-transparent text-right text-sm outline-none ${box}`}
      />
      <select
        aria-label="Run time unit"
        disabled={p.disabled}
        value={unit}
        onChange={(e) => setUnit(e.target.value as Unit)}
        className="shrink-0 rounded-r-lg border-l border-line bg-panel-2 px-1.5 text-xs text-muted"
      >
        <option value="s">sec</option>
        <option value="min">min</option>
      </select>
    </div>
  );
}

/** "1.8 s" or "2.5 min" for a run time held in hours. */
export function runTimeText(hours: number): string {
  if (hours > 0 && hours < 1 / 60) return `${Math.round(hours * 360000) / 100} s`;
  return `${Math.round(hours * 6000) / 100} min`;
}
