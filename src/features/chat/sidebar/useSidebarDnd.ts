/**
 * dnd-kit wiring for the sidebar tree: sensors, collision detection, the
 * in-flight drag ids (ghost + drop-indicator line) and the drop handler
 * that maps a drop target onto the chat store's reorder / move calls.
 * Folder ids are "folder:<id>" / "nest:<id>", conversations "conv:<id>",
 * the root strip "root" / "root-pin".
 */
import { useMemo, useState } from "react";
import {
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { useShallow } from "zustand/react/shallow";
import { useChatStore } from "@/stores/chat-store";
import type { ChatConversation, ChatFolder } from "@/types/chat";

interface UseSidebarDndArgs {
  folders: ChatFolder[];
  /** Every conversation (not the search-filtered list). */
  conversations: ChatConversation[];
  /** Drill-in root; "root" drops land in this folder. null = top level. */
  rootFolderId: string | null;
}

export function useSidebarDnd({
  folders,
  conversations,
  rootFolderId,
}: UseSidebarDndArgs) {
  const {
    moveConversationToFolder,
    moveFolderToParent,
    reorderConversation,
    reorderFolder,
  } = useChatStore(
    useShallow((s) => ({
      moveConversationToFolder: s.moveConversationToFolder,
      moveFolderToParent: s.moveFolderToParent,
      reorderConversation: s.reorderConversation,
      reorderFolder: s.reorderFolder,
    })),
  );

  // MouseSensor (not PointerSensor) so touch scroll goes through TouchSensor and
  // doesn't start a drag. delay 600ms clears the 500ms long-press menu.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 14 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 600, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // smallest droppable wins so the most specific target gets the drop;
  // closestCenter fallback for gaps between rows
  const collisionDetection: CollisionDetection = (args) => {
    const within = pointerWithin(args);
    if (within.length === 0) return closestCenter(args);
    return within.slice().sort((a, b) => {
      const aRect = args.droppableRects.get(a.id);
      const bRect = args.droppableRects.get(b.id);
      if (!aRect || !bRect) return 0;
      return aRect.width * aRect.height - bRect.width * bRect.height;
    });
  };

  // drives the DragOverlay ghost
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  // current `over` id, drives the drop-indicator line
  const [overDragId, setOverDragId] = useState<string | null>(null);
  const activeDragConv = useMemo(() => {
    if (!activeDragId?.startsWith("conv:")) return null;
    const id = activeDragId.slice("conv:".length);
    return conversations.find((c) => c.id === id) ?? null;
  }, [activeDragId, conversations]);
  const activeDragFolder = useMemo(() => {
    if (!activeDragId?.startsWith("folder:")) return null;
    const id = activeDragId.slice("folder:".length);
    return folders.find((f) => f.id === id) ?? null;
  }, [activeDragId, folders]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
    setOverDragId(null);
  };

  const handleDragOver = (event: DragOverEvent) => {
    setOverDragId((event.over?.id as string | null) ?? null);
  };

  const handleDragCancel = () => {
    setActiveDragId(null);
    setOverDragId(null);
  };

  // sort_order is fractional: insert via midpoints, no renumbering.
  // ctx must be the future state (exclude the dragged item if it's moving in).
  const topOf = (ctx: { sort_order: number }[]): number => {
    if (ctx.length === 0) return 0;
    return Math.min(...ctx.map((x) => x.sort_order)) - 1;
  };
  const aboveItem = (
    ctx: { id: string; sort_order: number }[],
    targetId: string,
  ): number => {
    const sorted = [...ctx].sort((a, b) => a.sort_order - b.sort_order);
    const idx = sorted.findIndex((x) => x.id === targetId);
    if (idx === -1) return topOf(ctx);
    const targetSort = sorted[idx].sort_order;
    if (idx === 0) return targetSort - 1;
    const prevSort = sorted[idx - 1].sort_order;
    return (prevSort + targetSort) / 2;
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setOverDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;

    const isRootDrop = overId === "root" || overId === "root-pin";

    // folder drag
    if (activeId.startsWith("folder:")) {
      const id = activeId.slice("folder:".length);
      const activeFolder = folders.find((f) => f.id === id);
      if (!activeFolder) return;

      if (isRootDrop) {
        const futureSiblings = folders.filter(
          (f) => f.parent_id === rootFolderId && f.id !== id,
        );
        void moveFolderToParent(id, rootFolderId, topOf(futureSiblings));
        return;
      }

      // folder onto folder: same-parent reorders, different-parent nests
      if (overId.startsWith("folder:") || overId.startsWith("nest:")) {
        const targetId = overId.startsWith("folder:")
          ? overId.slice("folder:".length)
          : overId.slice("nest:".length);
        if (id === targetId) return;
        const targetFolder = folders.find((f) => f.id === targetId);
        if (!targetFolder) return;

        if (activeFolder.parent_id === targetFolder.parent_id) {
          const siblings = folders.filter(
            (f) => f.parent_id === targetFolder.parent_id && f.id !== id,
          );
          void reorderFolder(id, aboveItem(siblings, targetId));
        } else {
          // Guard against nesting a folder into its own descendant, which
          // would orphan the subtree into a cycle. Walk the target's
          // ancestor chain; if we reach the dragged folder, bail.
          let ancestor: string | null = targetFolder.parent_id;
          while (ancestor !== null) {
            if (ancestor === id) return;
            ancestor = folders.find((f) => f.id === ancestor)?.parent_id ?? null;
          }
          const futureChildren = folders.filter(
            (f) => f.parent_id === targetId && f.id !== id,
          );
          void moveFolderToParent(id, targetId, topOf(futureChildren));
        }
      }
      return;
    }

    // conversation drag
    if (!activeId.startsWith("conv:")) return;
    const convId = activeId.slice("conv:".length);
    const activeConv = conversations.find((c) => c.id === convId);
    if (!activeConv) return;

    if (isRootDrop) {
      // In a drilled view "root" is the focused folder, so dropping a quick
      // chat here promotes it into that folder.
      const futureRoot = conversations.filter(
        (c) => c.folder_id === rootFolderId && c.id !== convId,
      );
      void moveConversationToFolder(convId, rootFolderId, topOf(futureRoot));
      return;
    }

    // drop on a folder row: nest in at top
    if (overId.startsWith("folder:") || overId.startsWith("nest:")) {
      const targetFolderId = overId.startsWith("folder:")
        ? overId.slice("folder:".length)
        : overId.slice("nest:".length);
      const futureChildren = conversations.filter(
        (c) => c.folder_id === targetFolderId && c.id !== convId,
      );
      void moveConversationToFolder(
        convId,
        targetFolderId,
        topOf(futureChildren),
      );
      return;
    }

    // drop on another conversation: insert above it
    if (overId.startsWith("conv:")) {
      const overConvId = overId.slice("conv:".length);
      if (overConvId === convId) return;
      const overConv = conversations.find((c) => c.id === overConvId);
      if (!overConv) return;

      const futureContext = conversations.filter(
        (c) => c.folder_id === overConv.folder_id && c.id !== convId,
      );
      const newSortOrder = aboveItem(futureContext, overConvId);

      if (activeConv.folder_id === overConv.folder_id) {
        void reorderConversation(convId, newSortOrder);
      } else {
        void moveConversationToFolder(
          convId,
          overConv.folder_id,
          newSortOrder,
        );
      }
    }
  };

  return {
    sensors,
    collisionDetection,
    activeDragId,
    overDragId,
    activeDragConv,
    activeDragFolder,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
