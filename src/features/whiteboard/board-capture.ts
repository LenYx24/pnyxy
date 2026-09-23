// Lets the whiteboard chat panel grab a snapshot of the current board so the
// AI can "see" what the user drew. The canvas registers itself here on mount
// (there's only ever one active board canvas), and the chat panel reads a
// downscaled JPEG from it on demand, cheap, since the board is already a
// <canvas> (no html2canvas needed). The snapshot is the current viewport of
// the board, which is also the frame the drawing tools describe to the model.

let activeBoardCanvas: HTMLCanvasElement | null = null;

/** Widest snapshot we hand a model. Boards render at device-pixel scale, so
 *  the raw canvas can be 3000px+ wide: far more detail than a vision model
 *  uses, at several megabytes of base64. */
const MAX_SNAPSHOT_WIDTH = 1280;
const JPEG_QUALITY = 0.82;

export function registerBoardCanvas(el: HTMLCanvasElement | null): void {
  activeBoardCanvas = el;
}

/** True when a board canvas is mounted and can be snapshotted. */
export function hasBoardCanvas(): boolean {
  return activeBoardCanvas !== null;
}

/** Base64 JPEG (no data-URI prefix) of the current board view, or null. */
export function captureBoardImage(): {
  data: string;
  media_type: "image/jpeg";
} | null {
  const source = activeBoardCanvas;
  if (!source || source.width === 0 || source.height === 0) return null;
  try {
    const scale = Math.min(1, MAX_SNAPSHOT_WIDTH / source.width);
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d");
    if (!ctx) return null;
    // JPEG has no alpha: paint the page white first, or transparent board
    // areas come out black and the drawing disappears into them.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    const dataUrl = out.toDataURL("image/jpeg", JPEG_QUALITY);
    const comma = dataUrl.indexOf(",");
    return {
      data: comma === -1 ? dataUrl : dataUrl.slice(comma + 1),
      media_type: "image/jpeg",
    };
  } catch {
    // tainted canvas (shouldn't happen, all content is same-origin) etc.
    return null;
  }
}

/** The board canvas's on-screen size, for telling the model which slice of
 *  world space the user is looking at. */
export function boardViewportSize(): { width: number; height: number } | null {
  const el = activeBoardCanvas;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { width: rect.width, height: rect.height };
}
