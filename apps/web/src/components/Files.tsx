import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Box, ChevronLeft, ChevronRight, Download, File as FileIcon, FileImage, FileText, Loader2, Maximize2, PenTool, Trash2, Upload } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api.ts";
import { useThumb } from "../thumbs.ts";
import { Button, cx, ErrorNote, Loading, Modal } from "./ui.tsx";

const Viewer3D = lazy(() => import("./Viewer3D.tsx"));
const DxfView = lazy(() => import("./DxfView.tsx"));

export type FileRow = {
  id: string;
  fileName: string;
  mime: string;
  size: number;
  kind: string;
  inherited: string | null;
  createdAt: string;
  /** CAD only: the server prepares a light 3D file once after upload. */
  preview?: "pending" | "ready" | "failed" | null;
  uploadedBy?: string | null;
  previewError?: string | null;
};

/** Keep asking while a CAD upload is still being prepared, so the viewer opens by itself. */
export const pollWhilePreparing = (q: { state: { data?: FileRow[] } }) => (q.state.data?.some((f) => f.preview === "pending") ? 3000 : false);
type Entity = "item" | "job" | "quote" | "customer" | "sales_order" | "stock_lot";

export const fileUrl = (id: string, download = false) => `/api/v1/files/${id}${download ? "?download=1" : ""}`;
const KIND_ICON = { cad: Box, mesh: Box, dxf: PenTool, pdf: FileText, image: FileImage, other: FileIcon } as Record<string, typeof Box>;
const ACCEPT = ".step,.stp,.iges,.igs,.brep,.stl,.obj,.glb,.gltf,.3mf,.ply,.dxf,.pdf,.png,.jpg,.jpeg,.webp,.gif,.sldprt,.sldasm,.slddrw,.f3d,.dwg,.x_t,.csv,.xlsx,.txt,.nc,.tap";
const size = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const NATIVE_CAD = /\.(sldprt|sldasm|f3d|x_t|ipt|iam|catpart|prt)$/i;

/** A file in the strip: the model's snapshot once it has been viewed, otherwise its type. */
function FileThumb({ file, active, onClick, className = "h-20 w-20" }: { file: FileRow; active: boolean; onClick: () => void; className?: string }) {
  const snap = useThumb(file.kind === "cad" || file.kind === "mesh" ? file.id : undefined);
  const Icon = KIND_ICON[file.kind] ?? FileIcon;
  const img = file.kind === "image" ? fileUrl(file.id) : snap;
  return (
    <button
      type="button"
      onClick={onClick}
      title={file.fileName}
      aria-pressed={active}
      className={cx(
        "flex shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg bg-panel-2 ring-1",
        className,
        active ? "ring-2 ring-accent" : "ring-line hover:ring-accent/50",
        !img && "p-1",
      )}
    >
      {img ? (
        <img src={img} alt="" className="h-full w-full object-cover" />
      ) : (
        <>
          <Icon className="h-6 w-6 text-accent" />
          <span className="w-full truncate px-1 text-center text-[10px] text-muted">{file.fileName.split(".").pop()?.toUpperCase()}</span>
        </>
      )}
    </button>
  );
}

export function FilePreview({ file, compact = false, immersive = false }: { file: FileRow; compact?: boolean; immersive?: boolean }) {
  const url = fileUrl(file.id);
  return (
    <Suspense fallback={<Loading />}>
      {file.kind === "cad" && file.preview === "pending" ? (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl bg-panel-2 p-6 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-accent" />
          <div className="text-sm font-medium">Preparing the 3D view…</div>
          <p className="max-w-sm text-sm text-muted">
            This happens once per upload. Large assemblies can take a minute or two; the model opens here by itself when it is ready.
          </p>
        </div>
      ) : file.kind === "cad" && file.preview === "ready" ? (
        <Viewer3D key={file.id} url={`${url}/preview`} name={file.fileName} prepared compact={compact} thumbId={file.id} immersive={immersive} />
      ) : file.kind === "cad" || file.kind === "mesh" ? (
        <Viewer3D key={file.id} url={url} name={file.fileName} compact={compact} thumbId={file.id} immersive={immersive} />
      ) : file.kind === "dxf" ? (
        <DxfView key={file.id} url={url} />
      ) : file.kind === "pdf" ? (
        <iframe title={file.fileName} src={url} className="h-full min-h-[320px] w-full rounded-xl bg-panel-2" />
      ) : file.kind === "image" ? (
        <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl bg-panel-2 p-3">
          <img src={url} alt={file.fileName} className="max-h-full max-w-full object-contain" />
        </div>
      ) : (
        <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-3 rounded-xl bg-panel-2 p-6 text-center">
          <FileIcon className="h-10 w-10 text-muted" />
          <div className="text-sm font-medium">{file.fileName}</div>
          <p className="max-w-sm text-sm text-muted">
            {NATIVE_CAD.test(file.fileName)
              ? "This is a native CAD file. Export it as STEP from your CAD program and upload that copy to see it in 3D here."
              : "This file type has no preview. Download it to open it."}
          </p>
          <a href={fileUrl(file.id, true)} className="text-sm font-medium text-accent hover:underline">
            Download {size(file.size)}
          </a>
        </div>
      )}
    </Suspense>
  );
}

