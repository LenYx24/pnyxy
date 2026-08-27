/**
 * Main column of the Moodle-style course page: the space description +
 * a collapse-all toggle, the child spaces card (orgs only), then the
 * ordered sections (an implicit "General" group first, then each
 * SpaceSection) each rendered as a card with owner CRUD in its kebab.
 * CourseSpacePage owns the content-open semantics (study-folder
 * awareness) and the AddContentModal instance; this component owns
 * section/item layout, section CRUD, file upload and legacy files.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileUp,
  GraduationCap,
  GripVertical,
  Link2,
  Loader2,
  MoreHorizontal,
  Plus,
  Trash2,
  Type as TypeIcon,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { DndContext, DragOverlay, useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, FormModal, IconButton } from "@/components/ui";
import { openMenuAtButton } from "@/features/chat/menu-anchor";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { useConfirm } from "@/hooks/use-confirm";
import { useSpaceStore } from "@/stores/space-store";
import { showToast } from "@/stores/toast-store";
import { restrictToWindowEdges } from "@/lib/dnd-modifiers";
import { cn } from "@/lib/cn";
import { useCourseDnd } from "./useCourseDnd";
import {
  deleteSpaceFile,
  listSpaceFiles,
  openSpaceFile,
  uploadSpaceFile,
  type SpaceFile,
} from "./space-files";
import { KIND_ICON, isExternal } from "./content-shared";
import { isSafeExternalUrl } from "@/lib/safe-url";
import type { Space, SpaceContent, SpaceSection } from "@/types/space";

const SECTIONS_COLLAPSED_KEY = (spaceId: string) =>
  `pnyxy:space-sections-collapsed:${spaceId}`;
const GENERAL_KEY = "general";

function readSectionsCollapsed(spaceId: string): Set<string> {
  try {
    const raw = localStorage.getItem(SECTIONS_COLLAPSED_KEY(spaceId));
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function writeSectionsCollapsed(spaceId: string, ids: Set<string>): void {
  try {
    localStorage.setItem(
      SECTIONS_COLLAPSED_KEY(spaceId),
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    // private mode: not fatal
  }
}

type RowItem =
  | { type: "content"; key: string; content: SpaceContent }
  | { type: "legacy"; key: string; file: SpaceFile };

/** A "file" content item's url is stored as `${spaceId}/${name}` to
 *  match the shared space-files bucket path; strip that prefix back
 *  off to get the bare storage object name. */
