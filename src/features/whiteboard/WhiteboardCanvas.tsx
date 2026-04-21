/* eslint-disable react-hooks/exhaustive-deps --
   `store` here is the imported Zustand hook aliased to a local const; its
   reference is stable across renders, so omitting it from deps is safe. */
import { useCallback, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import type { Point, WhiteboardElement } from "@/types/whiteboard";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { WhiteboardToolbar } from "./WhiteboardToolbar";
import { drawBackground, drawElement, drawSelectionHandles } from "./lib/render-element";
import { hitTest } from "./lib/hit-testing";
import { screenToWorld } from "./lib/math-utils";

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

    // Draw all elements
    for (const el of elements) {
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
        const hit = hitTest(elements, world, zoom);
        if (hit) {
          const isMultiSelect = e.ctrlKey || e.metaKey;
          if (isMultiSelect) {
            // Toggle element in/out of selection
            const next = new Set(selectedElementIds);
            if (next.has(hit.id)) {
              next.delete(hit.id);
            } else {
              next.add(hit.id);
            }
            store.getState().setSelection(next);
          } else if (!selectedElementIds.has(hit.id)) {
            store.getState().setSelection(new Set([hit.id]));
          }
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
          if (!e.ctrlKey && !e.metaKey) {
            store.getState().clearSelection();
          }
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

      // Update in-progress element
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
        }
      }

      render();
    },
    [render],
  );

  // --- Wheel zoom ---
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const { zoom } = store.getState();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const screen = getScreenPoint(e as unknown as React.PointerEvent);
      store.getState().setZoom(zoom * delta, screen);
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

      // Tool shortcuts
      const toolKeys: Record<string, typeof store.getState extends () => { activeTool: infer T } ? T : never> = {
        v: "select",
        p: "pen",
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
      />
      <WhiteboardToolbar />
      {pdfLoading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm">
          <Loader2 size={32} className="animate-spin text-accent-purple mb-3" />
          <p className="text-sm text-text-secondary">{pdfLoadProgress}</p>
        </div>
      )}
    </div>
  );
}