/** Upload files to a record, one at a time; stops at the first failure. */
export async function uploadFiles(entity: Entity, entityId: string, fs: File[]) {
  for (const f of fs) {
    const body = new FormData();
    body.append("file", f);
    const res = await fetch(`/api/v1/files?entity=${entity}&entityId=${entityId}`, { method: "POST", body, credentials: "same-origin" });
    if (!res.ok) {
      const d = await res.json().catch(() => null);
      throw new ApiError(res.status, d?.error?.message ?? `Upload failed (${res.status})`);
    }
  }
}

/** Drop zone for a record that is not saved yet: files wait here and go up once it is saved. */
export function PendingFiles({ files, onChange, busy = false }: { files: File[]; onChange: (fs: File[]) => void; busy?: boolean }) {
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = (fl: FileList | null) => fl && fl.length && onChange([...files, ...fl]);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => (e.preventDefault(), setDrag(false), add(e.dataTransfer.files))}
      className={cx("space-y-3 rounded-xl transition-colors", drag && "bg-accent-soft ring-2 ring-accent")}
    >
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-12 text-center hover:border-accent hover:bg-accent-soft/40"
      >
        {busy ? <Loader2 className="h-8 w-8 animate-spin text-accent" /> : <Upload className="h-8 w-8 text-accent" />}
        <span className="text-sm font-medium">{busy ? "Saving the part and uploading…" : "Drop drawings and 3D models here, or click to choose"}</span>
        <span className="text-xs text-muted">Fill in the part number and description first: the part is saved and the drawing opens here, ready for the operations</span>
      </button>
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-lg ring-1 ring-line">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileIcon className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              <span className="num text-xs text-muted">{size(f.size)}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-bad" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Files of a record: thumbnail strip, large viewer, upload, download, delete, full screen. */
export function FilesPanel({ entity, entityId, height = 460, onCount }: { entity: Entity; entityId: string; height?: number; onCount?: (n: number) => void }) {
  const qc = useQueryClient();
  const key = ["files", entity, entityId];
  const list = useQuery({ queryKey: key, queryFn: () => api<FileRow[]>(`/files?entity=${entity}&entityId=${entityId}`), refetchInterval: pollWhilePreparing });
  const files = list.data ?? [];
  const [idx, setIdx] = useState(0);
  const [full, setFull] = useState(false);
  const [drag, setDrag] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FileRow | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => onCount?.(files.length), [files.length, onCount]);
  useEffect(() => {
    // Open the first 3D model by default; that is what people want to look at.
    const first3d = files.findIndex((f) => f.kind === "cad" || f.kind === "mesh");
    setIdx(first3d >= 0 ? first3d : 0);
    // Only when the set of files changes, not on every refresh while a model is being prepared.
  }, [files.map((f) => f.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  const upload = useMutation({
    mutationFn: (fs: File[]) => uploadFiles(entity, entityId, fs),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({ mutationFn: (id: string) => api(`/files/${id}`, "DELETE"), onSuccess: () => (qc.invalidateQueries({ queryKey: key }), setConfirmDelete(null)) });
  const current = files[Math.min(idx, files.length - 1)];

  const drop = (fl: FileList | null) => fl && fl.length && upload.mutate([...fl]);

  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setDrag(true))}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => (e.preventDefault(), setDrag(false), drop(e.dataTransfer.files))}
      className={cx("rounded-xl transition-colors", drag && "bg-accent-soft ring-2 ring-accent")}
    >
      <input ref={input} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => (drop(e.target.files), (e.target.value = ""))} />
      {list.isLoading ? (
        <Loading />
      ) : !files.length ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-14 text-center hover:border-accent hover:bg-accent-soft/40"
        >
          <Box className="h-8 w-8 text-accent" />
          <span className="text-sm font-medium">Drop drawings and 3D models here, or click to choose</span>
          <span className="text-xs text-muted">STEP, IGES, STL, OBJ, GLB, 3MF in 3D · DXF flat patterns · PDF and images</span>
        </button>
      ) : (
        <div className="space-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2">
              <div className="min-w-0 truncate text-sm">
                <span className="font-medium">{current?.fileName}</span>
                {current?.inherited && <span className="text-muted"> · from the {current.inherited}</span>}
              </div>
              <div className="num flex items-center gap-1 text-sm text-muted">
                <button type="button" aria-label="Previous file" className="rounded p-1 hover:bg-panel-2" onClick={() => setIdx((idx - 1 + files.length) % files.length)}>
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {idx + 1} / {files.length}
                <button type="button" aria-label="Next file" className="rounded p-1 hover:bg-panel-2" onClick={() => setIdx((idx + 1) % files.length)}>
                  <ChevronRight className="h-4 w-4" />
                </button>
                <Button variant="ghost" title="Full screen" aria-label="Full screen" onClick={() => setFull(true)}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div style={{ height }}>{current && <FilePreview file={current} />}</div>
          </div>

          <section className="overflow-hidden rounded-xl ring-1 ring-line">
            <header className="flex items-center justify-between gap-2 bg-panel-2/60 px-3 py-2">
              <h3 className="font-semibold">File attachments</h3>
              <Button variant="ghost" onClick={() => input.current?.click()}>
                <Upload className="h-4 w-4" /> Upload
              </Button>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-[13px] text-muted">
                  <tr className="border-b border-line">
                    <th className="w-20 px-3 py-2 font-medium">Preview</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Uploaded by</th>
                    <th className="px-3 py-2 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {files.map((f, i) => (
                    <tr key={f.id} className={cx(i === idx && "bg-accent-soft/50")}>
                      <td className="px-3 py-2">
                        <FileThumb file={f} active={i === idx} onClick={() => setIdx(i)} className="h-12 w-16" />
                      </td>
                      <td className="max-w-0 px-3 py-2">
                        <button type="button" onClick={() => setIdx(i)} className="block max-w-full truncate text-left font-medium text-accent hover:underline" title={f.fileName}>
                          {f.fileName}
                        </button>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                          <span className="num">{size(f.size)}</span>
                          <span>{f.fileName.split(".").pop()?.toUpperCase()}</span>
                          {f.preview === "pending" && <span className="text-warn">Preparing 3D view…</span>}
                          {f.preview === "failed" && <span className="text-bad">3D view failed</span>}
                          {f.inherited && <span className="rounded bg-panel-2 px-1.5">From the {f.inherited}</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{f.uploadedBy ?? "—"}</div>
                        <div className="num text-xs text-muted">{new Date(f.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => setIdx(i)} aria-label={`View ${f.fileName}`}>View</Button>
                          <a href={fileUrl(f.id, true)} title="Download" aria-label={`Download ${f.fileName}`} className="inline-flex min-h-9 items-center rounded-lg px-2 text-ink hover:bg-panel-2">
                            <Download className="h-4 w-4" />
                          </a>
                          {!f.inherited && (
                            <Button variant="ghost" title="Delete file" aria-label={`Delete ${f.fileName}`} className="text-bad" onClick={() => setConfirmDelete(f)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button type="button" onClick={() => input.current?.click()} className="w-full border-t border-dashed border-line px-3 py-3 text-center text-sm text-muted hover:bg-accent-soft/40 hover:text-accent">
              Drop files here or <span className="font-medium text-accent">browse</span>
            </button>
          </section>
        </div>
      )}
      {upload.isPending && <div className="mt-2 text-sm text-muted">Uploading…</div>}
      <div className="mt-2 space-y-2">
        <ErrorNote error={upload.error} />
        <ErrorNote error={remove.error} />
      </div>
      <Modal open={!!confirmDelete} title="Delete file?" onClose={() => setConfirmDelete(null)}>
        <p className="text-sm">
          <span className="font-medium">{confirmDelete?.fileName}</span> will be removed from this record. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setConfirmDelete(null)}>Keep it</Button>
          <Button variant="danger" onClick={() => confirmDelete && remove.mutate(confirmDelete.id)} disabled={remove.isPending}>Delete file</Button>
        </div>
      </Modal>
      {current && (
        <Modal open={full} title={current.fileName} onClose={() => setFull(false)} wide>
          <div className="h-[70vh]">{full && <FilePreview file={current} />}</div>
        </Modal>
      )}
    </div>
  );
}
