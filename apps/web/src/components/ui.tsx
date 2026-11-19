import { useEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "react-router";
import { label, money } from "../format.ts";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger" | "live";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "bg-panel text-ink ring-1 ring-inset ring-line hover:bg-panel-2",
  ghost: "text-muted hover:text-ink hover:bg-panel-2",
  danger: "bg-panel text-bad ring-1 ring-inset ring-line hover:bg-bad-soft",
  live: "bg-live text-live-ink hover:brightness-105",
};

type Size = "md" | "lg" | "xl";
const SIZES: Record<Size, string> = {
  md: "min-h-9 px-3.5 text-sm rounded-lg",
  lg: "min-h-12 px-5 text-base rounded-xl",
  xl: "min-h-16 px-6 text-lg rounded-2xl",
};

export function Button({ variant = "secondary", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function ButtonLink({ to, children, variant = "secondary" }: { to: string; children: ReactNode; variant?: Variant }) {
  return (
    <Link to={to} className={cx("inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-colors", VARIANTS[variant])}>
      {children}
    </Link>
  );
}

const fieldCls =
  "w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15 disabled:bg-panel-2 disabled:text-ink/80";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cx(fieldCls, className)} />;
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={cx(fieldCls, className)} />;
export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea rows={3} {...p} className={cx(fieldCls, className)} />
);

export function Field({ label: text, error, children, hint }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-muted">{text}</span>
      {children}
      {error ? <span className="mt-1 block text-xs text-bad">{error}</span> : hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("min-w-0 rounded-xl bg-panel shadow-panel ring-1 ring-line/70", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5 pb-2">
          <h2 className="text-base font-semibold">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? "px-4 pb-4 pt-2" : ""}>{children}</div>
    </section>
  );
}

export type Crumb = { to: string; label: string };

export function PageHeader({ title, sub, actions, back, crumbs }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; back?: Crumb; crumbs?: Crumb[] }) {
  const trail = crumbs ?? (back ? [back] : []);
  return (
    <div className="mb-6">
      {trail.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1.5 text-sm text-muted">
          {trail.map((c, i) => (
            <span key={c.to} className="flex items-center gap-1.5">
              {i > 0 && <span aria-hidden>/</span>}
              <Link to={c.to} className="hover:text-accent">
                {c.label}
              </Link>
            </span>
          ))}
        </nav>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  draft: "bg-panel-2 text-muted",
  planned: "bg-panel-2 text-muted",
  pending: "bg-panel-2 text-muted",
  closed: "bg-panel-2 text-muted",
  inactive: "bg-panel-2 text-muted",
  prospect: "bg-info-soft text-info",
  sent: "bg-info-soft text-info",
  released: "bg-info-soft text-info",
  ready: "bg-info-soft text-info",
  confirmed: "bg-info-soft text-info",
  in_progress: "bg-live-soft text-live-ink dark:text-live",
  in_production: "bg-live-soft text-live-ink dark:text-live",
  running: "bg-live-soft text-live-ink dark:text-live",
  paused: "bg-warn-soft text-warn",
  partial: "bg-warn-soft text-warn",
  received: "bg-ok-soft text-ok",
  expired: "bg-warn-soft text-warn",
  won: "bg-ok-soft text-ok",
  active: "bg-ok-soft text-ok",
  complete: "bg-ok-soft text-ok",
  done: "bg-ok-soft text-ok",
  shipped: "bg-ok-soft text-ok",
  lost: "bg-bad-soft text-bad",
  cancelled: "bg-bad-soft text-bad",
  late: "bg-bad-soft text-bad",
};

export function Status({ value }: { value: string }) {
  const live = value === "in_progress" || value === "running" || value === "in_production";
  // Unknown statuses keep their own label in neutral grey.
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium first-letter:uppercase", TONE[value] ?? TONE.draft)}>
      {live && <span className="h-1.5 w-1.5 rounded-full bg-live" aria-hidden />}
      {label(value)}
    </span>
  );
}

export type Head = ReactNode | { label: ReactNode; right?: boolean };
/** A right-aligned (numeric) column header. */
export const R = (label: ReactNode): Head => ({ label, right: true });
const isHead = (h: Head): h is { label: ReactNode; right?: boolean } => typeof h === "object" && h !== null && "label" in (h as object);

export function Table({ head, children, empty }: { head: Head[]; children: ReactNode; empty?: ReactNode }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  if (rows.length === 0) return <div className="px-4 py-12 text-center text-sm text-muted">{empty ?? "Nothing here yet."}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-line bg-panel-2/60 text-[13px] text-muted">
            {head.map((h, i) => (
              <th key={i} className={cx("whitespace-nowrap px-4 py-2 font-medium", isHead(h) && h.right ? "text-right" : "text-left")}>
                {isHead(h) ? h.label : h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className, right, colSpan }: { children?: ReactNode; className?: string; right?: boolean; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx("whitespace-nowrap px-4 py-2.5 align-middle", right && "num text-right", className)}>{children}</td>
);

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{(error as Error).message}</div>;
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3 p-4" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-lg bg-panel-2" style={{ opacity: 1 - i * 0.18 }} />
      ))}
    </div>
  );
}