function fileNameOf(url: string, spaceId: string): string {
  const prefix = `${spaceId}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

export function CourseSections({
  spaceId,
  owner,
  isMember,
  onOpenItem,
  onOpenAddContent,
  createSectionOpen,
  onOpenCreateSection,
  onCloseCreateSection,
}: {
  spaceId: string;
  owner: boolean;
  /** Ticks and progress are personal state: only members/owners see them. */
  isMember: boolean;
  onOpenItem: (item: SpaceContent) => void;
  onOpenAddContent: (sectionId: string | null) => void;
  createSectionOpen: boolean;
  onOpenCreateSection: () => void;
  onCloseCreateSection: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { confirm, ConfirmModalElement } = useConfirm();
  const activeSpace = useSpaceStore((s) => s.activeSpace);
  const activeSpaceContent = useSpaceStore((s) => s.activeSpaceContent);
  const activeSpaceSections = useSpaceStore((s) => s.activeSpaceSections);
  const activeSpaceChildren = useSpaceStore((s) => s.activeSpaceChildren);
  const completedContentIds = useSpaceStore((s) => s.completedContentIds);
  const toggleCompleted = useSpaceStore((s) => s.toggleCompleted);
  const addSection = useSpaceStore((s) => s.addSection);
  const updateSection = useSpaceStore((s) => s.updateSection);
  const removeSection = useSpaceStore((s) => s.removeSection);
  const addSpaceContent = useSpaceStore((s) => s.addSpaceContent);
  const updateSpaceContent = useSpaceStore((s) => s.updateSpaceContent);
  const removeSpaceContent = useSpaceStore((s) => s.removeSpaceContent);
  const showProgress = isMember || owner;

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    readSectionsCollapsed(spaceId),
  );
  const [legacyFiles, setLegacyFiles] = useState<SpaceFile[]>([]);
  const [busyLegacy, setBusyLegacy] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const uploadTargetRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [renameSection, setRenameSection] = useState<SpaceSection | null>(null);
  const [moveItem, setMoveItem] = useState<SpaceContent | null>(null);
  const [textItemModal, setTextItemModal] = useState<{
    open: boolean;
    sectionId: string | null;
  }>({
    open: false,
    sectionId: null,
  });

  const refreshLegacy = async () => {
    const files = await listSpaceFiles(spaceId);
    setLegacyFiles(files);
  };
  useEffect(() => {
    setCollapsed(readSectionsCollapsed(spaceId));
    void refreshLegacy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  const contentFileNames = useMemo(() => {
    const names = new Set<string>();
    for (const c of activeSpaceContent) {
      if (c.kind !== "file" || !c.url) continue;
      names.add(fileNameOf(c.url, spaceId));
    }
    return names;
  }, [activeSpaceContent, spaceId]);

  const orphanFiles = useMemo(
    () => legacyFiles.filter((f) => !contentFileNames.has(f.name)),
    [legacyFiles, contentFileNames],
  );

  const generalItems = useMemo(() => {
    const items: RowItem[] = activeSpaceContent
      .filter((c) => (c.section_id ?? null) === null)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({ type: "content" as const, key: `c-${c.id}`, content: c }));
    for (const f of orphanFiles) {
      items.push({ type: "legacy", key: `l-${f.name}`, file: f });
    }
    return items;
  }, [activeSpaceContent, orphanFiles]);

  const itemsBySection = useMemo(() => {
    const map = new Map<string, SpaceContent[]>();
    for (const c of activeSpaceContent) {
      if (!c.section_id) continue;
      if (!map.has(c.section_id)) map.set(c.section_id, []);
      map.get(c.section_id)!.push(c);
    }
    for (const list of map.values())
      list.sort((a, b) => a.sort_order - b.sort_order);
    return map;
  }, [activeSpaceContent]);

  const totalGroups = 1 + activeSpaceSections.length;
  const allCollapsed = collapsed.size >= totalGroups;

  // whole-course completion, across every section + General; labels don't count.
  const trackableContent = useMemo(
    () => activeSpaceContent.filter((c) => c.kind !== "label"),
    [activeSpaceContent],
  );
  const totalAll = trackableContent.length;
  const doneAll = useMemo(
    () => trackableContent.filter((c) => completedContentIds.has(c.id)).length,
    [trackableContent, completedContentIds],
  );
  const progressPct = totalAll > 0 ? Math.round((doneAll / totalAll) * 100) : 0;

  const sectionProgress = (items: RowItem[]) => {
    let total = 0;
    let done = 0;
    for (const row of items) {
      if (row.type !== "content" || row.content.kind === "label") continue;
      total += 1;
      if (completedContentIds.has(row.content.id)) done += 1;
    }
    return { done, total };
  };

  const dnd = useCourseDnd({
    sections: activeSpaceSections,
    content: activeSpaceContent,
    updateSection,
    updateSpaceContent,
  });

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      writeSectionsCollapsed(spaceId, next);
      return next;
    });
  };

  const toggleAll = () => {
    const next = allCollapsed
      ? new Set<string>()
      : new Set<string>([GENERAL_KEY, ...activeSpaceSections.map((s) => s.id)]);
    setCollapsed(next);
    writeSectionsCollapsed(spaceId, next);
  };

  const openUploadFor = (sectionId: string | null) => {
    uploadTargetRef.current = sectionId ?? GENERAL_KEY;
    fileInputRef.current?.click();
  };

  const pendingKey = (sectionId: string | null) => sectionId ?? GENERAL_KEY;

  const handleFilesChosen = async (list: FileList | null) => {
    const targetRaw = uploadTargetRef.current;
    const sectionId = targetRaw === GENERAL_KEY ? null : targetRaw;
    const key = pendingKey(sectionId);
    if (!list || list.length === 0) return;
    for (const file of Array.from(list)) {
      setPending((prev) => ({
        ...prev,
        [key]: [...(prev[key] ?? []), file.name],
      }));
      try {
        const err = await uploadSpaceFile(spaceId, file);
        if (err) {
          showToast(
            t("spaces.coursePage.uploadFailed", {
              name: file.name,
            }),
            "error",
          );
        } else {
          await addSpaceContent({
            spaceId,
            kind: "file",
            title: file.name,
            url: `${spaceId}/${file.name}`,
            sectionId,
          });
        }
      } finally {
        setPending((prev) => ({
          ...prev,
          [key]: (prev[key] ?? []).filter((n) => n !== file.name),
        }));
      }
    }
    await refreshLegacy();
  };

  // copies land in the member's library under <course>/<section>
  const folderForSection = async (sectionId: string | null) => {
    if (!activeSpace) return null;
    const title = sectionId
      ? (activeSpaceSections.find((x) => x.id === sectionId)?.title ?? null)
      : null;
    return useSpaceStore.getState().ensureSectionFolder(activeSpace, title);
  };

  const openLegacyFile = async (name: string) => {
    setBusyLegacy(name);
    try {
      const folderId = await folderForSection(null);
      await openSpaceFile(spaceId, name, navigate, { folderId });
    } catch {
      showToast(t("spaces.coursePage.openFailed"), "error");
    } finally {
      setBusyLegacy(null);
    }
  };

  const deleteLegacyFile = async (name: string) => {
    const ok = await confirm({
      title: t("spaces.coursePage.deleteFileTitle"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await deleteSpaceFile(spaceId, name);
    await refreshLegacy();
  };

  const openItemRow = (item: SpaceContent) => {
    if (item.kind === "file" && item.url) {
      const name = fileNameOf(item.url, spaceId);
      void folderForSection(item.section_id ?? null)
        .then((folderId) => openSpaceFile(spaceId, name, navigate, { folderId }))
        .catch(() => showToast(t("spaces.coursePage.openFailed"), "error"));
      return;
    }
    onOpenItem(item);
  };

  const moveItemUpDown = async (
    sectionId: string | null,
    item: SpaceContent,
    dir: -1 | 1,
  ) => {
    const list = sectionId
      ? (itemsBySection.get(sectionId) ?? [])
      : generalItems
          .filter(
            (r): r is Extract<RowItem, { type: "content" }> =>
              r.type === "content",
          )
          .map((r) => r.content);
    const idx = list.findIndex((c) => c.id === item.id);
    const neighbor = list[idx + dir];
    if (!neighbor) return;
    await Promise.all([
      updateSpaceContent(item.id, { sortOrder: neighbor.sort_order }),
      updateSpaceContent(neighbor.id, { sortOrder: item.sort_order }),
    ]);
  };

  const moveSectionUpDown = async (section: SpaceSection, dir: -1 | 1) => {
    const sorted = activeSpaceSections;
    const idx = sorted.findIndex((s) => s.id === section.id);
    const neighbor = sorted[idx + dir];
    if (!neighbor) return;
    await Promise.all([
      updateSection(section.id, { sortOrder: neighbor.sort_order }),
      updateSection(neighbor.id, { sortOrder: section.sort_order }),
    ]);
  };

  const removeItem = async (item: SpaceContent) => {
    const ok = await confirm({
      title: t("spaces.coursePage.removeItemTitle"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    if (item.kind === "file" && item.url) {
      await deleteSpaceFile(spaceId, fileNameOf(item.url, spaceId));
    }
    await removeSpaceContent(item.id);
    await refreshLegacy();
  };

  const removeSectionWithConfirm = async (section: SpaceSection) => {
    const ok = await confirm({
      title: t("spaces.coursePage.deleteSectionTitle"),
      body: t("spaces.coursePage.deleteSectionBody"),
      confirmLabel: t("common.delete"),
      danger: true,
    });
    if (!ok) return;
    await removeSection(section.id);
  };

  const itemMenuEntries = (
    sectionId: string | null,
    item: SpaceContent,
  ): ContextMenuEntry[] => [
    {
      id: "move-section",
      label: t("spaces.coursePage.moveToSection"),
      icon: ChevronRight,
      onClick: () => setMoveItem(item),
    },
    {
      id: "up",
      label: t("spaces.coursePage.moveUp"),
      icon: ArrowUp,
      onClick: () => void moveItemUpDown(sectionId, item, -1),
    },
    {
      id: "down",
      label: t("spaces.coursePage.moveDown"),
      icon: ArrowDown,
      onClick: () => void moveItemUpDown(sectionId, item, 1),
    },
    { id: "div", divider: true },
    {
      id: "remove",
      label: t("spaces.coursePage.removeItem"),
      icon: Trash2,
      danger: true,
      onClick: () => void removeItem(item),
    },
  ];

  const addMenuEntries = (sectionId: string | null): ContextMenuEntry[] => [
    {
      id: "file",
      label: t("spaces.coursePage.addFile"),
      icon: FileUp,
      onClick: () => openUploadFor(sectionId),
    },
    {
      id: "link",
      label: t("spaces.coursePage.addLink"),
      icon: Link2,
      onClick: () => onOpenAddContent(sectionId),
    },
    {
      id: "text",
      label: t("spaces.coursePage.addText"),
      icon: TypeIcon,
      onClick: () => setTextItemModal({ open: true, sectionId }),
    },
  ];

  const sectionMenuEntries = (section: SpaceSection): ContextMenuEntry[] => [
    {
      id: "rename",
      label: t("spaces.coursePage.renameSection"),
      icon: TypeIcon,
      onClick: () => setRenameSection(section),
    },
    {
      id: "up",
      label: t("spaces.coursePage.moveUp"),
      icon: ArrowUp,
      onClick: () => void moveSectionUpDown(section, -1),
    },
    {
      id: "down",
      label: t("spaces.coursePage.moveDown"),
      icon: ArrowDown,
      onClick: () => void moveSectionUpDown(section, 1),
    },
    {
      id: "add-item",
      label: t("spaces.coursePage.addItem"),
      icon: Plus,
      onClick: () => onOpenAddContent(section.id),
    },
    {
      id: "upload",
      label: t("spaces.coursePage.addFile"),
      icon: FileUp,
      onClick: () => openUploadFor(section.id),
    },
    { id: "div", divider: true },
    {
      id: "delete",
      label: t("spaces.coursePage.deleteSection"),
      icon: Trash2,
      danger: true,
      onClick: () => void removeSectionWithConfirm(section),
    },
  ];

  // Thin adapter so SectionCard doesn't need to know ItemRow's whole
  // prop list, it just turns a row + its drag handle into a node.
  const renderRow = (
    row: RowItem,
    sectionId: string | null,
    dragHandleProps?: HTMLAttributes<HTMLElement>,
  ) => (
    <ItemRow
      key={row.key}
      row={row}
      sectionId={sectionId}
      dragHandleProps={dragHandleProps}
      owner={owner}
      showProgress={showProgress}
      completedContentIds={completedContentIds}
      onToggleCompleted={toggleCompleted}
      busyLegacy={busyLegacy}
      onOpenItemRow={openItemRow}
      onOpenLegacyFile={openLegacyFile}
      onDeleteLegacyFile={deleteLegacyFile}
      itemMenuEntries={itemMenuEntries}
    />
  );

  if (!activeSpace) return null;

  return (
    <DndContext
      sensors={dnd.sensors}
      collisionDetection={dnd.collisionDetection}
      modifiers={[restrictToWindowEdges]}
      onDragStart={dnd.handleDragStart}
      onDragOver={dnd.handleDragOver}
      onDragEnd={dnd.handleDragEnd}
      onDragCancel={dnd.handleDragCancel}
    >
      <div className="space-y-3 px-6 py-4">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handleFilesChosen(e.target.files);
            e.target.value = "";
          }}
        />

        {activeSpaceChildren.length > 0 && (
          <div className="overflow-hidden rounded-panel bg-bg-tertiary">
            <div className="px-3 py-2.5 text-[15px] font-semibold text-text-primary">
              {t("spaces.childrenHeading")}
            </div>
            <div className="divide-y divide-surface-3/60 border-t border-surface-3/60">
              {activeSpaceChildren.map((child) => (
                <ChildSpaceRow key={child.id} space={child} />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-3">
          {activeSpace.description ? (
            <p className="min-w-0 flex-1 text-sm text-text-secondary">
              {activeSpace.description}
            </p>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-3">
            {showProgress && totalAll > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-2xs font-medium text-text-muted">
                  {t("spaces.coursePage.progress.label")}
                </span>
                <span className="text-2xs tabular-nums text-text-muted">
                  {doneAll}/{totalAll}
                </span>
                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={toggleAll}
              className="cursor-pointer text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
            >
              {allCollapsed
                ? t("spaces.coursePage.expandAll")
                : t("spaces.coursePage.collapseAll")}
            </button>
          </div>
        </div>

        <SectionCard
          groupKey={GENERAL_KEY}
          anchorId="section-general"
          title={t("spaces.coursePage.general")}
          items={generalItems}
          isOpen={!collapsed.has(GENERAL_KEY)}
          onToggleOpen={() => toggleGroup(GENERAL_KEY)}
          progress={sectionProgress(generalItems)}
          showProgress={showProgress}
          owner={owner}
          pendingNames={pending[GENERAL_KEY] ?? []}
          onAddMenu={(e) => openMenuAtButton(e, addMenuEntries(null))}
          renderRow={renderRow}
        />

        <SortableContext
          items={activeSpaceSections.map((s) => `section:${s.id}`)}
          strategy={verticalListSortingStrategy}
        >
          {activeSpaceSections.map((section) => {
            const items: RowItem[] = (itemsBySection.get(section.id) ?? []).map(
              (c) => ({
                type: "content" as const,
                key: `c-${c.id}`,
                content: c,
              }),
            );
            return (
              <DraggableSection
                key={section.id}
                section={section}
                disabled={!owner}
              >
                {({ dragHandleProps }) => (
                  <SectionCard
                    groupKey={section.id}
                    anchorId={`section-${section.id}`}
                    title={
                      section.title || t("spaces.coursePage.untitledSection")
                    }
                    description={section.description}
                    items={items}
                    section={section}
                    dragHandle={
                      owner ? (
                        <span
                          {...dragHandleProps}
                          aria-label={t("spaces.coursePage.dnd.dragSection")}
                          title={t("spaces.coursePage.dnd.dragSection")}
                          className="shrink-0 cursor-grab touch-none text-text-muted-2 transition-colors hover:text-text-muted active:cursor-grabbing"
                        >
                          <GripVertical size={16} strokeWidth={1.5} />
                        </span>
                      ) : undefined
                    }
                    isOpen={!collapsed.has(section.id)}
                    onToggleOpen={() => toggleGroup(section.id)}
                    progress={sectionProgress(items)}
                    showProgress={showProgress}
                    owner={owner}
                    pendingNames={pending[section.id] ?? []}
                    onSectionMenu={(e) =>
                      openMenuAtButton(e, sectionMenuEntries(section))
                    }
                    onAddMenu={(e) =>
                      openMenuAtButton(e, addMenuEntries(section.id))
                    }
                    renderRow={renderRow}
                  />
                )}
              </DraggableSection>
            );
          })}
        </SortableContext>

        {owner && (
          <div className="pt-1">
            <button
              type="button"
              onClick={onOpenCreateSection}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-control px-2 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
            >
              <Plus size={14} />
              {t("spaces.coursePage.newSection")}
            </button>
          </div>
        )}

        {ConfirmModalElement}

        {(createSectionOpen || renameSection) && (
          <SectionFormModal
            initialTitle={renameSection?.title ?? ""}
            title={
              renameSection
                ? t("spaces.coursePage.renameSection")
                : t("spaces.coursePage.newSection")
            }
            onClose={() => {
              onCloseCreateSection();
              setRenameSection(null);
            }}
            onSubmit={async (value) => {
              if (renameSection) {
                await updateSection(renameSection.id, { title: value });
              } else {
                await addSection(spaceId, value);
              }
            }}
          />
        )}

        {moveItem && (
          <MoveToSectionModal
            sections={activeSpaceSections}
            currentSectionId={moveItem.section_id ?? null}
            onClose={() => setMoveItem(null)}
            onSubmit={async (sectionId) => {
              const targetItems = sectionId
                ? (itemsBySection.get(sectionId) ?? [])
                : [];
              const sorts = targetItems.map((c) => c.sort_order);
              const sortOrder = sorts.length > 0 ? Math.max(...sorts) + 1 : 0;
              await updateSpaceContent(moveItem.id, { sectionId, sortOrder });
            }}
          />
        )}

        {textItemModal.open && (
          <TextItemModal
            onClose={() => setTextItemModal({ open: false, sectionId: null })}
            onSubmit={async (value) => {
              await addSpaceContent({
                spaceId,
                kind: "label",
                title: value,
                sectionId: textItemModal.sectionId,
              });
            }}
          />
        )}
      </div>
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {dnd.activeDragSection && (
            <div className="pointer-events-none flex items-center gap-2 rounded-control bg-surface-3 px-3 py-2 text-sm font-semibold text-text-primary shadow-page">
              <GripVertical
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
              <span className="max-w-[240px] truncate">
                {dnd.activeDragSection.title ||
                  t("spaces.coursePage.untitledSection")}
              </span>
            </div>
          )}
          {dnd.activeDragItem && (
            <div className="pointer-events-none flex items-center gap-2 rounded-control bg-surface-3 px-3 py-2 text-sm text-text-primary shadow-page">
              <GripVertical
                size={14}
                strokeWidth={1.5}
                className="shrink-0 text-text-muted"
              />
              <span className="max-w-[240px] truncate">
                {dnd.activeDragItem.title}
              </span>
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

/** One row inside a section card: a content item (link/file/label/…) or
 *  a legacy (pre-section) file. Owner-only affordances (drag handle,
 *  progress tick, kebab menu) are opt-in via props. */
function ItemRow({
  row,
  sectionId,
  owner,
  showProgress,
  completedContentIds,
  onToggleCompleted,
  busyLegacy,
  dragHandleProps,
  onOpenItemRow,
  onOpenLegacyFile,
  onDeleteLegacyFile,
  itemMenuEntries,
}: {
  row: RowItem;
  sectionId: string | null;
  owner: boolean;
  showProgress: boolean;
  completedContentIds: Set<string>;
  onToggleCompleted: (contentId: string) => void;
  busyLegacy: string | null;
  dragHandleProps?: HTMLAttributes<HTMLElement>;
  onOpenItemRow: (item: SpaceContent) => void;
  onOpenLegacyFile: (name: string) => void;
  onDeleteLegacyFile: (name: string) => void;
  itemMenuEntries: (
    sectionId: string | null,
    item: SpaceContent,
  ) => ContextMenuEntry[];
}) {
  const { t } = useTranslation();
  const dragHandle = dragHandleProps && (
    <span
      {...dragHandleProps}
      role="button"
      aria-label={t("spaces.coursePage.dnd.dragItem")}
      title={t("spaces.coursePage.dnd.dragItem")}
      className="shrink-0 cursor-grab touch-none text-text-muted-2 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
    >
      <GripVertical size={14} strokeWidth={1.5} />
    </span>
  );

  if (row.type === "legacy") {
    return (
      <div className="group flex h-10 items-center gap-2.5 px-3 text-sm transition-colors hover:bg-glass-hover">
        <FileUp
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-text-muted"
        />
        <button
          type="button"
          onClick={() => onOpenLegacyFile(row.file.name)}
          disabled={busyLegacy !== null}
          className="min-w-0 flex-1 cursor-pointer truncate text-left font-medium text-text-primary hover:underline underline-offset-2"
        >
          {row.file.name}
        </button>
        {busyLegacy === row.file.name && (
          <Loader2 size={14} className="animate-spin text-text-muted" />
        )}
        {owner && (
          <IconButton
            size="sm"
            variant="danger"
            onClick={() => onDeleteLegacyFile(row.file.name)}
            aria-label={t("common.delete")}
            title={t("common.delete")}
            className="opacity-0 group-hover:opacity-100"
          >
            <Trash2 size={14} strokeWidth={1.5} />
          </IconButton>
        )}
      </div>
    );
  }

  const item = row.content;
  if (item.kind === "label") {
    return (
      <div className="group flex items-center gap-2.5 px-3 py-2 text-sm">
        {dragHandle}
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-text-secondary">
          {item.title}
        </p>
      </div>
    );
  }

  const Icon = KIND_ICON[item.kind];
  const hint =
    item.kind === "file"
      ? (item.title.split(".").pop()?.toUpperCase() ?? "FILE")
      : null;
  const isCompleted = completedContentIds.has(item.id);

  return (
    <div className="group flex h-10 items-center gap-2.5 px-3 text-sm transition-colors hover:bg-glass-hover">
      {dragHandle}
      {showProgress && (
        <span onClick={(e) => e.stopPropagation()} className="shrink-0">
          <Checkbox
            checked={isCompleted}
            onChange={() => onToggleCompleted(item.id)}
            aria-label={t("spaces.coursePage.progress.toggle")}
          />
        </span>
      )}
      <Icon size={16} strokeWidth={1.5} className="shrink-0 text-text-muted" />
      <button
        type="button"
        onClick={() => onOpenItemRow(item)}
        className="flex min-w-0 flex-1 cursor-pointer flex-col items-start text-left"
      >
        <span
          className={cn(
            "w-full truncate font-medium",
            isCompleted ? "text-text-muted" : "text-text-primary",
          )}
        >
          {item.title}
        </span>
        {item.subtitle && (
          <span className="w-full truncate text-2xs text-text-muted">
            {item.subtitle}
          </span>
        )}
      </button>
      {hint && (
        <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-text-muted-2">
          {hint}
        </span>
      )}
      {item.url &&
        item.kind !== "file" &&
        isExternal(item.url) &&
        isSafeExternalUrl(item.url) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (isSafeExternalUrl(item.url!)) {
              window.open(item.url!, "_blank", "noopener,noreferrer");
            }
          }}
          className="shrink-0 cursor-pointer rounded-control p-1.5 text-text-muted transition-colors hover:bg-accent/10 hover:text-accent"
          aria-label={t("spaces.openSource")}
          title={t("spaces.openSource")}
        >
          <ExternalLink size={14} />
        </button>
      )}
      {owner && (
        <IconButton
          size="sm"
          onClick={(e) => openMenuAtButton(e, itemMenuEntries(sectionId, item))}
          aria-label={t("spaces.coursePage.itemActions")}
          className="opacity-0 group-hover:opacity-100"
        >
          <MoreHorizontal size={15} strokeWidth={1.5} />
        </IconButton>
      )}
    </div>
  );
}

/** One collapsible card: the implicit "General" group or a SpaceSection,
 *  its header (title, progress, kebab) and its item list. `renderRow`
 *  turns a row into an `ItemRow` without SectionCard needing to know
 *  that component's whole prop surface. */
function SectionCard({
  groupKey,
  anchorId,
  title,
  description,
  items,
  section,
  dragHandle,
  isOpen,
  onToggleOpen,
  progress,
  showProgress,
  owner,
  pendingNames,
  onSectionMenu,
  onAddMenu,
  renderRow,
}: {
  groupKey: string;
  anchorId: string;
  title: string;
  description?: string | null;
  items: RowItem[];
  section?: SpaceSection;
  dragHandle?: ReactNode;
  isOpen: boolean;
  onToggleOpen: () => void;
  progress: { done: number; total: number };
  showProgress: boolean;
  owner: boolean;
  pendingNames: string[];
  onSectionMenu?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onAddMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
  renderRow: (
    row: RowItem,
    sectionId: string | null,
    dragHandleProps?: HTMLAttributes<HTMLElement>,
  ) => ReactNode;
}) {
  const { t } = useTranslation();
  const contentItemIds = items
    .filter(
      (r): r is Extract<RowItem, { type: "content" }> => r.type === "content",
    )
    .map((r) => `item:${r.content.id}`);
  return (
    <div
      id={anchorId}
      style={{ scrollMarginTop: 76 }}
      className="overflow-hidden rounded-panel bg-bg-tertiary"
    >
      <div className="flex items-center gap-2 px-3 py-2.5">
        {dragHandle}
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
        >
          {isOpen ? (
            <ChevronDown size={15} className="shrink-0 text-text-muted" />
          ) : (
            <ChevronRight size={15} className="shrink-0 text-text-muted" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold text-text-primary">
              {title}
            </span>
            {description && (
              <span className="block truncate text-2xs text-text-muted">
                {description}
              </span>
            )}
          </span>
        </button>
        <span className="shrink-0 text-2xs tabular-nums text-text-muted">
          {showProgress && progress.total > 0
            ? `${progress.done}/${progress.total}`
            : t("spaces.coursePage.itemCount", { count: items.length })}
        </span>
        {owner && section && onSectionMenu && (
          <IconButton
            size="sm"
            onClick={onSectionMenu}
            aria-label={t("spaces.coursePage.sectionActions")}
          >
            <MoreHorizontal size={15} strokeWidth={1.5} />
          </IconButton>
        )}
      </div>
      {isOpen && (
        <div className="border-t border-surface-3/60">
          <SectionItemsDroppable groupKey={groupKey} disabled={!owner}>
            {items.length === 0 ? (
              <p className="px-3 py-4 text-xs text-text-muted">
                {t("spaces.coursePage.emptySection")}
              </p>
            ) : (
              <SortableContext
                items={contentItemIds}
                strategy={verticalListSortingStrategy}
              >
                <div className="divide-y divide-surface-3/60">
                  {items.map((row) =>
                    owner && row.type === "content" ? (
                      <DraggableItemRow
                        key={row.key}
                        contentId={row.content.id}
                      >
                        {({ dragHandleProps }) =>
                          renderRow(row, section?.id ?? null, dragHandleProps)
                        }
                      </DraggableItemRow>
                    ) : (
                      renderRow(row, section?.id ?? null)
                    ),
                  )}
                </div>
              </SortableContext>
            )}
          </SectionItemsDroppable>
          {pendingNames.map((name) => (
            <div
              key={name}
              className="flex h-10 items-center gap-2.5 border-t border-surface-3/60 px-3 text-sm"
            >
              <Loader2
                size={14}
                className="shrink-0 animate-spin text-text-muted"
              />
              <span className="min-w-0 flex-1 truncate text-text-muted">
                {name}
              </span>
            </div>
          ))}
          {owner && (
            <button
              type="button"
              onClick={onAddMenu}
              className="flex w-full cursor-pointer items-center gap-1.5 border-t border-surface-3/60 px-3 py-2 text-left text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
            >
              <Plus size={13} />
              {t("spaces.coursePage.addMaterial")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Drag source + drop target for one section card; wraps SectionCard's
 *  output so its transform/opacity react to the drag without touching the
 *  card layout itself. Render-prop hands the handle listeners back up. */
function DraggableSection({
  section,
  disabled,
  children,
}: {
  section: SpaceSection;
  disabled: boolean;
  children: (opts: {
    dragHandleProps: HTMLAttributes<HTMLElement>;
  }) => ReactNode;
}) {
  const sortable = useSortable({ id: `section:${section.id}`, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={sortable.isDragging ? "opacity-40" : undefined}
    >
      {children({
        dragHandleProps: {
          ...sortable.attributes,
          ...sortable.listeners,
        } as HTMLAttributes<HTMLElement>,
      })}
    </div>
  );
}

/** Drag source + drop target for one item row (content kind only). */
function DraggableItemRow({
  contentId,
  children,
}: {
  contentId: string;
  children: (opts: {
    dragHandleProps: HTMLAttributes<HTMLElement>;
  }) => ReactNode;
}) {
  const sortable = useSortable({ id: `item:${contentId}` });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={sortable.isDragging ? "opacity-40" : undefined}
    >
      {children({
        dragHandleProps: {
          ...sortable.attributes,
          ...sortable.listeners,
        } as HTMLAttributes<HTMLElement>,
      })}
    </div>
  );
}

/** Drop target for a section's item list, so an empty section can still
 *  receive a dragged item (its own rows have nothing to collide with). */
function SectionItemsDroppable({
  groupKey,
  disabled,
  children,
}: {
  groupKey: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const droppable = useDroppable({ id: `sect-items:${groupKey}`, disabled });
  return <div ref={droppable.setNodeRef}>{children}</div>;
}

function ChildSpaceRow({ space }: { space: Space }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const Icon =
    space.kind === "org" || space.kind === "subspace"
      ? Building2
      : GraduationCap;
  return (
    <button
      type="button"
      onClick={() => navigate(`/spaces/${space.id}`)}
      className="flex h-11 w-full cursor-pointer items-center gap-3 px-3 text-left transition-colors hover:bg-glass-hover"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-control bg-accent/10 text-accent">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
        {space.name}
      </span>
      <span className="shrink-0 font-mono text-2xs uppercase tracking-wide text-text-muted-2">
        {t(`spaces.kind.${space.kind}`, { defaultValue: space.kind })}
      </span>
    </button>
  );
}

function SectionFormModal({
  title,
  initialTitle,
  onClose,
  onSubmit,
}: {
  title: string;
  initialTitle: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialTitle);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={title}
      size="sm"
      onSubmit={() => void submit()}
      submitLabel={t("common.save")}
      submitting={saving}
      submitDisabled={!value.trim()}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        className="field"
        maxLength={200}
      />
    </FormModal>
  );
}

function MoveToSectionModal({
  sections,
  currentSectionId,
  onClose,
  onSubmit,
}: {
  sections: SpaceSection[];
  currentSectionId: string | null;
  onClose: () => void;
  onSubmit: (sectionId: string | null) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>(currentSectionId ?? GENERAL_KEY);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(value === GENERAL_KEY ? null : value);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={t("spaces.coursePage.moveToSection")}
      size="sm"
      onSubmit={() => void submit()}
      submitLabel={t("common.save")}
      submitting={saving}
    >
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        className="field cursor-pointer"
      >
        <option value={GENERAL_KEY}>{t("spaces.coursePage.general")}</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>
            {s.title || t("spaces.coursePage.untitledSection")}
          </option>
        ))}
      </select>
    </FormModal>
  );
}

function TextItemModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (value: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      await onSubmit(value.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormModal
      open
      onClose={onClose}
      title={t("spaces.coursePage.addText")}
      size="sm"
      onSubmit={() => void submit()}
      submitLabel={t("common.save")}
      submitting={saving}
      submitDisabled={!value.trim()}
    >
      <textarea
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={saving}
        className="field resize-none"
        maxLength={2000}
      />
    </FormModal>
  );
}
