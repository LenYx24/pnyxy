// Lets the whiteboard chat panel grab a snapshot of the current board so the
// AI can "see" what the user drew. The canvas registers itself here on mount
// (there's only ever one active board canvas), and the chat panel reads a PNG
// data URL from it on demand, cheap, since the board is already a <canvas>
// (no html2canvas needed). The snapshot is the current viewport of the board.

let activeBoardCanvas: HTMLCanvasElement | null = null;

export function registerBoardCanvas(el: HTMLCanvasElement | null): void {
  activeBoardCanvas = el;
}

/** Base64 PNG (no data-URI prefix) of the current board view, or null. */
export function captureBoardImage(): { data: string; media_type: string } | null {
  if (!activeBoardCanvas) return null;
  try {
    const dataUrl = activeBoardCanvas.toDataURL("image/png");
    const comma = dataUrl.indexOf(",");
    return {
      data: comma === -1 ? dataUrl : dataUrl.slice(comma + 1),
      media_type: "image/png",
    };
  } catch {
    // tainted canvas (shouldn't happen, all content is same-origin) etc.
    return null;
  }
}
