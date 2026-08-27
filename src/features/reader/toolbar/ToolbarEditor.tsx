import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { RotateCcw, Check, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  ALL_ITEM_IDS,
  TOOLBAR_ITEM_META,
  isSeparator,
  newSeparatorId,
  TOOLBAR_PADY_MIN,
  TOOLBAR_PADY_MAX,
  type ToolbarLayout,
  type ToolbarStyle,
} from "./toolbar-config";

// Editor containers = the four real toolbar zones plus a "palette" of
// icons that aren't placed anywhere. Separators aren't managed here (a
// custom layout is icon-only; Reset restores the default dividers).
const CONTAINERS = ["left", "center", "right", "overflow", "palette"] as const;
type ContainerId = (typeof CONTAINERS)[number];
type Containers = Record<ContainerId, string[]>;

// Keep separators (they're real, draggable slots now) + known icon items;
// drop any stale/unknown ids.
function knownSlots(ids: string[]): string[] {
  return ids.filter((id) => isSeparator(id) || TOOLBAR_ITEM_META[id]);
}

function initContainers(layout: ToolbarLayout): Containers {
  const zones = {
    left: knownSlots(layout.left),
    center: knownSlots(layout.center),
    right: knownSlots(layout.right),
    overflow: knownSlots(layout.overflow),
  };
  const placed = new Set<string>([
    ...zones.left,
    ...zones.center,
    ...zones.right,
    ...zones.overflow,
  ]);
  // Palette holds only unused icon items; new separators are minted on
  // demand via the "Add separator" button.
  const palette = ALL_ITEM_IDS.filter(
    (id) => !placed.has(id) && TOOLBAR_ITEM_META[id],
  );
  return { ...zones, palette };
}

function findContainer(
  containers: Containers,
  id: string,
): ContainerId | undefined {
  if ((CONTAINERS as readonly string[]).includes(id)) return id as ContainerId;
  return CONTAINERS.find((c) => containers[c].includes(id));
}

// Icon-only chip: looks like a real toolbar button so the editor is WYSIWYG.
// Separators render as a grabbable divider so they can be placed like icons.
function IconChip({ id, dragging }: { id: string; dragging?: boolean }) {
  const { t } = useTranslation();
  if (isSeparator(id)) {
    return (
      <div
        title={t("reader.toolbar.separator")}
        className={cn(
          "flex h-7 w-5 items-center justify-center rounded-[8px] select-none",
          dragging
            ? "cursor-grabbing bg-surface-3 shadow-page"
            : "cursor-grab bg-bg-tertiary hover:bg-surface-3",
        )}
      >
        <div className="h-3.5 w-px bg-text-muted" />
      </div>
    );
  }
  const meta = TOOLBAR_ITEM_META[id];
  const Icon = meta.icon;
  return (
    <div
      title={t(meta.labelKey, { defaultValue: meta.labelDefault })}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-[8px] text-text-secondary select-none",
        dragging
          ? "cursor-grabbing bg-surface-3 text-text-primary shadow-page"
          : "cursor-grab bg-bg-tertiary hover:bg-surface-3 hover:text-text-primary",
      )}
    >
      <Icon size={15} />
    </div>
  );
}

function SortableChip({ id }: { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("shrink-0", isDragging && "opacity-40")}
    >
      <IconChip id={id} />
    </div>
  );
}

// A droppable + sortable run of icons. `bar` variant is a bare inline row
// (sits in the real toolbar); `tray` variant is a labeled, wrapped box.
function DropZone({
  id,
  items,
  variant,
  align,
}: {
  id: ContainerId;
  items: string[];
  variant: "bar" | "tray";
  align?: "start" | "center" | "end";
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <SortableContext items={items} strategy={horizontalListSortingStrategy}>
      <div
        ref={setNodeRef}
        className={cn(
          variant === "tray"
            ? "flex min-h-[2.75rem] flex-wrap content-start gap-1.5 rounded-panel p-2"
            : "flex h-full items-center gap-1 rounded-[14px] px-1",
          isOver ? "bg-surface-3" : "bg-bg-secondary",
          variant === "bar" &&
            (align === "end"
              ? "justify-end"
              : align === "center"
                ? "justify-center"
                : "justify-start"),
          variant === "bar" && "flex-1",
        )}
      >
        {items.map((item) => (
          <SortableChip key={item} id={item} />
        ))}
        {items.length === 0 && (
          <span className="px-2 text-2xs text-text-muted/60">·</span>
        )}
      </div>
    </SortableContext>
  );
}

