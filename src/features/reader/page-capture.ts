// Lets the reader's AI chat "see" a PDF page the way the user sees it in
// inline-draw mode: the rendered page with the user's drawings on top, as one
// JPEG. The drawings live as normalised vectors (inline-draw-store), so they
// are repainted here with Canvas 2D rather than screenshotting the SVG layer,
// which keeps the capture independent of zoom, scroll and whether the page is
// currently mounted.

import { renderPdfPagesToImages } from "@/lib/ai/ai-client";
import type { InlineElement } from "@/stores/inline-draw-store";

/** Same ceiling as the whiteboard snapshot: plenty for a vision model. */
const MAX_CAPTURE_WIDTH = 1280;
const JPEG_QUALITY = 0.82;
/** Arrowhead leg length in on-screen px, matching InlineDrawLayer. */
const ARROW_HEAD_PX = 11;
/** Matches the SVG layer's opacity so the capture reads like the screen. */
const STROKE_OPACITY = 0.95;

export interface CanvasPt {
  x: number;
  y: number;
}

/**
 * Stroke widths are stored as on-screen px at 1x zoom (the SVG layer uses
 * non-scaling-stroke). A page at 1x is `baseWidth` px wide, so a canvas that
 * is `canvasWidth` px wide needs every stroke scaled by the same ratio for the
 * drawing to keep its visual weight relative to the text.
 */
export function strokeScaleFor(canvasWidth: number, baseWidth: number): number {
  if (!(baseWidth > 0) || !(canvasWidth > 0)) return 1;
  return canvasWidth / baseWidth;
}

/** The two arrowhead leg endpoints for a shaft ending at (x2, y2), in canvas
 *  px. Computed in pixel space so the head keeps its angle on non-square
 *  pages, like the SVG layer's arrowHead. */
export function arrowHeadPoints(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  headPx: number,
): { a: CanvasPt; b: CanvasPt } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return null;
  const ang = Math.atan2(dy, dx);
  const a1 = ang - Math.PI / 6;
  const a2 = ang + Math.PI / 6;
  return {
    a: { x: x2 - headPx * Math.cos(a1), y: y2 - headPx * Math.sin(a1) },
    b: { x: x2 - headPx * Math.cos(a2), y: y2 - headPx * Math.sin(a2) },
  };
}

/** The subset of CanvasRenderingContext2D the painter uses, so tests can pass
 *  a recording fake instead of a real canvas. */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | "save"
  | "restore"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "rect"
  | "ellipse"
  | "stroke"
  | "strokeStyle"
  | "lineWidth"
  | "lineCap"
  | "lineJoin"
  | "globalAlpha"
>;

/** Paint inline-draw elements onto a canvas of `width` x `height` px.
 *  `scale` converts the stored 1x stroke widths to canvas px. */
export function drawInlineElements(
  ctx: DrawContext,
  elements: readonly InlineElement[],
  size: { width: number; height: number; scale: number },
): void {
  const { width: W, height: H, scale } = size;
  for (const el of elements) {
    ctx.save();
    ctx.strokeStyle = el.color;
    ctx.lineWidth = Math.max(1, el.width * scale);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.globalAlpha = STROKE_OPACITY;
    ctx.beginPath();
    switch (el.type) {
      case "pen": {
        el.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * W, p.y * H);
          else ctx.lineTo(p.x * W, p.y * H);
        });
        // a single tap is a dot on screen; give it length so round caps paint it
        if (el.points.length === 1) {
          ctx.lineTo(el.points[0].x * W + 0.01, el.points[0].y * H);
        }
        break;
      }
      case "rectangle": {
        const x = Math.min(el.x, el.x + el.w) * W;
        const y = Math.min(el.y, el.y + el.h) * H;
        ctx.rect(x, y, Math.abs(el.w) * W, Math.abs(el.h) * H);
        break;
      }
      case "ellipse":
        ctx.ellipse(
          el.cx * W,
          el.cy * H,
          Math.abs(el.rx) * W,
          Math.abs(el.ry) * H,
          0,
          0,
          Math.PI * 2,
        );
        break;
      case "line":
      case "arrow": {
        const x1 = el.x1 * W;
        const y1 = el.y1 * H;
        const x2 = el.x2 * W;
        const y2 = el.y2 * H;
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        if (el.type === "arrow") {
          const head = arrowHeadPoints(x1, y1, x2, y2, ARROW_HEAD_PX * scale);
          if (head) {
            ctx.moveTo(x2, y2);
            ctx.lineTo(head.a.x, head.a.y);
            ctx.moveTo(x2, y2);
            ctx.lineTo(head.b.x, head.b.y);
          }
        }
        break;
      }
    }
    ctx.stroke();
    ctx.restore();
  }
}

/** Base64 JPEG (no data-URI prefix) of one PDF page with `elements` drawn on
 *  top, or null when the page can't be rendered. */
export async function capturePdfPageWithDrawings(
  fileUrl: string,
  page: number,
  elements: readonly InlineElement[],
): Promise<{ data: string; media_type: "image/jpeg" } | null> {
  const [rendered] = await renderPdfPagesToImages(fileUrl, [page], {
    maxWidth: MAX_CAPTURE_WIDTH,
    quality: JPEG_QUALITY,
    overlay: (ctx, info) =>
      drawInlineElements(ctx, elements, {
        width: info.width,
        height: info.height,
        scale: strokeScaleFor(info.width, info.baseWidth),
      }),
  });
  if (!rendered) return null;
  return { data: rendered.base64, media_type: rendered.mediaType };
}
