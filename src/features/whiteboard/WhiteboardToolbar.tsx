import { useRef } from "react";
import {
  MousePointer2,
  Pencil,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  Type,
  Eraser,
  Grid3X3,
  Trash2,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { WhiteboardTool } from "@/types/whiteboard";

const TOOLS: { tool: WhiteboardTool; icon: typeof Pencil; label: string; shortcut: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select", shortcut: "V" },
  { tool: "pen", icon: Pencil, label: "Pen", shortcut: "P" },
  { tool: "rectangle", icon: Square, label: "Rectangle", shortcut: "R" },
  { tool: "ellipse", icon: Circle, label: "Ellipse", shortcut: "E" },
  { tool: "line", icon: Minus, label: "Line", shortcut: "L" },
  { tool: "arrow", icon: ArrowUpRight, label: "Arrow", shortcut: "A" },
  { tool: "text", icon: Type, label: "Text", shortcut: "T" },
  { tool: "eraser", icon: Eraser, label: "Smart eraser (whole strokes)", shortcut: "X" },
];

const COLORS = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#f59e0b",
  "#22c55e",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const STROKE_WIDTHS = [1, 2, 4, 6];

export function WhiteboardToolbar() {
  const colorInputRef = useRef<HTMLInputElement>(null);
  const activeTool = useWhiteboardStore((s) => s.activeTool);
  const strokeColor = useWhiteboardStore((s) => s.strokeColor);
  const strokeWidth = useWhiteboardStore((s) => s.strokeWidth);
  const background = useWhiteboardStore((s) => s.background);
  const selectedElementIds = useWhiteboardStore((s) => s.selectedElementIds);
  const undoStack = useWhiteboardStore((s) => s.undoStack);
  const redoStack = useWhiteboardStore((s) => s.redoStack);

  const setActiveTool = useWhiteboardStore((s) => s.setActiveTool);
  const setStrokeColor = useWhiteboardStore((s) => s.setStrokeColor);
  const setStrokeWidth = useWhiteboardStore((s) => s.setStrokeWidth);
  const setBackground = useWhiteboardStore((s) => s.setBackground);
  const removeElements = useWhiteboardStore((s) => s.removeElements);
  const undo = useWhiteboardStore((s) => s.undo);
  const redo = useWhiteboardStore((s) => s.redo);
  const setZoom = useWhiteboardStore((s) => s.setZoom);
  const zoom = useWhiteboardStore((s) => s.zoom);

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1 rounded-xl bg-bg-secondary/90 backdrop-blur-sm border border-glass-border px-2 py-1.5 shadow-lg">
      {/* Tool buttons */}
      {TOOLS.map(({ tool, icon: Icon, label, shortcut }) => (
        <button
          key={tool}
          onClick={() => setActiveTool(tool)}
          title={`${label} (${shortcut})`}
          className={cn(
            "rounded-lg p-1.5 transition-colors cursor-pointer",
            activeTool === tool
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
          )}
        >
          <Icon size={16} />
        </button>
      ))}

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Color swatches */}
      {COLORS.map((color) => (
        <button
          key={color}
          onClick={() => setStrokeColor(color)}
          title={color}
          className={cn(
            "h-5 w-5 rounded-full border-2 transition-transform cursor-pointer",
            strokeColor === color
              ? "border-accent scale-110"
              : color === "#000000"
                ? "border-glass-border hover:scale-110"
                : "border-transparent hover:scale-110",
          )}
          style={{ backgroundColor: color }}
        />
      ))}

      {/* Custom color picker */}
      <button
        onClick={() => colorInputRef.current?.click()}
        title="Custom color"
        className={cn(
          "relative h-5 w-5 rounded-full border-2 transition-transform cursor-pointer overflow-hidden",
          !COLORS.includes(strokeColor)
            ? "border-accent scale-110"
            : "border-transparent hover:scale-110",
        )}
        style={{
          background: !COLORS.includes(strokeColor)
            ? strokeColor
            : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
        }}
      >
        <input
          ref={colorInputRef}
          type="color"
          value={strokeColor}
          onChange={(e) => setStrokeColor(e.target.value)}
          className="absolute inset-0 cursor-pointer opacity-0"
          tabIndex={-1}
        />
      </button>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Stroke width */}
      {STROKE_WIDTHS.map((w) => (
        <button
          key={w}
          onClick={() => setStrokeWidth(w)}
          title={`Width ${w}`}
          className={cn(
            "flex items-center justify-center rounded-lg p-1.5 transition-colors cursor-pointer",
            strokeWidth === w
              ? "bg-accent/20 text-accent"
              : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
          )}
        >
          <div
            className="rounded-full bg-current"
            style={{ width: w + 4, height: w + 4 }}
          />
        </button>
      ))}

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Background toggle */}
      <button
        onClick={() =>
          setBackground(background === "solid" ? "grid" : "solid")
        }
        title={`Background: ${background}`}
        className={cn(
          "rounded-lg p-1.5 transition-colors cursor-pointer",
          background === "grid"
            ? "bg-accent/20 text-accent"
            : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
        )}
      >
        <Grid3X3 size={16} />
      </button>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Delete selected */}
      <button
        onClick={() => removeElements([...selectedElementIds])}
        disabled={selectedElementIds.size === 0}
        title="Delete selected"
        className="rounded-lg p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Trash2 size={16} />
      </button>

      {/* Undo / Redo */}
      <button
        onClick={undo}
        disabled={undoStack.length === 0}
        title="Undo (Ctrl+Z)"
        className="rounded-lg p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Undo2 size={16} />
      </button>
      <button
        onClick={redo}
        disabled={redoStack.length === 0}
        title="Redo (Ctrl+Shift+Z)"
        className="rounded-lg p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Redo2 size={16} />
      </button>

      {/* Separator */}
      <div className="mx-1 h-5 w-px bg-glass-border" />

      {/* Zoom */}
      <button
        onClick={() => setZoom(zoom * 1.2)}
        title="Zoom in"
        className="rounded-lg p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
      >
        <ZoomIn size={16} />
      </button>
      <span className="min-w-[3ch] text-center text-xs text-text-muted tabular-nums">
        {Math.round(zoom * 100)}%
      </span>
      <button
        onClick={() => setZoom(zoom / 1.2)}
        title="Zoom out"
        className="rounded-lg p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer"
      >
        <ZoomOut size={16} />
      </button>
    </div>
  );
}