export function ToolbarEditor({
  layout,
  onChange,
  onReset,
  onDone,
  style,
  onStyleChange,
}: {
  layout: ToolbarLayout;
  onChange: (layout: ToolbarLayout) => void;
  onReset: () => void;
  onDone: () => void;
  style: ToolbarStyle;
  onStyleChange: (patch: Partial<ToolbarStyle>) => void;
}) {
  const { t } = useTranslation();
  const [containers, setContainers] = useState<Containers>(() =>
    initContainers(layout),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (e: DragStartEvent) =>
    setActiveId(String(e.active.id));

  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    setContainers((prev) => {
      const from = findContainer(prev, activeId);
      const to = findContainer(prev, overId);
      if (!from || !to || from === to) return prev;
      const toItems = prev[to];
      let overIndex = toItems.indexOf(overId);
      if (overIndex === -1) overIndex = toItems.length;
      return {
        ...prev,
        [from]: prev[from].filter((i) => i !== activeId),
        [to]: [
          ...toItems.slice(0, overIndex),
          activeId,
          ...toItems.slice(overIndex),
        ],
      };
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    setContainers((prev) => {
      const from = findContainer(prev, String(active.id));
      const to = findContainer(prev, String(over.id));
      if (from && to && from === to) {
        const items = prev[from];
        const oldIndex = items.indexOf(String(active.id));
        const newIndex = items.indexOf(String(over.id));
        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          return { ...prev, [from]: arrayMove(items, oldIndex, newIndex) };
        }
      }
      return prev;
    });
  };

  const handleDone = () => {
    onChange({
      left: containers.left,
      center: containers.center,
      right: containers.right,
      overflow: containers.overflow,
    });
    onDone();
  };

  // Restore the shipped default and exit without re-persisting.
  const handleReset = () => {
    onReset();
    onDone();
  };

  // Mint a fresh separator into the palette; drag it onto the bar to place.
  const handleAddSeparator = () => {
    setContainers((prev) => ({
      ...prev,
      palette: [...prev.palette, newSeparatorId()],
    }));
  };

  // Drag the bottom edge to resize the bar height (clamped in the setter).
  const heightDragRef = useRef<{ startY: number; startH: number } | null>(null);
  const onHeightPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    heightDragRef.current = { startY: e.clientY, startH: style.height };
  };
  const onHeightPointerMove = (e: React.PointerEvent) => {
    const d = heightDragRef.current;
    if (!d) return;
    onStyleChange({ height: d.startH + (e.clientY - d.startY) });
  };
  const onHeightPointerUp = (e: React.PointerEvent) => {
    heightDragRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="pt-safe-top">
      {/* edit banner */}
      <div className="flex items-center justify-between gap-3 px-4 py-2">
        <span className="min-w-0 truncate text-2xs text-text-muted">
          {t("reader.toolbar.customizeHint")}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <label className="flex items-center gap-1.5 text-2xs text-text-muted">
            {t("reader.toolbar.iconPadding")}
            <input
              type="number"
              min={TOOLBAR_PADY_MIN}
              max={TOOLBAR_PADY_MAX}
              value={style.paddingY}
              onChange={(e) =>
                onStyleChange({ paddingY: Number(e.target.value) })
              }
              className="field w-14 px-1.5 py-0.5 text-center text-2xs"
            />
          </label>
          <button
            type="button"
            onClick={handleAddSeparator}
            className="chip flex items-center gap-1.5 px-2.5 py-1 text-2xs text-text-secondary hover:text-text-primary cursor-pointer"
          >
            <Plus size={13} />
            {t("reader.toolbar.addSeparator")}
          </button>
          <button
            type="button"
            onClick={handleReset}
            className="chip flex items-center gap-1.5 px-2.5 py-1 text-2xs text-text-secondary hover:text-text-primary cursor-pointer"
          >
            <RotateCcw size={13} />
            {t("reader.toolbar.customizeReset")}
          </button>
          <button
            type="button"
            onClick={handleDone}
            className="flex items-center gap-1.5 rounded-chip bg-text-primary px-3 py-1 text-2xs font-medium text-bg-primary transition-opacity hover:opacity-90 cursor-pointer"
          >
            <Check size={13} />
            {t("reader.toolbar.customizeDone")}
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {/* the real toolbar, in place, left / center / right, live icons,
            at the configured height */}
        <div
          className="flex items-center gap-2 overflow-hidden px-2 sm:px-4"
          style={{ height: style.height + 16 }}
        >
          <DropZone
            id="left"
            items={containers.left}
            variant="bar"
            align="start"
          />
          <DropZone
            id="center"
            items={containers.center}
            variant="bar"
            align="center"
          />
          <DropZone
            id="right"
            items={containers.right}
            variant="bar"
            align="end"
          />
        </div>
        {/* drag the bottom edge to resize the bar height */}
        <div
          onPointerDown={onHeightPointerDown}
          onPointerMove={onHeightPointerMove}
          onPointerUp={onHeightPointerUp}
          title={t("reader.toolbar.dragHeight")}
          className="group flex h-3 cursor-ns-resize items-center justify-center gap-2 transition-colors hover:bg-bg-secondary"
        >
          <div className="h-0.5 w-10 rounded-full bg-text-muted/40 group-hover:bg-text-primary" />
          <span className="text-[9px] tabular-nums text-text-muted/70">
            {style.height}px
          </span>
        </div>

        {/* hidden destinations: the ⋮ menu + the unused palette */}
        <div className="flex flex-wrap gap-4 px-4 pb-3 pt-1">
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
              {t("reader.toolbar.zoneOverflow")}
            </span>
            <DropZone
              id="overflow"
              items={containers.overflow}
              variant="tray"
            />
          </div>
          <div className="flex min-w-[10rem] flex-1 flex-col gap-1">
            <span className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
              {t("reader.toolbar.customizePalette")}
            </span>
            <DropZone id="palette" items={containers.palette} variant="tray" />
          </div>
        </div>

        <DragOverlay>
          {activeId ? <IconChip id={activeId} dragging /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
