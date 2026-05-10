/* eslint-disable react-hooks/exhaustive-deps --
   `store` here is the imported Zustand hook aliased to a local const; its
   reference is stable across renders, so omitting it from deps is safe. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Point, TextElement, WhiteboardElement } from "@/types/whiteboard";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import {
  drawBackground,
  drawElement,
  drawSelectionHandles,
  hitTestHandle,
  type ResizeHandle,
} from "./lib/render-element";
import { hitTest } from "./lib/hit-testing";
import { bboxesIntersect, getElementBounds, screenToWorld } from "./lib/math-utils";
import { applyResize, angleFromPointer } from "./lib/transforms";
import {
  measureTextHeight,
  TEXT_FONT_FAMILY,
  TEXT_LINE_HEIGHT,
} from "./lib/text-layout";

const DEFAULT_TEXT_WIDTH = 240;
const DEFAULT_TEXT_FONT_SIZE = 16;

interface WhiteboardCanvasProps {
  whiteboardId: string;
  /** If set, loads this PDF as a background on the canvas */
  pdfDocumentUrl?: string;
}

export function WhiteboardCanvas({ whiteboardId, pdfDocumentUrl }: WhiteboardCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panOriginRef = useRef<Point>({ x: 0, y: 0 });
  const spaceDownRef = useRef(false);
  const inProgressElementRef = useRef<WhiteboardElement | null>(null);
  const dragStartWorldRef = useRef<Point>({ x: 0, y: 0 });
  const dragSnapshotsRef = useRef<Map<string, WhiteboardElement>>(new Map());
  const isDraggingSelectionRef = useRef(false);

  // Transform-drag state. When the user grabs a resize/rotate handle
  // on a single-selected element, we snapshot it once and re-derive
  // the new geometry every pointermove. `kind` distinguishes resize
  // vs rotate; `original` is the element as it was at the start of
  // the drag (so we never accumulate floating-point error).
  const transformRef = useRef<{
    kind: ResizeHandle | "rotate";
    elementId: string;
    original: WhiteboardElement;
    /** For rotate: radians offset between the snapshot rotation and
     *  the angle from centre to pointer at drag start. */
    angleOffset?: number;
    centre?: Point;
  } | null>(null);

  // Marquee (rubber-band) selection state. While the user drags from
  // an empty point with the select tool active, marqueeRef stores the
  // start + end world-space corners so render() can draw the box and
  // pointerup can finalise the selection.
  const marqueeRef = useRef<{
    startWorld: Point;
    endWorld: Point;
    additive: boolean;
    baseline: Set<string>;
  } | null>(null);

  // Text-editing state. `editingId` is the id of the text element whose
  // overlay is currently open; editingIdRef mirrors it so the render
  // loop (which reads via ref, not reactive) can skip drawing that
  // element while the HTML textarea is on top.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  // Subscribe to pan/zoom/elements so the overlay follows the canvas
  // transform — the canvas render itself reads via store.getState(), so
  // these subscriptions are only here for the overlay.
  const editingPanX = useWhiteboardStore((s) => s.panX);
  const editingPanY = useWhiteboardStore((s) => s.panY);
  const editingZoom = useWhiteboardStore((s) => s.zoom);
  const editingElement = useWhiteboardStore((s) =>
    editingId
      ? (s.elements.find((e) => e.id === editingId) as TextElement | undefined)
      : undefined,
  );

  const store = useWhiteboardStore;

  // Load whiteboard data on mount
  useEffect(() => {
    store.getState().loadWhiteboardData(whiteboardId);
  }, [whiteboardId]);

  // Load PDF background if provided
  useEffect(() => {
    if (pdfDocumentUrl) {
      store.getState().loadPdfBackground(pdfDocumentUrl);
    }
    return () => {
      store.getState().clearPdfBackground();
    };
  }, [pdfDocumentUrl]);

  // --- Render ---
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // Resize if needed
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    const {
      elements,
      background,
      panX,
      panY,
      zoom,
      selectedElementIds,
    } = store.getState();

    ctx.save();
    ctx.scale(dpr, dpr);

    // Background (screen space)
    drawBackground(ctx, background, w, h, panX, panY, zoom);

    // World transform
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);

    // Draw PDF background pages
    const { pdfPages } = store.getState();
    for (const page of pdfPages) {
      ctx.drawImage(page.bitmap, 0, page.y, page.width, page.height);
    }

    // Draw all elements, skipping whichever text is being edited (its
    // HTML textarea overlay is the visible version).
    for (const el of elements) {
      if (el.id === editingIdRef.current) continue;
      drawElement(ctx, el);
    }

    // Draw in-progress element
    const inProgress = inProgressElementRef.current;
    if (inProgress) {
      drawElement(ctx, inProgress);
    }

    // Selection handles
    if (selectedElementIds.size > 0) {
      drawSelectionHandles(ctx, elements, selectedElementIds, zoom);
    }

    // Marquee rectangle (drawn in world space; thin & dashed)
    if (marqueeRef.current) {
      const { startWorld, endWorld } = marqueeRef.current;
      const mx = Math.min(startWorld.x, endWorld.x);
      const my = Math.min(startWorld.y, endWorld.y);
      const mw = Math.abs(endWorld.x - startWorld.x);
      const mh = Math.abs(endWorld.y - startWorld.y);
      ctx.fillStyle = "rgba(124, 92, 252, 0.08)";
      ctx.fillRect(mx, my, mw, mh);
      ctx.strokeStyle = "#7c5cfc";
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([5 / zoom, 5 / zoom]);
      ctx.strokeRect(mx, my, mw, mh);
      ctx.setLineDash([]);
    }

    ctx.restore();
  }, []);

  // Initial render + re-render on store changes
  useEffect(() => {
    render();
    const unsub = store.subscribe(() => {
      render();
    });
    return () => unsub();
  }, [render]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => render());
    observer.observe(container);
    return () => observer.disconnect();
  }, [render]);

  // --- Pointer event helpers ---
  const getWorldPoint = useCallback(
    (e: React.PointerEvent | PointerEvent): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { panX, panY, zoom } = store.getState();
      return screenToWorld(sx, sy, panX, panY, zoom);
    },
    [],
  );

  const getScreenPoint = useCallback(
    (e: React.PointerEvent | PointerEvent): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  // --- Pointer handlers ---
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.setPointerCapture(e.pointerId);

      const {
        activeTool,
        strokeColor,
        strokeWidth,
        elements,
        zoom,
        panX,
        panY,
        selectedElementIds,
      } = store.getState();

      // Middle click → pan
      if (e.button === 1 || (e.button === 0 && spaceDownRef.current)) {
        isPanningRef.current = true;
        panStartRef.current = { x: e.clientX, y: e.clientY };
        panOriginRef.current = { x: panX, y: panY };
        return;
      }

      if (e.button !== 0) return;

      const world = getWorldPoint(e);

      if (activeTool === "select") {
        // First, if exactly one element is selected, see whether the
        // pointer landed on one of its resize/rotate handles. This
        // takes precedence over element hit-tests so users can grab a
        // handle that's outside the element's outline.
        if (selectedElementIds.size === 1) {
          const onlySelected = elements.find((el) =>
            selectedElementIds.has(el.id),
          );
          if (onlySelected) {
            const handle = hitTestHandle(onlySelected, world, zoom);
            if (handle) {
              store.getState().pushUndo();
              const b = getElementBounds(onlySelected);
              const cx = (b.minX + b.maxX) / 2;
              const cy = (b.minY + b.maxY) / 2;
              transformRef.current = {
                kind: handle,
                elementId: onlySelected.id,
                original:
                  onlySelected.type === "pen"
                    ? {
                        ...onlySelected,
                        points: onlySelected.points.map((p) => ({ ...p })),
                      }
                    : { ...onlySelected },
                centre: { x: cx, y: cy },
                angleOffset:
                  handle === "rotate"
                    ? (onlySelected.rotation ?? 0) -
                      angleFromPointer({ x: cx, y: cy }, world)
                    : undefined,
              };
              const loop = () => {
                render();
                if (transformRef.current) {
                  rafRef.current = requestAnimationFrame(loop);
                }
              };
              rafRef.current = requestAnimationFrame(loop);
              return;
            }
          }
        }

        const hit = hitTest(elements, world, zoom);

        // Obsidian-canvas behaviour: when there's already a selection
        // and the user clicks INSIDE the selected element's visual
        // rectangle (the same bbox-with-padding that
        // `drawSelectionHandles` paints), treat it as a drag for the
        // selection — even though `hitTest` returned no element
        // because the click was on a transparent fill or in the gap
        // between selected items. Without this, users have to aim at
        // the actual stroke, which is fiddly for thin shapes.
        // Skips when Ctrl/Cmd/Shift is held (those mean "extend
        // selection" → marquee should still win).
        const modKey = e.ctrlKey || e.metaKey || e.shiftKey;
        const HANDLE_PAD = 4 / zoom;
        const insideSelectionRect =
          !hit &&
          !modKey &&
          selectedElementIds.size > 0 &&
          elements.some((el) => {
            if (!selectedElementIds.has(el.id)) return false;
            const b = getElementBounds(el);
            return (
              world.x >= b.minX - HANDLE_PAD &&
              world.x <= b.maxX + HANDLE_PAD &&
              world.y >= b.minY - HANDLE_PAD &&
              world.y <= b.maxY + HANDLE_PAD
            );
          });

        if (hit || insideSelectionRect) {
          const isMultiSelect = e.ctrlKey || e.metaKey;
          if (hit && isMultiSelect) {
            // Toggle element in/out of selection
            const next = new Set(selectedElementIds);
            if (next.has(hit.id)) {
              next.delete(hit.id);
            } else {
              next.add(hit.id);
            }
            store.getState().setSelection(next);
          } else if (hit && !selectedElementIds.has(hit.id)) {
            store.getState().setSelection(new Set([hit.id]));
          }
          // For `insideSelectionRect`-only (no hit), the existing
          // selection is preserved as-is — that's the whole point.
          // Start drag — snapshot all selected elements
          const sel = store.getState().selectedElementIds;
          if (sel.size > 0) {
            isDraggingSelectionRef.current = true;
            dragStartWorldRef.current = world;
            dragSnapshotsRef.current = new Map();
            for (const el of elements) {
              if (sel.has(el.id)) {
                // Deep-clone pen points
                dragSnapshotsRef.current.set(
                  el.id,
                  el.type === "pen"
                    ? { ...el, points: el.points.map((p) => ({ ...p })) }
                    : { ...el },
                );
              }
            }
            // Push undo before drag
            store.getState().pushUndo();
          }
        } else {
          // Empty space → start a marquee selection. Shift/Ctrl makes
          // it additive (existing selection preserved as a baseline);
          // a plain drag clears existing selection on commit.
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          marqueeRef.current = {
            startWorld: world,
            endWorld: world,
            additive,
            baseline: new Set(selectedElementIds),
          };
          if (!additive) store.getState().clearSelection();
          // Drive a rAF loop so the marquee box redraws while dragging.
          const loop = () => {
            render();
            if (marqueeRef.current) {
              rafRef.current = requestAnimationFrame(loop);
            }
          };
          rafRef.current = requestAnimationFrame(loop);
        }
        return;
      }

      if (activeTool === "eraser") {
        const hit = hitTest(elements, world, zoom);
        if (hit) {
          store.getState().removeElements([hit.id]);
        }
        isDrawingRef.current = true;
        return;
      }

      // Text tool → click-place. No drag-to-size; the box grows with
      // content as the user types. Existing overlay (if any) commits
      // itself first via its own blur handler.
      if (activeTool === "text") {
        if (editingIdRef.current) return;
        const id = crypto.randomUUID();
        const initialHeight =
          DEFAULT_TEXT_FONT_SIZE * TEXT_LINE_HEIGHT;
        const newText: TextElement = {
          id,
          type: "text",
          x: world.x,
          y: world.y,
          width: DEFAULT_TEXT_WIDTH,
          height: initialHeight,
          text: "",
          fontSize: DEFAULT_TEXT_FONT_SIZE,
          color: strokeColor,
          strokeColor,
          strokeWidth,
          createdAt: Date.now(),
        };
        store.getState().pushUndo();
        store.getState().addElement(newText);
        setEditingId(id);
        setEditDraft("");
        return;
      }

      // Start drawing
      isDrawingRef.current = true;

      const id = crypto.randomUUID();
      const base = { id, strokeColor, strokeWidth, createdAt: Date.now() };

      switch (activeTool) {
        case "pen":
          inProgressElementRef.current = {
            ...base,
            type: "pen",
            points: [world],
          };
          break;
        case "rectangle":
          inProgressElementRef.current = {
            ...base,
            type: "rectangle",
            x: world.x,
            y: world.y,
            width: 0,
            height: 0,
          };
          break;
        case "ellipse":
          inProgressElementRef.current = {
            ...base,
            type: "ellipse",
            cx: world.x,
            cy: world.y,
            rx: 0,
            ry: 0,
          };
          break;
        case "line":
          inProgressElementRef.current = {
            ...base,
            type: "line",
            x1: world.x,
            y1: world.y,
            x2: world.x,
            y2: world.y,
          };
          break;
        case "arrow":
          inProgressElementRef.current = {
            ...base,
            type: "arrow",
            x1: world.x,
            y1: world.y,
            x2: world.x,
            y2: world.y,
          };
          break;
      }

      // Start rAF loop for smooth drawing
      const loop = () => {
        render();
        if (isDrawingRef.current) {
          rafRef.current = requestAnimationFrame(loop);
        }
      };
      rafRef.current = requestAnimationFrame(loop);
    },
    [getWorldPoint, render],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Panning
      if (isPanningRef.current) {
        const dx = e.clientX - panStartRef.current.x;
        const dy = e.clientY - panStartRef.current.y;
        store.getState().setPan(
          panOriginRef.current.x + dx,
          panOriginRef.current.y + dy,
        );
        render();
        return;
      }

      const world = getWorldPoint(e);

      // Marquee in progress
      if (marqueeRef.current) {
        marqueeRef.current.endWorld = world;
        return;
      }

      // Resize / rotate in progress
      if (transformRef.current) {
        const t = transformRef.current;
        if (t.kind === "rotate" && t.centre && t.angleOffset !== undefined) {
          let next =
            angleFromPointer(t.centre, world) + t.angleOffset;
          if (e.shiftKey) {
            // Snap to 15° increments
            const step = (15 * Math.PI) / 180;
            next = Math.round(next / step) * step;
          }
          store.getState().updateElement(t.elementId, {
            rotation: next,
          } as Partial<WhiteboardElement>);
        } else if (t.kind !== "rotate") {
          const patch = applyResize(t.original, t.kind, world);
          store.getState().updateElement(t.elementId, patch);
        }
        return;
      }

      // Dragging selection
      if (isDraggingSelectionRef.current) {
        const dx = world.x - dragStartWorldRef.current.x;
        const dy = world.y - dragStartWorldRef.current.y;
        const { selectedElementIds } = store.getState();

        for (const id of selectedElementIds) {
          const orig = dragSnapshotsRef.current.get(id);
          if (!orig) continue;

          switch (orig.type) {
            case "pen":
              store.getState().updateElement(id, {
                points: orig.points.map((p) => ({
                  x: p.x + dx,
                  y: p.y + dy,
                })),
              } as Partial<WhiteboardElement>);
              break;
            case "rectangle":
              store.getState().updateElement(id, {
                x: orig.x + dx,
                y: orig.y + dy,
              } as Partial<WhiteboardElement>);
              break;
            case "ellipse":
              store.getState().updateElement(id, {
                cx: orig.cx + dx,
                cy: orig.cy + dy,
              } as Partial<WhiteboardElement>);
              break;
            case "line":
            case "arrow":
              store.getState().updateElement(id, {
                x1: orig.x1 + dx,
                y1: orig.y1 + dy,
                x2: orig.x2 + dx,
                y2: orig.y2 + dy,
              } as Partial<WhiteboardElement>);
              break;
            case "text":
              store.getState().updateElement(id, {
                x: orig.x + dx,
                y: orig.y + dy,
              } as Partial<WhiteboardElement>);
              break;
          }
        }
        render();
        return;
      }

      if (!isDrawingRef.current) return;

      const { activeTool, elements, zoom } = store.getState();

      // Eraser
      if (activeTool === "eraser") {
        const hit = hitTest(elements, world, zoom);
        if (hit) {
          store.getState().removeElements([hit.id]);
        }
        return;
      }

      const ip = inProgressElementRef.current;
      if (!ip) return;

      switch (ip.type) {
        case "pen":
          ip.points.push(world);
          break;
        case "rectangle": {
          const startX = ip.x;
          const startY = ip.y;
          ip.width = world.x - startX;
          ip.height = world.y - startY;
          break;
        }
        case "ellipse": {
          ip.rx = world.x - ip.cx;
          ip.ry = world.y - ip.cy;
          break;
        }
        case "line":
        case "arrow":
          ip.x2 = world.x;
          ip.y2 = world.y;
          break;
      }
    },
    [getWorldPoint, render],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      const canvas = canvasRef.current;
      if (canvas) canvas.releasePointerCapture(e.pointerId);

      if (isPanningRef.current) {
        isPanningRef.current = false;
        return;
      }

      if (isDraggingSelectionRef.current) {
        isDraggingSelectionRef.current = false;
        store.getState().saveCurrentWhiteboard();
        return;
      }

      // Resize / rotate finalize
      if (transformRef.current) {
        transformRef.current = null;
        cancelAnimationFrame(rafRef.current);
        store.getState().saveCurrentWhiteboard();
        render();
        return;
      }

      // Marquee finalize: collect every element whose bbox intersects
      // the marquee rectangle and merge with the additive baseline if
      // shift/ctrl was held when the marquee began.
      if (marqueeRef.current) {
        const { startWorld, endWorld, additive, baseline } =
          marqueeRef.current;
        marqueeRef.current = null;
        cancelAnimationFrame(rafRef.current);

        const dx = Math.abs(endWorld.x - startWorld.x);
        const dy = Math.abs(endWorld.y - startWorld.y);
        // A trivial drag (or just a click on empty space) shouldn't
        // commit a marquee; clearSelection already happened on pointer-
        // down for the non-additive case.
        if (dx >= 2 || dy >= 2) {
          const marqueeBbox = {
            minX: Math.min(startWorld.x, endWorld.x),
            minY: Math.min(startWorld.y, endWorld.y),
            maxX: Math.max(startWorld.x, endWorld.x),
            maxY: Math.max(startWorld.y, endWorld.y),
          };
          const next = new Set(additive ? baseline : []);
          for (const el of store.getState().elements) {
            if (bboxesIntersect(getElementBounds(el), marqueeBbox)) {
              next.add(el.id);
            }
          }
          store.getState().setSelection(next);
        }
        render();
        return;
      }

      if (!isDrawingRef.current) return;
      isDrawingRef.current = false;
      cancelAnimationFrame(rafRef.current);

      const ip = inProgressElementRef.current;
      inProgressElementRef.current = null;

      if (ip) {
        // Don't add degenerate shapes
        let shouldAdd = true;
        if (ip.type === "pen" && ip.points.length === 0) shouldAdd = false;
        if (
          (ip.type === "rectangle" &&
            Math.abs(ip.width) < 2 &&
            Math.abs(ip.height) < 2) ||
          (ip.type === "ellipse" &&
            Math.abs(ip.rx) < 2 &&
            Math.abs(ip.ry) < 2)
        ) {
          shouldAdd = false;
        }
        if (
          (ip.type === "line" || ip.type === "arrow") &&
          Math.abs(ip.x2 - ip.x1) < 2 &&
          Math.abs(ip.y2 - ip.y1) < 2
        ) {
          shouldAdd = false;
        }

        if (shouldAdd) {
          store.getState().addElement(ip);
          // Obsidian-canvas behaviour: after dropping a discrete
          // shape (rectangle / ellipse / line / arrow), auto-select
          // it and switch to the select tool. The user almost always
          // wants to nudge or resize the shape they just placed; the
          // current behaviour of staying in the shape tool meant
          // they had to press `V` first, which felt clunky. Pen and
          // text are excluded — pen is fluid sketching where the
          // tool should stay sticky, and text drops straight into
          // edit mode anyway.
          if (
            ip.type === "rectangle" ||
            ip.type === "ellipse" ||
            ip.type === "line" ||
            ip.type === "arrow"
          ) {
            store.getState().setSelection(new Set([ip.id]));
            store.getState().setActiveTool("select");
          }
        }
      }

      render();
    },
    [render],
  );

  // --- Wheel: pan by default, Ctrl+wheel zooms at cursor ---
  // Trackpad pinch gestures arrive as wheel events with ctrlKey=true,
  // so the ctrl branch also handles pinch-zoom naturally.
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { zoom, panX, panY, setZoom, setPan } = store.getState();

      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const screen = getScreenPoint(e as unknown as React.PointerEvent);
        setZoom(zoom * delta, screen);
      } else {
        // Shift+wheel → horizontal pan (classic trackpad convention).
        // Lines of deltaX/deltaY on OS wheel lines are tiny; pixel
        // mode (deltaMode=0) is what we care about.
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        setPan(panX - dx, panY - dy);
      }
      render();
    },
    [getScreenPoint, render],
  );

  // --- Keyboard shortcuts (scoped to canvas container) ---
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Space for panning
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        spaceDownRef.current = true;
        return;
      }

      // Ctrl+Z / Ctrl+Shift+Z
      if (e.key === "z" && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        store.getState().undo();
        return;
      }
      if (
        e.key === "z" &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        store.getState().redo();
        return;
      }

      // Delete / Backspace
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        const { selectedElementIds } = store.getState();
        if (selectedElementIds.size > 0) {
          store.getState().removeElements([...selectedElementIds]);
        }
        return;
      }

      // Escape
      if (e.key === "Escape") {
        store.getState().clearSelection();
        store.getState().setActiveTool("select");
        return;
      }

      // PDF-backed whiteboards: page navigation. When no PDF is loaded
      // these keys fall through to the default page-scroll behavior.
      const { pdfPages, zoom, panY, setPan, panX } = store.getState();
      if (pdfPages.length > 0) {
        const currentPageIdx = (() => {
          // The "current page" is whichever page's top is closest to
          // but not past the screen center.
          const screenY = (canvasRef.current?.clientHeight ?? 0) / 2;
          const worldY = (screenY - panY) / zoom;
          let idx = 0;
          for (let i = 0; i < pdfPages.length; i++) {
            if (pdfPages[i].y <= worldY) idx = i;
            else break;
          }
          return idx;
        })();

        const jumpTo = (i: number) => {
          const clamped = Math.max(0, Math.min(pdfPages.length - 1, i));
          setPan(panX, -pdfPages[clamped].y * zoom);
          render();
        };

        if (e.key === "PageDown") {
          e.preventDefault();
          jumpTo(currentPageIdx + 1);
          return;
        }
        if (e.key === "PageUp") {
          e.preventDefault();
          jumpTo(currentPageIdx - 1);
          return;
        }
        if (e.key === "Home" && !e.ctrlKey) {
          e.preventDefault();
          jumpTo(0);
          return;
        }
        if (e.key === "End" && !e.ctrlKey) {
          e.preventDefault();
          jumpTo(pdfPages.length - 1);
          return;
        }
      }

      // Tool shortcuts
      const toolKeys: Record<string, typeof store.getState extends () => { activeTool: infer T } ? T : never> = {
        v: "select",
        p: "pen",
        t: "text",
        r: "rectangle",
        e: "ellipse",
        l: "line",
        a: "arrow",
        x: "eraser",
      };
      if (!e.ctrlKey && !e.metaKey && !e.altKey && toolKeys[e.key]) {
        store.getState().setActiveTool(toolKeys[e.key]);
      }
    },
    [],
  );

  const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
    if (e.code === "Space") {
      spaceDownRef.current = false;
    }
  }, []);

  // --- Text editing: commit + double-click handlers ---
  const commitEdit = useCallback(() => {
    const id = editingIdRef.current;
    if (!id) return;
    const el = store.getState().elements.find((e) => e.id === id);
    setEditingId(null);
    setEditDraft("");
    if (!el || el.type !== "text") return;

    if (editDraft.trim() === "") {
      // Empty text → discard. If the element was freshly-created in
      // this session its undo entry is already on the stack, so undo
      // after removal still restores a sensible state.
      store.getState().removeElements([id]);
      return;
    }
    const height = measureTextHeight(editDraft, el.width, el.fontSize);
    store.getState().updateElement(id, {
      text: editDraft,
      height,
    } as Partial<WhiteboardElement>);
    store.getState().saveCurrentWhiteboard();
  }, [editDraft]);

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const world = getWorldPoint(e as unknown as React.PointerEvent);
      const { elements, zoom } = store.getState();
      const hit = hitTest(elements, world, zoom);
      if (hit?.type === "text") {
        setEditingId(hit.id);
        setEditDraft(hit.text);
      }
    },
    [getWorldPoint],
  );

  const pdfLoading = useWhiteboardStore((s) => s.pdfLoading);
  const pdfLoadProgress = useWhiteboardStore((s) => s.pdfLoadProgress);

  return (
    <div
      ref={containerRef}
      data-active-viewer
      data-whiteboard-viewer
      className="relative h-full w-full outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
    >
      <canvas
        ref={canvasRef}
        className="h-full w-full block cursor-crosshair"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />
      <WhiteboardToolbar />

      {/* Text-edit overlay — positioned in screen space over whichever
          text element is being edited. Follows pan/zoom via the
          subscribed panX/panY/zoom selectors. */}
      {editingElement && (
        <textarea
          autoFocus
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            // Stop shortcuts (undo, tool keys) from firing while typing.
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              commitEdit();
            } else if (
              e.key === "Enter" &&
              (e.ctrlKey || e.metaKey)
            ) {
              e.preventDefault();
              commitEdit();
            }
          }}
          style={{
            position: "absolute",
            left: editingElement.x * editingZoom + editingPanX,
            top: editingElement.y * editingZoom + editingPanY,
            width: editingElement.width * editingZoom,
            minHeight:
              editingElement.fontSize * TEXT_LINE_HEIGHT * editingZoom,
            fontSize: editingElement.fontSize * editingZoom,
            lineHeight: TEXT_LINE_HEIGHT,
            fontFamily: TEXT_FONT_FAMILY,
            color: editingElement.color,
            background: "rgba(124, 92, 252, 0.08)",
            border: "1px dashed #7c5cfc",
            borderRadius: 4,
            padding: 0,
            margin: 0,
            outline: "none",
            resize: "none",
            overflow: "hidden",
            whiteSpace: "pre-wrap",
            zIndex: 20,
          }}
        />
      )}

      {pdfLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent-purple mb-3" />
          <p className="text-sm text-text-secondary">{pdfLoadProgress}</p>
        </div>
      )}
    </div>
  );
}
