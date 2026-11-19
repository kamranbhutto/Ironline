/**
 * Operator inspection: the balloons checked at this routing step, the piece being checked, one
 * input per balloon (or pass/fail for notes), red when a reading is out of tolerance. "Expand"
 * shows every sampled piece so far.
 */
import { inTolerance } from "@ironline/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Ruler, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type InspectionResult, type JobCharacteristic, type JobInspection } from "../api.ts";
import type { BalloonMark } from "./Drawing.tsx";
import { kindOf, nominalText, samplingText, targetText } from "./InspectionPlan.tsx";
import { cx, ErrorNote } from "./ui.tsx";

export const useJobInspection = (jobId: string | undefined) =>
  useQuery({ queryKey: ["inspection", jobId], queryFn: () => api<JobInspection>(`/jobs/${jobId}/inspection`), enabled: !!jobId, refetchInterval: 20_000 });

/** Balloons for this step. Ones not tied to a step are checked at the last step. */
export const stepCharacteristics = (insp: JobInspection | undefined, seq: number) => {
  if (!insp) return [];
  const last = insp.operations.at(-1)?.sequence;
  const steps = new Set(insp.operations.map((o) => o.sequence));
  // A balloon whose step is not on this job (the job's routing came from the quote) is checked at the last step.
  return insp.characteristics.filter((c) => (c.operationSeq != null && steps.has(c.operationSeq) ? c.operationSeq : last) === seq);
};

const resultOf = (results: InspectionResult[], charId: string, piece: number) => results.find((r) => r.characteristicId === charId && r.piece === piece);

/** Pieces anyone at this step must check, in order. */
export const duePieces = (chars: JobCharacteristic[]) => [...new Set(chars.flatMap((c) => c.due))].sort((a, b) => a - b);

/** The first sampled piece that still has a missing reading, or the last sampled piece. */
export function nextPiece(chars: JobCharacteristic[], results: InspectionResult[]) {
  const pieces = duePieces(chars);
  return pieces.find((p) => chars.some((c) => c.due.includes(p) && !resultOf(results, c.id, p))) ?? pieces.at(-1) ?? 1;
}

/** How many balloons still need a reading on pieces already made (for the menu badge). */
export function openChecks(chars: JobCharacteristic[], results: InspectionResult[], made: number) {
  let n = 0;
  for (const c of chars) for (const p of c.due) if (p <= Math.max(1, made + 1) && !resultOf(results, c.id, p)) n += 1;
  return n;
}

export function balloonMarks(chars: JobCharacteristic[], results: InspectionResult[], piece: number, fileId: string, page: number, selected?: string | null): BalloonMark[] {
  return chars
    .filter((c) => c.attachmentId === fileId && c.page === page && c.x != null && c.y != null)
    .map((c) => {
      const r = resultOf(results, c.id, piece);
      const tone = r?.passed === false ? "bad" : r ? "ok" : c.due.includes(piece) ? (selected === c.id ? "selected" : "due") : "muted";
      return { key: c.id, number: c.number, x: c.x!, y: c.y!, tone, tag: r ? (r.value != null ? String(r.value) : r.passed ? "OK" : "NG") : undefined };
    });
}

