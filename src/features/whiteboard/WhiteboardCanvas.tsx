/* eslint-disable react-hooks/exhaustive-deps --
   `store` here is the imported Zustand hook aliased to a local const; its
   reference is stable across renders, so omitting it from deps is safe. */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { Point, TextElement, WhiteboardElement } from "@/types/whiteboard";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { TextEditOverlay } from "./TextEditOverlay";
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
import { measureTextHeight, TEXT_LINE_HEIGHT } from "./lib/text-layout";
import { registerBoardCanvas } from "./board-capture";

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
  // last requested lazy-PDF window (comma-joined page numbers) so we only ask
  // the store to (re)rasterize/evict when the visible page set actually changes
  const pdfWindowRef = useRef<string>("");
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<Point>({ x: 0, y: 0 });
  const panOriginRef = useRef<Point>({ x: 0, y: 0 });
  const spaceDownRef = useRef(false);
  const inProgressElementRef = useRef<WhiteboardElement | null>(null);
  const dragStartWorldRef = useRef<Point>({ x: 0, y: 0 });
  const dragSnapshotsRef = useRef<Map<string, WhiteboardElement>>(new Map());
  const isDraggingSelectionRef = useRef(false);

  // handle-drag state: snapshot the element once, re-derive geometry each move so fp error doesn't accumulate
  const transformRef = useRef<{
    kind: ResizeHandle | "rotate";
    elementId: string;
    original: WhiteboardElement;
    // rotate: radians between snapshot rotation and centre->pointer angle at drag start
    angleOffset?: number;
    centre?: Point;
  } | null>(null);

  // marquee selection: start/end world corners for the rubber-band box
  const marqueeRef = useRef<{
    startWorld: Point;
    endWorld: Point;
    additive: boolean;
    baseline: Set<string>;
  } | null>(null);

  // editingIdRef mirrors editingId so the render loop (ref-only) can skip drawing the element under the textarea
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editingIdRef = useRef<string | null>(null);
  useEffect(() => {
    editingIdRef.current = editingId;
  }, [editingId]);

  // only the overlay needs these reactive; canvas render reads via store.getState()
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

  // expose the canvas so the chat sidebar can snapshot the board for the AI
  useEffect(() => {
    registerBoardCanvas(canvasRef.current);
    return () => registerBoardCanvas(null);
  }, []);

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

    // Viewport in world space, used to cull offscreen drawing work.
    const viewLeft = -panX / zoom;
    const viewTop = -panY / zoom;
    const viewRight = (w - panX) / zoom;
    const viewBottom = (h - panY) / zoom;
    const viewBounds = {
      minX: viewLeft,
      minY: viewTop,
      maxX: viewRight,
      maxY: viewBottom,
    };

    // Draw PDF background pages — lazily rasterized + windowed so a long book
    // never holds every page's bitmap at once.
    const { pdfPages } = store.getState();
    if (pdfPages.length > 0) {
      // one screen of margin each way keeps small scrolls within the window
      const margin = viewBottom - viewTop;
      const windowLo = viewTop - margin;
      const windowHi = viewBottom + margin;
      const windowNums: number[] = [];
      for (const page of pdfPages) {
        const pageBottom = page.y + page.height;
        if (page.y < windowHi && pageBottom > windowLo) {
          windowNums.push(page.pageNum);
        }
        // only draw pages actually in view
        if (page.y < viewBottom && pageBottom > viewTop) {
          if (page.bitmap) {
            ctx.drawImage(page.bitmap, 0, page.y, page.width, page.height);
          } else {
            // placeholder while the page rasterizes
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, page.y, page.width, page.height);
            ctx.strokeStyle = "rgba(0,0,0,0.1)";
            ctx.lineWidth = 1 / zoom;
            ctx.strokeRect(0, page.y, page.width, page.height);
          }
        }
      }
      // request the visible window (throttled: only when it changes). Deferred
      // to a microtask so its store writes (eviction) don't re-enter render()
      // while we're mid-draw.
      const windowKey = windowNums.join(",");
      if (windowKey !== pdfWindowRef.current) {
        pdfWindowRef.current = windowKey;
        queueMicrotask(() => store.getState().ensurePdfPages(windowNums));
      }
    }

    // skip the text being edited; its textarea overlay is the visible version.
    // Cull elements whose bounds fall entirely outside the viewport.
    for (const el of elements) {
      if (el.id === editingIdRef.current) continue;
      if (!bboxesIntersect(getElementBounds(el), viewBounds)) continue;
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
    (e: { clientX: number; clientY: number }): Point => {
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
    (e: { clientX: number; clientY: number }): Point => {
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
        // handle hit-test wins over element hit-test so a handle outside the outline is still grabbable
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

        // a click inside a selected element's bbox counts as a drag even when hitTest misses
        // (transparent fill / gap between items). mod keys mean extend, so let marquee win there.
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
          // insideSelectionRect-only keeps the existing selection. start drag, snapshot selected
          const sel = store.getState().selectedElementIds;
          if (sel.size > 0) {
            isDraggingSelectionRef.current = true;
            dragStartWorldRef.current = world;
            dragSnapshotsRef.current = new Map();
            for (const el of elements) {
              if (sel.has(el.id)) {
                // deep-clone pen points
                dragSnapshotsRef.current.set(
                  el.id,
                  el.type === "pen"
                    ? { ...el, points: el.points.map((p) => ({ ...p })) }
                    : { ...el },
                );
              }
            }
            store.getState().pushUndo();
          }
        } else {
          // empty space starts a marquee. shift/ctrl makes it additive (baseline preserved)
          const additive = e.shiftKey || e.ctrlKey || e.metaKey;
          marqueeRef.current = {
            startWorld: world,
            endWorld: world,
            additive,
            baseline: new Set(selectedElementIds),
          };
          if (!additive) store.getState().clearSelection();
          // rAF loop redraws the marquee box while dragging
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

      // text is click-placed; the box grows with content as you type
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
        case "pen": {
          // decimate: skip points within ~2 screen px of the previous one so a
          // long stroke doesn't bloat into thousands of near-duplicate points
          const pts = ip.points;
          const last = pts[pts.length - 1];
          const minDist = 2 / store.getState().zoom;
          if (
            !last ||
            Math.hypot(world.x - last.x, world.y - last.y) >= minDist
          ) {
            pts.push(world);
          }
          break;
        }
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
        store.getState().flushSave();
        return;
      }

      // Resize / rotate finalize
      if (transformRef.current) {
        transformRef.current = null;
        cancelAnimationFrame(rafRef.current);
        store.getState().flushSave();
        render();
        return;
      }

      // marquee finalize: select every element whose bbox intersects the rect
      if (marqueeRef.current) {
        const { startWorld, endWorld, additive, baseline } =
          marqueeRef.current;
        marqueeRef.current = null;
        cancelAnimationFrame(rafRef.current);

        const dx = Math.abs(endWorld.x - startWorld.x);
        const dy = Math.abs(endWorld.y - startWorld.y);
        // ignore trivial drags / plain clicks (selection already cleared on pointerdown)
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
        // drop degenerate shapes
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
          // after dropping a discrete shape, auto-select it and switch to the select tool.
          // pen stays sticky for fluid sketching; text goes straight to edit mode.
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

  // wheel pans, ctrl+wheel zooms at cursor. trackpad pinch arrives as ctrlKey=true so it lands in the zoom branch too
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { zoom, panX, panY, setZoom, setPan } = store.getState();

      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const screen = getScreenPoint(e);
        setZoom(zoom * delta, screen);
      } else {
        // shift+wheel = horizontal pan
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

      // page navigation for PDF-backed whiteboards
      const { pdfPages, zoom, panY, setPan, panX } = store.getState();
      if (pdfPages.length > 0) {
        const currentPageIdx = (() => {
          // page whose top is closest to but not past the screen center
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
      // empty text: discard
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
      const world = getWorldPoint(e);
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

      {/* text-edit overlay, positioned in screen space over the edited element */}
      {editingElement && (
        <TextEditOverlay
          element={editingElement}
          draft={editDraft}
          onDraftChange={setEditDraft}
          onCommit={commitEdit}
          panX={editingPanX}
          panY={editingPanY}
          zoom={editingZoom}
        />
      )}

      {pdfLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent mb-3" />
          <p className="text-sm text-text-secondary">{pdfLoadProgress}</p>
        </div>
      )}
    </div>
  );
}
