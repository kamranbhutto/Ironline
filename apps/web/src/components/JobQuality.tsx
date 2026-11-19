/**
 * The job page's Quality tab (every balloon with its readings, spread and Cpk) and Report tab
 * (a printable first-article inspection report built from the same data).
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Printer, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api, type InspectionResult, type JobCharacteristic, type JobInspection } from "../api.ts";
import { useJobInspection } from "./InspectPanel.tsx";
import { nominalText, samplingText, targetText } from "./InspectionPlan.tsx";
import { Badge, Button, cx, ErrorNote, Loading } from "./ui.tsx";

const resultsFor = (results: InspectionResult[], id: string) => results.filter((r) => r.characteristicId === id).sort((a, b) => b.piece - a.piece);
const limitText = (c: JobCharacteristic) =>
  c.kind === "note" ? "Pass / fail" : `${c.lower == null ? "no min" : nominalText({ ...c, nominal: c.lower })} – ${c.upper == null ? "no max" : nominalText({ ...c, nominal: c.upper })}`;
const opText = (c: JobCharacteristic) => (c.operation ? `${c.operation.sequence} ${c.operation.workCenter ?? ""}`.trim() : "Any step");
/** A reading shown with at least as many decimals as the limits ("1.250", not "1.25"). */
export const readingText = (c: JobCharacteristic, v: number) => {
  const want = nominalText(c).split(".")[1]?.length ?? 0;
  const have = (String(v).split(".")[1] ?? "").length;
  return v.toFixed(Math.max(want, have));
};
const cpkTone = (cpk: number | null) => (cpk == null ? "muted" : cpk >= 1.33 ? "ok" : cpk >= 1 ? "warn" : "bad");

/** Where each reading fell between the limits: a dot per reading, red when outside. */
function Spread({ c, results }: { c: JobCharacteristic; results: InspectionResult[] }) {
  const vals = results.filter((r) => r.value != null);
  if (c.kind === "note" || !vals.length) return <span className="text-xs text-muted">—</span>;
  const lo = c.lower ?? Math.min(...vals.map((r) => r.value!), c.nominal ?? 0);
  const hi = c.upper ?? Math.max(...vals.map((r) => r.value!), c.nominal ?? 0);
  const pad = (hi - lo) * 0.35 || 1;
  const x = (v: number) => 6 + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 108;
  return (
    <svg width="120" height="22" viewBox="0 0 120 22" aria-label={`${vals.length} readings`}>
      <line x1="6" x2="114" y1="11" y2="11" className="stroke-line" strokeWidth="1" />
      {c.lower != null && <line x1={x(c.lower)} x2={x(c.lower)} y1="4" y2="18" className="stroke-muted" strokeWidth="1.5" />}
      {c.upper != null && <line x1={x(c.upper)} x2={x(c.upper)} y1="4" y2="18" className="stroke-muted" strokeWidth="1.5" />}
      {c.nominal != null && <line x1={x(c.nominal)} x2={x(c.nominal)} y1="7" y2="15" className="stroke-accent" strokeWidth="1" strokeDasharray="2 2" />}
      {vals.map((r) => (
        <circle key={r.id} cx={Math.min(116, Math.max(4, x(r.value!)))} cy="11" r="3.5" className={r.passed === false ? "fill-bad" : "fill-ok"} opacity={0.85} />
      ))}
    </svg>
  );
}

