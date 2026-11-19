import { useQuery } from "@tanstack/react-query";
import { Box } from "lucide-react";
import { api } from "../api.ts";
import { useThumb } from "../thumbs.ts";
import { pollWhilePreparing, type FileRow } from "./Files.tsx";
import { cx } from "./ui.tsx";

/** Snapshot of a part's 3D model (taken the first time the viewer shows it), or a box icon. */
export function PartThumb({ itemId, className = "h-16 w-20" }: { itemId: string | null | undefined; className?: string }) {
  const files = useQuery({
    queryKey: ["files", "item", itemId],
    queryFn: () => api<FileRow[]>(`/files?entity=item&entityId=${itemId}`),
    enabled: !!itemId,
    refetchInterval: pollWhilePreparing,
    staleTime: 60_000,
  });
  const model = (files.data ?? []).find((f) => f.kind === "cad" || f.kind === "mesh");
  const thumb = useThumb(model?.id);
  return (
    <div className={cx("flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-panel-2", className)}>
      {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <Box className="h-1/3 w-1/3 text-muted" aria-hidden />}
    </div>
  );
}
