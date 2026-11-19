/**
 * One page of a drawing (PDF or image) with numbered balloons laid over it. Balloon positions are
 * fractions of the page, so they stay put at any zoom. Loaded lazily: pdf.js is large.
 */
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { fileUrl, type FileRow } from "./Files.tsx";
import { cx } from "./ui.tsx";

GlobalWorkerOptions.workerSrc = workerUrl;

export type BalloonTone = "plan" | "selected" | "ok" | "bad" | "due" | "muted";
export interface BalloonMark {
  key: string;
  number: number;
  x: number;
  y: number;
  tone: BalloonTone;
  /** Short text shown beside the balloon, e.g. the last reading. */
  tag?: string;
}

const TONE: Record<BalloonTone, string> = {
  plan: "bg-white text-accent ring-accent",
  selected: "bg-accent text-white ring-accent scale-110",
  ok: "bg-white text-ok ring-ok",
  bad: "bg-bad text-white ring-bad",
  due: "bg-warn text-white ring-warn",
  muted: "bg-white/90 text-muted ring-line",
};

const docs = new Map<string, Promise<PDFDocumentProxy>>();
const loadPdf = (id: string) => {
  if (!docs.has(id)) docs.set(id, getDocument({ url: fileUrl(id) }).promise);
  return docs.get(id)!;
};

export default function Drawing({
  file,
  page,
  zoom = 1,
  balloons,
  placing,
  onPlace,
  onBalloon,
  onPages,
  className,
}: {
  file: FileRow;
  page: number;
  zoom?: number;
  balloons: BalloonMark[];
  placing?: boolean;
  onPlace?: (x: number, y: number) => void;
  onBalloon?: (key: string) => void;
  onPages?: (n: number) => void;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [ratio, setRatio] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isPdf = file.kind === "pdf";

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Ignore tiny changes (a scrollbar coming and going): re-drawing for them made the page
    // shrink and grow in a loop, which looked like the drawing vibrating.
    const ro = new ResizeObserver(() => setWidth((w) => (Math.abs(el.clientWidth - w) > 24 ? el.clientWidth : w)));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const shown = Math.max(200, Math.round(width * zoom));

  useEffect(() => {
    if (!isPdf || !width) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | null = null;
    (async () => {
      try {
        const doc = await loadPdf(file.id);
        if (cancelled) return;
        onPages?.(doc.numPages);
        const p = await doc.getPage(Math.min(page, doc.numPages));
        const base = p.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const viewport = p.getViewport({ scale: (shown / base.width) * dpr });
        // Draw off-screen first, then swap it in, so the page never flashes blank while re-drawing.
        const off = document.createElement("canvas");
        off.width = Math.round(viewport.width);
        off.height = Math.round(viewport.height);
        task = p.render({ canvas: off, canvasContext: off.getContext("2d")!, viewport });
        await task.promise;
        const c = canvas.current;
        if (!c || cancelled) return;
        c.width = off.width;
        c.height = off.height;
        c.getContext("2d")!.drawImage(off, 0, 0);
        setRatio(base.height / base.width);
      } catch (e) {
        if (!cancelled && (e as Error)?.name !== "RenderingCancelledException") setError("This PDF could not be opened.");
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
    // onPages is a callback from the parent; re-rendering when it changes identity is not needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, page, shown, isPdf]);

  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!placing || !onPlace) return;
    const r = e.currentTarget.getBoundingClientRect();
    onPlace(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
  };

  if (!isPdf && file.kind !== "image") {
    return <div className="flex h-60 items-center justify-center rounded-xl bg-panel-2 text-sm text-muted">Balloons go on a PDF or image drawing. Upload one under Drawings &amp; 3D.</div>;
  }

  return (
    <div ref={box} className={cx("relative overflow-auto rounded-xl bg-[#e9ecef] [scrollbar-gutter:stable]", className)}>
      {error ? (
        <div className="flex h-60 items-center justify-center text-sm text-bad">{error}</div>
      ) : (
        <div
          onClick={click}
          className={cx("relative mx-auto bg-white shadow-[0_1px_4px_rgba(0,0,0,.18)]", placing && "cursor-crosshair")}
          style={{ width: shown, height: ratio ? shown * ratio : undefined }}
        >
          {isPdf ? (
            <canvas ref={canvas} className="block h-full w-full" />
          ) : (
            <img src={fileUrl(file.id)} alt={file.fileName} className="block w-full select-none" draggable={false} onLoad={(e) => setRatio(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)} />
          )}
          {!ratio && isPdf && (
            <div className="absolute inset-0 flex min-h-60 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-accent" />
            </div>
          )}
          {ratio &&
            balloons.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onBalloon?.(b.key);
                }}
                className="group absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2"
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}
                aria-label={`Balloon ${b.number}`}
              >
                <span className={cx("num flex h-7 min-w-7 items-center justify-center rounded-full px-1 text-[13px] font-bold shadow ring-2 transition", TONE[b.tone])}>{b.number}</span>
                {b.tag && <span className={cx("num rounded-md px-1.5 py-0.5 text-[12px] font-semibold shadow ring-1", b.tone === "bad" ? "bg-bad-soft text-bad ring-bad/40" : "bg-white text-ink ring-line")}>{b.tag}</span>}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
