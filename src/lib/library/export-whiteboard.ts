import type { WhiteboardData } from "@/types/whiteboard";

/**
 * Whiteboards have no meaningful plain-text form (they're vector
 * scenes), but the underlying `WhiteboardData` is plain JSON — so the
 * portable, no-vendor-lock-in export is the JSON document itself. The
 * user can re-import or inspect it in any editor. (SVG/PNG raster
 * exports are a separate, heavier feature — deferred.)
 */
export function whiteboardToJson(wb: WhiteboardData): string {
  return JSON.stringify(wb, null, 2);
}

function whiteboardFileStem(wb: Pick<WhiteboardData, "id" | "title">): string {
  const base = wb.title.trim() || `whiteboard-${wb.id.slice(0, 8)}`;
  return (
    base
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || `whiteboard-${wb.id.slice(0, 8)}`
  );
}

/** Trigger a browser download of the whiteboard as a `.json` file. */
export function downloadWhiteboardJson(wb: WhiteboardData): void {
  const blob = new Blob([whiteboardToJson(wb)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${whiteboardFileStem(wb)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