export function Stat({ label: text, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "bad" | "ok" }) {
  return (
    <div className="rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
      <div className="text-[13px] text-muted">{text}</div>
      <div className={cx("num mt-1 text-2xl font-semibold", tone === "bad" && "text-bad", tone === "ok" && "text-ink")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

/**
 * Estimate vs actual tile. While work is still running (`partial`), a difference against the
 * full-job estimate would mislead, so the tile shows how much of the estimate is used instead.
 */
export function CostTile({ label: text, estimate, actual, lowerIsBetter = true, partial = false, format = money }: { label: string; estimate: number | null; actual: number | null; lowerIsBetter?: boolean; partial?: boolean; format?: (n: number | null) => string }) {
  const diff = estimate != null && actual != null ? actual - estimate : null;
  const good = diff == null || Math.abs(diff) < 0.005 ? null : lowerIsBetter ? diff < 0 : diff > 0;
  const used = estimate && actual != null ? Math.round((actual / estimate) * 100) : null;
  return (
    <div className="rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70">
      <div className="text-[13px] text-muted">{text}</div>
      <div className="num mt-1 text-xl font-semibold">{actual == null ? <span className="text-muted">Not started</span> : format(actual)}</div>
      <div className="mt-1 flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">Est. {format(estimate)}</span>
        {partial
          ? used != null && <span className={cx("num font-medium", used > 100 ? "text-bad" : "text-muted")}>{used}% used</span>
          : good != null && diff != null && (
              <span className={cx("num rounded px-1.5 py-0.5 font-medium", good ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad")}>
                {diff > 0 ? "+" : "−"}
                {format(Math.abs(diff))}
              </span>
            )}
      </div>
      {partial && used != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
          <div className={cx("h-full rounded-full", used > 100 ? "bg-bad" : "bg-accent")} style={{ width: `${Math.min(100, used)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Horizontal stage track for a document's life (e.g. job: planned → released → in progress → complete → closed). */
export function StageTrack({ stages, current }: { stages: { key: string; label: string }[]; current: string }) {
  const idx = stages.findIndex((s) => s.key === current);
  return (
    <ol className="flex gap-1.5" aria-label="Progress">
      {stages.map((s, i) => (
        <li key={s.key} className="min-w-0 flex-1">
          <div className={cx("h-1.5 rounded-full", i < idx ? "bg-accent" : i === idx ? (current === "in_progress" ? "bg-live" : "bg-accent") : "bg-line")} />
          <div className={cx("mt-1.5 truncate text-xs", i === idx ? "font-semibold text-ink" : "text-muted")} aria-current={i === idx ? "step" : undefined}>
            {s.label}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Underlined tabs for record pages. */
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          aria-selected={t.key === value}
          onClick={() => onChange(t.key)}
          className={cx(
            "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            t.key === value ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
          {t.count != null && <span className="num rounded bg-panel-2 px-1.5 text-xs text-muted">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Saved list views ("Open", "Late", "All") shown as a segmented control above a table. */
export function ViewTabs({ views, value, onChange }: { views: { key: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-panel-2 p-1">
      {views.map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onChange(v.key)}
          className={cx("rounded-md px-3 py-1 text-sm transition-colors", v.key === value ? "bg-panel font-medium text-ink shadow-panel" : "text-muted hover:text-ink")}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, title, onClose, children, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-2xl bg-panel p-0 text-ink shadow-2xl ring-1 ring-line backdrop:bg-[#172230]/45", wide ? "max-w-5xl" : "max-w-lg")}
    >
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel-2 hover:text-ink" aria-label="Close">
          ✕
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />;
}

/** Toolbar row above a list table. */
export function ListBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-4">{children}</div>;
}

/** "More" menu for secondary and destructive actions, so a header keeps one primary button. */
export function MoreMenu({ items }: { items: { label: string; onClick: () => void; danger?: boolean; disabled?: boolean }[] }) {
  const ref = useRef<HTMLDetailsElement>(null);
  if (!items.length) return null;
  return (
    <details ref={ref} className="relative">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center rounded-lg px-3 text-sm font-medium text-ink ring-1 ring-inset ring-line hover:bg-panel-2 [&::-webkit-details-marker]:hidden">
        More
      </summary>
      <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl bg-panel py-1 shadow-xl ring-1 ring-line">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            disabled={it.disabled}
            onClick={() => {
              ref.current?.removeAttribute("open");
              it.onClick();
            }}
            className={cx("block w-full px-4 py-2 text-left text-sm hover:bg-panel-2 disabled:opacity-40", it.danger && "text-bad")}
          >
            {it.label}
          </button>
        ))}
      </div>
    </details>
  );
}

/**
 * Milestone timeline for a record's life: a line through every stage, a tick for each stage
 * reached, and the date it was reached underneath.
 */
export function StageTimeline({ stages, current, dates = {} }: { stages: { key: string; label: string }[]; current: string; dates?: Record<string, string | undefined> }) {
  const idx = stages.findIndex((s) => s.key === current);
  const last = stages.length - 1;
  return (
    <ol className="relative grid pt-1" style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }} aria-label="Progress">
      {stages.map((s, i) => {
        const reached = i <= idx;
        const align = i === 0 ? "items-start text-left" : i === last ? "items-end text-right" : "items-center text-center";
        return (
          <li key={s.key} className={cx("relative flex min-w-0 flex-col", align)} aria-current={i === idx ? "step" : undefined}>
            {/* Line to the next stage, drawn from this dot's centre. */}
            {i < last && (
              <span
                aria-hidden
                className={cx("absolute top-[7px] h-[3px]", i < idx ? "bg-ok" : "bg-line")}
                style={{ left: i === 0 ? 8 : "50%", right: i + 1 === last ? "-100%" : "-50%" }}
              />
            )}
            <span
              aria-hidden
              className={cx(
                "relative z-10 flex h-[17px] w-[17px] items-center justify-center rounded-full border-2 bg-panel",
                reached ? "border-ok" : "border-line",
                i === idx && "bg-ok",
              )}
            >
              {reached && (
                <svg viewBox="0 0 12 12" className={cx("h-2.5 w-2.5", i === idx ? "text-white" : "text-ok")}>
                  <path d="M2.5 6.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <span className={cx("mt-1.5 truncate text-[13px]", i === idx ? "font-semibold text-ink" : reached ? "font-medium text-ink" : "text-muted")}>{s.label}</span>
            {reached && dates[s.key] && <span className="num truncate text-xs text-muted">{dates[s.key]}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Cost card with the actual figure large, the estimate underneath, and the difference as a
 * badge: red arrow up when over the estimate, green arrow down when under (or the reverse for
 * figures where more is better, like margin).
 */
export function VarianceCard({ label: text, actual, estimate, moreIsBetter = false, partial = false, note, format = money }: { label: string; actual: number | null; estimate: number | null; moreIsBetter?: boolean; partial?: boolean; note?: ReactNode; format?: (n: number | null) => string }) {
  const diff = actual != null && estimate != null ? actual - estimate : null;
  // While the work is still going, being under the estimate means nothing yet: show how much is used.
  const used = partial && actual != null && estimate ? Math.round((actual / estimate) * 100) : null;
  const show = !partial && diff != null && Math.abs(diff) >= 0.005;
  const good = show && (moreIsBetter ? diff! > 0 : diff! < 0);
  return (
    <div className={cx("min-w-0 rounded-xl border-l-4 bg-panel px-4 py-3.5 shadow-panel ring-1 ring-line/70", (show && !good) || (used ?? 0) > 100 ? "border-l-bad" : "border-l-ok")}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] text-muted">{text}</div>
        {used != null && (
          <span className={cx("num shrink-0 rounded-md px-1.5 py-0.5 text-xs font-medium", used > 100 ? "bg-bad-soft text-bad" : "bg-panel-2 text-muted")}>{used}% used</span>
        )}
        {show && (
          <span className={cx("num inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium", good ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad")}>
            <span aria-hidden>{diff! > 0 ? "▲" : "▼"}</span>
            {format(Math.abs(diff!))}
            <span className="sr-only">{diff! > 0 ? "over" : "under"} the estimate</span>
          </span>
        )}
      </div>
      <div className="num mt-1 truncate text-[26px] font-semibold leading-tight tracking-tight">{actual == null ? <span className="text-lg text-muted">Not started</span> : format(actual)}</div>
      <div className="mt-1.5 truncate text-[13px] text-muted">{note ?? <>Estimated <span className="num">{format(estimate)}</span></>}</div>
    </div>
  );
}

/** Segmented pill tabs for a panel header. Disabled tabs show what is coming. */
export function PillTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number; disabled?: boolean; title?: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="tablist" className="flex max-w-full gap-0.5 overflow-x-auto rounded-xl bg-panel-2 p-1">
      {tabs.map((t) => (
        <button
          key={t.key}
          role="tab"
          type="button"
          disabled={t.disabled}
          title={t.title}
          aria-selected={t.key === value}
          onClick={() => onChange(t.key)}
          className={cx(
            "relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors",
            t.key === value ? "bg-ink text-panel shadow-sm" : "text-ink hover:bg-panel",
            t.disabled && "cursor-not-allowed text-muted hover:bg-transparent",
          )}
        >
          {t.label}
          {t.count != null && t.count > 0 && (
            <span className={cx("num rounded-full px-1.5 text-[11px] leading-[18px]", t.key === value ? "bg-panel/20" : "bg-accent-soft text-accent")}>{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/** A form control in a box with its label inside, top-left: compact record cards. */
export function InsetField({ label: text, children, tone, className }: { label: string; children: ReactNode; tone?: "ok" | "live" | "accent" | "bad"; className?: string }) {
  const tones = { ok: "border-ok bg-ok-soft", live: "border-live bg-live-soft", accent: "border-accent bg-accent-soft", bad: "border-bad bg-bad-soft" };
  return (
    <label className={cx("block rounded-lg border px-2.5 pb-1.5 pt-1 focus-within:ring-2 focus-within:ring-accent/40", tone ? tones[tone] : "border-line bg-panel", className)}>
      <span className="block text-[11px] text-muted">{text}</span>
      {children}
    </label>
  );
}

/** Classes for a borderless control placed inside an InsetField. */
export const insetControl = "w-full min-w-0 bg-transparent p-0 text-[15px] text-ink outline-none disabled:text-muted [&>option]:bg-panel";

/** Big breadcrumb title used on record pages: "Quotes › Q-1001", with actions on the right. */
export function DetailTitle({ parent, title, badge, sub, actions }: { parent: Crumb; title: ReactNode; badge?: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex flex-wrap items-center gap-1.5 text-[28px] font-semibold leading-tight tracking-tight">
          <Link to={parent.to} className="text-accent hover:underline">{parent.label}</Link>
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-muted" aria-hidden><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span className="num">{title}</span>
          {badge}
        </h1>
        {sub && <div className="mt-1 text-sm text-muted">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A headline number with a coloured edge, matching the job page's estimate cards. */
export function MetricCard({ label: text, value, note, tone = "ok", badge, to }: { label: string; value: ReactNode; note?: ReactNode; tone?: "ok" | "bad" | "warn" | "accent" | "line"; badge?: ReactNode; to?: string }) {
  const edge = { ok: "border-l-ok", bad: "border-l-bad", warn: "border-l-warn", accent: "border-l-accent", line: "border-l-line" }[tone];
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[13px] text-muted">{text}</div>
        {badge}
      </div>
      <div className="num mt-1 truncate text-[26px] font-semibold leading-tight tracking-tight">{value}</div>
      {note && <div className="mt-1.5 truncate text-[13px] text-muted">{note}</div>}
    </>
  );
  const cls = cx("block min-w-0 rounded-xl border-l-4 bg-panel px-4 py-3.5 shadow-panel ring-1 ring-line/70", edge, to && "transition hover:ring-2 hover:ring-accent");
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Small coloured badge for a card corner. */
export function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "ok" | "bad" | "warn" | "accent" | "muted" }) {
  const t = { ok: "bg-ok-soft text-ok", bad: "bg-bad-soft text-bad", warn: "bg-warn-soft text-warn", accent: "bg-accent-soft text-accent", muted: "bg-panel-2 text-muted" }[tone];
  return <span className={cx("num inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

/** The white "Details" panel with a heading and pill tabs, as on the job page. */
export function TabPanel({ title, tabs, children, className }: { title: ReactNode; tabs?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("min-w-0 rounded-xl bg-panel shadow-panel ring-1 ring-line/70", className)}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-xl font-semibold">{title}</h2>
        {tabs}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** The left record card: who it is for, the big number, then inset fields. */
export const recordCard = "flex min-w-0 flex-col rounded-xl bg-panel p-4 shadow-panel ring-1 ring-line/70";
