/**
 * dnd-kit wiring for the course page's section/item ordering (owner only),
 * mirroring src/features/chat/sidebar/useSidebarDnd.ts: sensors, collision
 * detection, the in-flight drag ids (ghost + drop-indicator) and the drop
 * handler that maps a drop onto the space store's reorder / move calls.
 * Section ids are "section:<id>", item ids "item:<id>", and a section's
 * item list is also droppable as "sect-items:<sectionId|general>" so an
 * empty section still accepts a drop.
 */
import { useState } from "react";
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
import { arrayMove, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { SpaceContent, SpaceSection } from "@/types/space";

const GENERAL_KEY = "general";

interface UseCourseDndArgs {
  sections: SpaceSection[];
  content: SpaceContent[];
  updateSection: (id: string, patch: { sortOrder?: number }) => Promise<void>;
  updateSpaceContent: (
    id: string,
    patch: { sectionId?: string | null; sortOrder?: number },
  ) => Promise<void>;
}

export function useCourseDnd({
  sections,
  content,
  updateSection,
  updateSpaceContent,
}: UseCourseDndArgs) {
  // small activation distance so a plain click still opens the item / toggles
  // the section instead of starting a drag.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
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

  const activeDragSection = activeDragId?.startsWith("section:")
    ? (sections.find((s) => s.id === activeDragId.slice("section:".length)) ?? null)
    : null;
  const activeDragItem = activeDragId?.startsWith("item:")
    ? (content.find((c) => c.id === activeDragId.slice("item:".length)) ?? null)
    : null;

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

  const groupKey = (sectionId: string | null | undefined) => sectionId ?? GENERAL_KEY;

  const itemsInGroup = (key: string): SpaceContent[] =>
    content
      .filter((c) => groupKey(c.section_id) === key)
      .sort((a, b) => a.sort_order - b.sort_order);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setOverDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = active.id as string;
    const overId = over.id as string;
    if (activeId === overId) return;

    // section reorder: drop one section card onto another
    if (activeId.startsWith("section:")) {
      const id = activeId.slice("section:".length);
      if (!overId.startsWith("section:")) return;
      const overSectionId = overId.slice("section:".length);
      if (id === overSectionId) return;
      const oldIndex = sections.findIndex((s) => s.id === id);
      const newIndex = sections.findIndex((s) => s.id === overSectionId);
      if (oldIndex === -1 || newIndex === -1) return;
      const reordered = arrayMove(sections, oldIndex, newIndex);
      void Promise.all(
        reordered.map((s, idx) => updateSection(s.id, { sortOrder: idx })),
      );
      return;
    }

    // item reorder / move: onto another item, an empty section's item
    // list, or a section's header (jumps to the top of that section)
    if (!activeId.startsWith("item:")) return;
    const itemId = activeId.slice("item:".length);
    const activeItem = content.find((c) => c.id === itemId);
    if (!activeItem) return;

    let targetKey: string;
    let insertIndex: number;

    if (overId.startsWith("item:")) {
      const overItemId = overId.slice("item:".length);
      const overItem = content.find((c) => c.id === overItemId);
      if (!overItem) return;
      targetKey = groupKey(overItem.section_id);
      const targetList = itemsInGroup(targetKey).filter((c) => c.id !== itemId);
      const overIdx = targetList.findIndex((c) => c.id === overItemId);
      insertIndex = overIdx === -1 ? targetList.length : overIdx;
    } else if (overId.startsWith("sect-items:")) {
      targetKey = overId.slice("sect-items:".length);
      insertIndex = itemsInGroup(targetKey).filter((c) => c.id !== itemId).length;
    } else if (overId.startsWith("section:")) {
      targetKey = overId.slice("section:".length);
      insertIndex = 0;
    } else {
      return;
    }

    const targetList = itemsInGroup(targetKey).filter((c) => c.id !== itemId);
    targetList.splice(insertIndex, 0, activeItem);
    const targetSectionId = targetKey === GENERAL_KEY ? null : targetKey;

    void Promise.all(
      targetList.map((c, idx) => {
        const patch: { sortOrder: number; sectionId?: string | null } = { sortOrder: idx };
        if (c.id === itemId) patch.sectionId = targetSectionId;
        return updateSpaceContent(c.id, patch);
      }),
    );
  };

  return {
    sensors,
    collisionDetection,
    activeDragId,
    overDragId,
    activeDragSection,
    activeDragItem,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