export function InspectPanel({
  insp,
  chars,
  piece,
  onPiece,
  expanded,
  onExpand,
  canRecord,
  focus,
  onFocus,
}: {
  insp: JobInspection;
  chars: JobCharacteristic[];
  piece: number;
  onPiece: (p: number) => void;
  expanded: boolean;
  onExpand: (v: boolean) => void;
  canRecord: boolean;
  focus: string | null;
  onFocus: (id: string | null) => void;
}) {
  const qc = useQueryClient();
  const due = useMemo(() => chars.filter((c) => c.due.includes(piece)), [chars, piece]);
  const pieces = duePieces(chars);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [pass, setPass] = useState<Record<string, boolean | null>>({});

  // Start from what is already saved for this piece.
  useEffect(() => {
    const d: Record<string, string> = {};
    const p: Record<string, boolean | null> = {};
    for (const c of due) {
      const r = resultOf(insp.results, c.id, piece);
      d[c.id] = r?.value != null ? String(r.value) : "";
      p[c.id] = r?.passed ?? null;
    }
    setDraft(d);
    setPass(p);
    // Only reset when the piece or the saved readings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece, insp.results]);

  const save = useMutation({
    mutationFn: () =>
      api<JobInspection>(`/jobs/${insp.job.id}/inspection/readings`, "POST", {
        piece,
        readings: due.map((c) =>
          c.kind === "note"
            ? { characteristicId: c.id, passed: pass[c.id] ?? null }
            : { characteristicId: c.id, value: draft[c.id]?.trim() ? Number(draft[c.id]) : null },
        ),
      }),
    onSuccess: (data) => {
      qc.setQueryData(["inspection", insp.job.id], data);
      // Jump to the next piece that still needs checking, unless this piece failed a check.
      if (data.results.some((r) => r.piece === piece && r.passed === false && chars.some((c) => c.id === r.characteristicId))) return;
      const stepChars = data.characteristics.filter((c) => chars.some((x) => x.id === c.id));
      const n = nextPiece(stepChars, data.results);
      if (n !== piece) onPiece(n);
    },
  });

  const idx = pieces.indexOf(piece);
  const bad = due.some((c) => c.kind !== "note" && draft[c.id]?.trim() && inTolerance(c, Number(draft[c.id])) === false);
  const changed = due.some((c) => {
    const r = resultOf(insp.results, c.id, piece);
    return c.kind === "note" ? (pass[c.id] ?? null) !== (r?.passed ?? null) : (draft[c.id] ?? "") !== (r?.value != null ? String(r.value) : "");
  });

  if (!chars.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <Ruler className="h-8 w-8 text-muted" />
        <p className="text-lg">Nothing to measure at this step.</p>
        <p className="text-sm text-muted">The part's inspection plan has no balloons for this operation.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-line bg-panel px-3 py-2.5">
        <button type="button" disabled={idx <= 0} onClick={() => onPiece(pieces[idx - 1]!)} className="flex items-center gap-1 rounded-xl px-2 py-2 text-[15px] hover:bg-panel-2 disabled:opacity-30">
          <ChevronLeft className="h-5 w-5" /> Prev
        </button>
        <div className="flex-1 text-center">
          <div className="text-xs text-muted">{piece === 1 ? "First piece" : "Sampled piece"}</div>
          <div className="num text-xl font-semibold">
            Piece {piece} <span className="text-base font-normal text-muted">of {insp.job.quantity}</span>
          </div>
        </div>
        <button type="button" disabled={idx < 0 || idx >= pieces.length - 1} onClick={() => onPiece(pieces[idx + 1]!)} className="flex items-center gap-1 rounded-xl px-2 py-2 text-[15px] hover:bg-panel-2 disabled:opacity-30">
          Next <ChevronRight className="h-5 w-5" />
        </button>
        <button type="button" onClick={() => onExpand(!expanded)} className="rounded-xl p-2 hover:bg-panel-2" aria-label={expanded ? "Show one piece" : "Show all pieces"} title={expanded ? "Show one piece" : "Show all pieces"}>
          {expanded ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
        </button>
      </div>

      {expanded ? (
        <HistoryGrid chars={chars} results={insp.results} pieces={pieces} current={piece} onPiece={(p) => (onPiece(p), onExpand(false))} />
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {!due.length && <p className="rounded-xl bg-panel p-4 text-center text-muted">Nothing is due on piece {piece}.</p>}
          {due.map((c) => {
            const v = draft[c.id] ?? "";
            const ok = c.kind === "note" ? pass[c.id] : v.trim() ? inTolerance(c, Number(v)) : null;
            return (
              <div
                key={c.id}
                onClick={() => onFocus(c.id)}
                className={cx(
                  "flex items-center gap-3 rounded-2xl bg-panel p-3 shadow-[0_2px_8px_rgba(23,34,48,0.06)] ring-1 transition",
                  ok === false ? "bg-bad-soft ring-bad" : focus === c.id ? "ring-2 ring-accent" : "ring-transparent",
                )}
              >
                <span className={cx("num flex h-10 min-w-10 items-center justify-center rounded-full text-[15px] font-bold ring-2", ok === false ? "bg-bad text-white ring-bad" : ok ? "bg-white text-ok ring-ok" : "bg-white text-warn ring-warn")}>
                  {c.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="num flex items-center gap-1.5 text-[17px] font-semibold">
                    <span className="truncate">{c.kind === "note" ? c.requirement : targetText(c)}</span>
                    {c.critical && <Star className="h-4 w-4 shrink-0 fill-warn text-warn" aria-label="Critical" />}
                  </div>
                  <div className="num truncate text-sm text-muted">
                    {c.kind !== "note" && (c.lower != null || c.upper != null) ? `${c.lower == null ? "no min" : nominalText({ ...c, nominal: c.lower })} to ${c.upper == null ? "no max" : nominalText({ ...c, nominal: c.upper })} · ` : ""}
                    {c.gauge ?? kindOf(c.kind).label}
                  </div>
                </div>
                {c.kind === "note" ? (
                  <div className="flex gap-1">
                    {[
                      [true, "Pass"],
                      [false, "Fail"],
                    ].map(([val, label]) => (
                      <button
                        key={String(label)}
                        type="button"
                        disabled={!canRecord}
                        onClick={() => setPass({ ...pass, [c.id]: pass[c.id] === val ? null : (val as boolean) })}
                        className={cx(
                          "rounded-xl px-3 py-2.5 text-[15px] font-medium ring-1",
                          pass[c.id] === val ? (val ? "bg-ok text-white ring-ok" : "bg-bad text-white ring-bad") : "bg-panel-2 ring-line",
                        )}
                      >
                        {label as string}
                      </button>
                    ))}
                  </div>
                ) : (
                  <input
                    inputMode="decimal"
                    disabled={!canRecord}
                    aria-label={`Reading for balloon ${c.number}`}
                    placeholder={nominalText(c)}
                    value={v}
                    onFocus={() => onFocus(c.id)}
                    onChange={(e) => setDraft({ ...draft, [c.id]: e.target.value.replace(/[^0-9.\-]/g, "") })}
                    className={cx(
                      "num h-12 w-28 rounded-xl px-3 text-right text-lg font-semibold outline-none ring-1 focus:ring-2",
                      ok === false ? "bg-white text-bad ring-bad focus:ring-bad" : "bg-[#e3f3fd] text-[#1a73c9] ring-transparent focus:ring-accent",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {!expanded && due.length > 0 && (
        <div className="border-t border-line bg-panel p-3">
          <ErrorNote error={save.error} />
          {bad && <p className="mb-2 text-sm text-bad">Out of tolerance. Save the reading, then tell the office from Chat or send the part to rework or scrap.</p>}
          <button
            type="button"
            disabled={!canRecord || !changed || save.isPending}
            onClick={() => save.mutate()}
            className="w-full rounded-xl bg-[#1f7ae0] py-3.5 text-lg font-semibold uppercase tracking-wide text-white disabled:opacity-40"
          >
            {save.isPending ? "Saving…" : changed ? `Save piece ${piece}` : "Saved"}
          </button>
          <p className="mt-1.5 text-center text-xs text-muted">{chars.map((c) => `${c.number}: ${samplingText(c).toLowerCase()}`).join(" · ")}</p>
        </div>
      )}
    </div>
  );
}

function HistoryGrid({ chars, results, pieces: all, current, onPiece }: { chars: JobCharacteristic[]; results: InspectionResult[]; pieces: number[]; current: number; onPiece: (p: number) => void }) {
  // Pieces checked so far plus the next few due, not every piece of a long run.
  const reach = Math.max(current, ...results.filter((r) => chars.some((c) => c.id === r.characteristicId)).map((r) => r.piece));
  const upto = all.findIndex((p) => p > reach);
  const pieces = upto < 0 ? all : all.slice(0, upto + 4);
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3">
      <table className="num w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="sticky left-0 min-w-[210px] bg-[#f4f5f7] px-2 py-1 font-medium">Balloon</th>
            {pieces.map((p) => (
              <th key={p} className="whitespace-nowrap px-2 py-1 text-right font-medium">
                <button type="button" onClick={() => onPiece(p)} className={cx("rounded px-1.5 py-0.5 hover:bg-panel", p === current && "bg-accent text-white hover:bg-accent")}>
                  Piece {p}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chars.map((c) => (
            <tr key={c.id} className="bg-panel">
              <td className="sticky left-0 min-w-[210px] whitespace-nowrap rounded-l-xl bg-panel px-2 py-2">
                <div className="font-semibold">
                  {c.number} · {c.kind === "note" ? "Note" : targetText(c)}
                </div>
                <div className="text-xs text-muted">{c.gauge ?? samplingText(c)}</div>
              </td>
              {pieces.map((p) => {
                const r = resultOf(results, c.id, p);
                const due = c.due.includes(p);
                return (
                  <td key={p} className="px-2 py-2 text-right last:rounded-r-xl">
                    {!due ? (
                      <span className="text-line">·</span>
                    ) : r ? (
                      <span className={cx("rounded-md px-1.5 py-0.5 font-semibold", r.passed === false ? "bg-bad-soft text-bad" : "text-ink")}>{r.value ?? (r.passed ? "OK" : "NG")}</span>
                    ) : (
                      <span className="text-warn">due</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
