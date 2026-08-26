/** Drag-to-move drop targets around the library list: breadcrumb crumbs
 *  and the "up one level" placeholder row during an active drag. */
import { useTranslation } from "react-i18next";
import { useDroppable } from "@dnd-kit/core";
import { ArrowUp, CornerLeftUp } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A breadcrumb nav button that's also a drop target; dropping here moves
 * the item to that level. While a drag is in flight every ancestor crumb
 * lights up as a visible target, and the hovered one grows a "Drop here"
 * chip so it is obvious the crumb will receive the item.
 */
export function BreadcrumbDropTarget({
  dropId,
  dragging,
  onClick,
  children,
}: {
  dropId: string;
  dragging: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({ id: dropId });
  return (
    <button
      ref={setNodeRef}
      onClick={onClick}
      data-drop-target={dropId}
      data-drop-over={isOver || undefined}
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-chip py-0.5 cursor-pointer transition-colors",
        !dragging &&
          "px-1.5 text-text-muted-2 hover:text-text-primary hover:bg-surface-3",
        dragging && !isOver && "bg-surface-3 px-2 text-text-secondary",
        dragging && isOver && "bg-accent-soft px-2 text-text-primary",
      )}
    >
      {dragging && isOver && (
        <CornerLeftUp size={12} strokeWidth={2} className="shrink-0" />
      )}
      {children}
      {dragging && isOver && (
        <span className="ml-1 rounded-chip bg-bg-primary/70 px-1.5 text-2xs font-medium text-text-primary">
          {t("library.dnd.dropHere")}
        </span>
      )}
    </button>
  );
}

/**
 * "Up to: <parent>" row shown above the list / grid while dragging
 * inside a folder. Dropping on it moves the item to the parent level
 * (root when the parent is the root). Always mounted so the opacity
 * can fade in and out; collapsed and inert when no drag is running.
 */
export function ParentDropZone({
  parentFolderId,
  parentName,
  visible,
}: {
  parentFolderId: string | null;
  parentName: string;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const { setNodeRef, isOver } = useDroppable({
    id: `parent:${parentFolderId ?? "root"}`,
    disabled: !visible,
  });
  return (
    <div
      ref={setNodeRef}
      data-drop-target="parent"
      data-drop-over={isOver || undefined}
      aria-hidden={!visible}
      className={cn(
        "flex items-center gap-2 overflow-hidden rounded-panel border border-dashed px-3 text-sm transition-[opacity,max-height,margin,background-color,color,visibility] duration-120 ease-out",
        visible
          ? "mb-2 max-h-16 py-2 opacity-100"
          : "invisible pointer-events-none mb-0 max-h-0 border-transparent py-0 opacity-0",
        visible && !isOver && "border-surface-3 text-text-muted",
        visible && isOver && "border-accent-soft bg-accent-soft text-text-primary",
      )}
    >
      <ArrowUp size={16} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">
        {t("library.dnd.moveUp", { name: parentName })}
      </span>
      {isOver && (
        <span className="ml-auto shrink-0 rounded-chip bg-bg-primary/70 px-1.5 text-2xs font-medium">
          {t("library.dnd.dropHere")}
        </span>
      )}
    </div>
  );
}