function csv(insp: JobInspection) {
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [["Job", "Balloon", "Requirement", "Lower", "Upper", "Unit", "Step", "Piece", "Value", "Result", "Gauge", "By", "When"]];
  for (const c of insp.characteristics)
    for (const r of resultsFor(insp.results, c.id).reverse())
      rows.push([insp.job.number, String(c.number), c.kind === "note" ? (c.requirement ?? "") : targetText(c), String(c.lower ?? ""), String(c.upper ?? ""), c.unit, opText(c), String(r.piece), String(r.value ?? ""), r.passed === false ? "FAIL" : r.passed ? "PASS" : "", r.gauge ?? "", r.userName ?? "", r.recordedAt]);
  const blob = new Blob([rows.map((r) => r.map(esc).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${insp.job.number}-inspection.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function EmptyPlan({ insp, itemId }: { insp: JobInspection; itemId: string | null }) {
  const qc = useQueryClient();
  const copy = useMutation({
    mutationFn: () => api<JobInspection>(`/jobs/${insp.job.id}/inspection/plan`, "POST"),
    onSuccess: (d) => qc.setQueryData(["inspection", insp.job.id], d),
  });
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Ruler className="h-8 w-8 text-muted" />
      {insp.partPlanCount > 0 ? (
        <>
          <p>This job was made before the part had an inspection plan.</p>
          <Button variant="primary" onClick={() => copy.mutate()} disabled={copy.isPending}>
            Use the part's plan ({insp.partPlanCount} balloons)
          </Button>
          <ErrorNote error={copy.error} />
        </>
      ) : (
        <>
          <p>No inspection plan on this job.</p>
          <p className="max-w-md text-sm text-muted">
            Add balloons to the part's drawing on its page under Inspection plan. New jobs for the part pick the plan up by themselves.
            {itemId && (
              <>
                {" "}
                <Link to={`/items/${itemId}`} className="font-medium text-accent hover:underline">
                  Open the part
                </Link>
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

export function QualityTab({ jobId, itemId }: { jobId: string; itemId: string | null }) {
  const q = useJobInspection(jobId);
  const [issuesOnly, setIssuesOnly] = useState(false);
  const insp = q.data;
  // Columns for the pieces with the most readings (the sampled ones), newest first.
  const pieces = useMemo(() => {
    const n = new Map<number, number>();
    for (const r of insp?.results ?? []) n.set(r.piece, (n.get(r.piece) ?? 0) + 1);
    const many = [...n.entries()].filter(([, k]) => k > 1);
    return (many.length ? many : [...n.entries()])
      .sort((a, b) => b[1] - a[1] || b[0] - a[0])
      .slice(0, 6)
      .map(([p]) => p)
      .sort((a, b) => b - a);
  }, [insp]);
  if (q.isLoading || !insp) return q.error ? <ErrorNote error={q.error} /> : <Loading />;
  if (!insp.characteristics.length) return <EmptyPlan insp={insp} itemId={itemId} />;

  const rows = insp.characteristics.filter((c) => !issuesOnly || c.failures > 0 || (c.cpk != null && c.cpk < 1.33));
  const fails = insp.results.filter((r) => r.passed === false).length;
  const cpks = insp.characteristics.map((c) => c.cpk).filter((v): v is number => v != null);
  const lowest = cpks.length ? Math.min(...cpks) : null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {[
          ["Balloons", insp.characteristics.length, undefined],
          ["Readings", insp.results.length, undefined],
          ["Out of tolerance", fails, fails ? "text-bad" : "text-ok"],
          ["Lowest Cpk", lowest ?? "—", lowest == null ? undefined : lowest >= 1.33 ? "text-ok" : lowest >= 1 ? "text-warn" : "text-bad"],
        ].map(([k, v, tone]) => (
          <div key={k as string} className="rounded-lg bg-panel-2 px-3 py-2.5">
            <div className="text-xs text-muted">{k}</div>
            <div className={cx("num mt-0.5 text-lg font-semibold", tone as string)}>{v}</div>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="mr-auto flex items-center gap-2 text-sm">
          <input type="checkbox" checked={issuesOnly} onChange={(e) => setIssuesOnly(e.target.checked)} /> Only balloons with failures or a low Cpk
        </label>
        <Button onClick={() => csv(insp)} disabled={!insp.results.length}>
          <Download className="h-4 w-4" /> Download CSV
        </Button>
      </div>
      <div className="overflow-x-auto rounded-lg ring-1 ring-line">
        <table className="num w-full text-sm">
          <thead className="bg-panel-2 text-left text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Requirement</th>
              <th className="px-3 py-2 font-medium">How often</th>
              <th className="px-3 py-2 font-medium">Step</th>
              <th className="px-3 py-2 text-right font-medium">Cpk</th>
              <th className="px-3 py-2 font-medium">Spread</th>
              {pieces.map((p) => (
                <th key={p} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                  Piece {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const rs = resultsFor(insp.results, c.id);
              return (
                <tr key={c.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <span className={cx("flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-2", c.failures ? "bg-bad text-white ring-bad" : "text-accent ring-accent")}>{c.number}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="font-medium">{c.kind === "note" ? c.requirement : targetText(c)}</div>
                    <div className="text-xs text-muted">{limitText(c)}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">{samplingText(c)}</td>
                  <td className="max-w-[150px] truncate whitespace-nowrap px-3 py-2 text-muted" title={opText(c)}>{opText(c)}</td>
                  <td className="px-3 py-2 text-right">{c.cpk != null ? <Badge tone={cpkTone(c.cpk)}>{c.cpk.toFixed(2)}</Badge> : <span className="text-muted">—</span>}</td>
                  <td className="px-3 py-2">
                    <Spread c={c} results={rs} />
                  </td>
                  {pieces.map((p) => {
                    const r = rs.find((x) => x.piece === p);
                    return (
                      <td key={p} className={cx("whitespace-nowrap px-3 py-2 text-right", r?.passed === false && "font-semibold text-bad")}>
                        {r ? (r.value != null ? readingText(c, r.value) : r.passed ? "Pass" : "Fail") : c.due.includes(p) ? <span className="text-warn">due</span> : <span className="text-line">·</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6 + pieces.length} className="px-3 py-6 text-center text-muted">
                  No issues. Every reading is in tolerance.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">Cpk needs two or more readings that differ. 1.33 or more is shown green, 1.00 to 1.33 amber, below 1.00 red.</p>
    </div>
  );
}

// ── First-article inspection report ─────────────────────────────────────────

function reportHtml(insp: JobInspection, meta: { shop: string; customer: string | null; po: string | null }) {
  const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  // The report covers the first piece plus up to five more sampled pieces, most recent last.
  const counts = new Map<number, number>();
  for (const r of insp.results) counts.set(r.piece, (counts.get(r.piece) ?? 0) + 1);
  // Prefer pieces where several characteristics were measured (the sampled ones).
  const many = [...counts.keys()].filter((p) => counts.get(p)! > 1);
  const pieces = (many.length ? many : [...counts.keys()]).sort((a, b) => a - b);
  const shown = pieces.length > 6 ? [pieces[0]!, ...pieces.slice(-5)] : pieces;
  const allIn = insp.results.every((r) => r.passed !== false);
  const missing = insp.characteristics.filter((c) => !insp.results.some((r) => r.characteristicId === c.id && r.piece === 1)).length;
  const rows = insp.characteristics
    .map((c) => {
      const rs = insp.results.filter((r) => r.characteristicId === c.id);
      const cells = shown
        .map((p) => {
          const r = rs.find((x) => x.piece === p);
          return `<td class="v${r?.passed === false ? " bad" : ""}">${r ? esc(r.value != null ? readingText(c, r.value) : r.passed ? "PASS" : "FAIL") : ""}</td>`;
        })
        .join("");
      const status = rs.length ? (rs.some((r) => r.passed === false) ? '<b class="bad">REJECT</b>' : "ACCEPT") : "—";
      return `<tr><td class="c">${c.number}</td><td>${esc(c.kind === "note" ? c.requirement : targetText(c))}${c.critical ? " ★" : ""}${c.datums && !targetText(c).includes("|") ? ` <span class="m">[${esc(c.datums)}]</span>` : ""}</td><td>${esc(limitText(c))}</td><td>${esc(c.gauge ?? "")}</td><td>${esc(opText(c))}</td>${cells}<td class="c">${status}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Inspection report ${esc(insp.job.number)}</title>
<style>@page{size:letter landscape;margin:.4in}body{font:12px system-ui,-apple-system,Segoe UI,sans-serif;color:#111;margin:0}
h1{font-size:20px;margin:0 0 2px}.m{color:#666}.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:10px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #999;margin-bottom:12px}.grid div{padding:5px 8px;border-right:1px solid #ccc}.grid div:last-child{border-right:0}.grid span{display:block;font-size:10px;color:#666}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f0f2f4;font-size:11px}
.c{text-align:center}.v{text-align:right;font-variant-numeric:tabular-nums}.bad{color:#c62828;font-weight:700}
.sig{display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin-top:28px}.sig div{border-top:1px solid #111;padding-top:4px;font-size:11px;color:#444}
.verdict{margin-top:10px;font-size:13px}</style></head><body>
<div class="top"><div><h1>First-article inspection report</h1><div class="m">${esc(meta.shop)}</div></div><div class="m">Printed ${esc(new Date().toLocaleString())}</div></div>
<div class="grid"><div><span>Part number / revision</span>${esc(insp.part ? `${insp.part.partNumber} rev ${insp.part.revision}` : "—")}</div><div><span>Part name</span>${esc(insp.part?.description ?? insp.job.description)}</div><div><span>Job / quantity</span>${esc(insp.job.number)} · ${esc(insp.job.quantity)}</div><div><span>Customer / PO</span>${esc(meta.customer ?? "Stock")}${meta.po ? ` · ${esc(meta.po)}` : ""}</div></div>
<table><thead><tr><th class="c">#</th><th>Requirement</th><th>Limits</th><th>Gauge</th><th>Step</th>${shown.map((p) => `<th class="v">Piece ${p}</th>`).join("")}<th class="c">Result</th></tr></thead><tbody>${rows}</tbody></table>
<p class="verdict"><b>Summary:</b> ${insp.characteristics.length} characteristics, ${insp.results.length} readings. ${allIn ? "All readings within tolerance." : '<span class="bad">One or more readings out of tolerance.</span>'}${missing ? ` ${missing} characteristic(s) have no first-piece reading.` : ""}</p>
<div class="sig"><div>Inspected by</div><div>Approved by</div><div>Date</div></div>
</body></html>`;
}

export function ReportTab({ jobId, shop, customer, po }: { jobId: string; shop: string; customer: string | null; po: string | null }) {
  const q = useJobInspection(jobId);
  if (q.isLoading || !q.data) return q.error ? <ErrorNote error={q.error} /> : <Loading />;
  const insp = q.data;
  if (!insp.characteristics.length) return <p className="py-10 text-center text-sm text-muted">The report is built from the job's inspection plan and readings. Add a plan on the Quality tab first.</p>;
  const html = reportHtml(insp, { shop, customer, po });
  const print = () => {
    const w = window.open("", "_blank", "width=1100,height=800");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted">First-article inspection report from this job's readings: the first piece and up to five later sampled pieces.</p>
        <Button variant="primary" onClick={print}>
          <Printer className="h-4 w-4" /> Print or save as PDF
        </Button>
      </div>
      <iframe title="Inspection report" srcDoc={html} sandbox="" className="h-[560px] w-full rounded-lg bg-white ring-1 ring-line" />
    </div>
  );
}
