import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  MoreVertical,
  FolderInput,
  Trash2,
  Globe,
  Video,
  ExternalLink,
} from "lucide-react";
import { Checkbox, FloatingMenu } from "@/components/ui";
import { useContextMenu } from "@/hooks/use-context-menu";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { cn } from "@/lib/cn";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import { useResourceStore } from "@/stores/resource-store";
import { displayHost } from "@/lib/resource-url";
import type { Resource } from "@/types/resource";
import { FolderPickerModal } from "./modals/FolderPickerModal";

interface LibraryResourceCardProps {
  resource: Resource;
  sortableId?: string;
  coverHeight?: number;
  selected?: boolean;
  selectionActive?: boolean;
  onToggleSelect?: (
    id: string,
    event: { ctrlKey: boolean; shiftKey: boolean },
  ) => void;
}

/**
 * Grid card for a saved web page / YouTube link (beta). Opens the resource
 * viewer at /resources/:id. Mirrors LibraryChatCard's layout + DnD wiring.
 */
export function LibraryResourceCard({
  resource,
  sortableId,
  coverHeight = 120,
  selected = false,
  selectionActive = false,
  onToggleSelect,
}: LibraryResourceCardProps) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const folders = useLibraryStore((s) => s.folders);
  const moveResourceToFolder = useResourceStore((s) => s.moveResourceToFolder);
  const deleteResource = useResourceStore((s) => s.deleteResource);

  const sortable = useSortable({
    id: sortableId ?? resource.id,
    disabled: !sortableId,
  });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    sortable;
  const style = sortableId
    ? { transform: CSS.Transform.toString(transform), transition }
    : undefined;

  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const isYoutube = resource.kind === "youtube";
  const Icon = isYoutube ? Video : Globe;
  const title = resource.title || displayHost(resource.url);
  const subtitle = displayHost(resource.url);
  const kindLabel = isYoutube
    ? t("library.resource.kindYoutube", { defaultValue: "YouTube" })
    : t("library.resource.kindWeb", { defaultValue: "Web" });
  const selKey = `resource:${resource.id}`;
  const compact = coverHeight < 100;
  const intrinsicHeight = coverHeight + 80;
  const showThumb = isYoutube && !!resource.thumbnail_url;

  const open = () => {
    navigate(`/resources/${resource.id}`);
  };

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    open();
  };

  const contextHandlers = useContextMenu((): ContextMenuEntry[] => [
    {
      id: "open",
      label: t("library.resource.open", { defaultValue: "Open resource" }),
      icon: ExternalLink,
      onClick: () => open(),
    },
    {
      id: "move",
      label: t("library.actions.moveToFolder"),
      icon: FolderInput,
      onClick: () => setMoveOpen(true),
    },
    { id: "div-1", divider: true },
    {
      id: "delete",
      label: t("common.delete"),
      icon: Trash2,
      danger: true,
      onClick: () =>
        void deleteResource(resource.id).catch((err) =>
          logError("library:deleteResource", err),
        ),
    },
  ]);

  return (
    <div
      ref={setNodeRef}
      style={{
        ...style,
        contentVisibility: "auto",
        containIntrinsicSize: `auto ${intrinsicHeight}px`,
      }}
      {...attributes}
      {...listeners}
    >
      <div
        {...contextHandlers}
        className={cn(
          "group relative",
          selected && "ring-2 ring-accent rounded-md",
          isDragging && "opacity-50",
        )}
      >
        <div onClick={handleClick} title={title} className="cursor-pointer">
          <div className="relative flex aspect-[5/7] w-full items-center justify-center overflow-hidden rounded-md border border-glass-border bg-accent-blue/10 shadow-sm transition-shadow group-hover:shadow-md">
            {showThumb ? (
              <img
                src={resource.thumbnail_url!}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <Icon
                size={Math.round(Math.min(Math.max(coverHeight * 0.32, 24), 48))}
                className="text-accent-blue/80"
              />
            )}

            {onToggleSelect && (
              <div
                className={cn(
                  "absolute left-1.5 top-1.5 z-10 transition-opacity",
                  selectionActive || selected
                    ? "opacity-100"
                    : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  checked={selected}
                  onChange={() =>
                    onToggleSelect(selKey, { ctrlKey: false, shiftKey: false })
                  }
                />
              </div>
            )}

            {/* kind + beta badges */}
            <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1">
              <span
                className="flex items-center gap-0.5 rounded bg-bg-primary/80 px-1 py-0.5 text-2xs font-semibold text-accent-blue backdrop-blur-sm"
                title={kindLabel}
              >
                <Icon size={10} />
                {kindLabel}
              </span>
              <span className="rounded bg-bg-primary/80 px-1 py-0.5 text-2xs font-medium uppercase tracking-wide text-text-muted backdrop-blur-sm">
                {t("library.resource.beta", { defaultValue: "Beta" })}
              </span>
            </span>
          </div>

          <div className={cn("mt-2 min-w-0", compact && "mt-1.5")}>
            <h3
              className={cn(
                "truncate font-semibold leading-tight text-text-primary",
                compact ? "text-xs" : "text-sm",
              )}
            >
              {title}
            </h3>
            <p
              className={cn(
                "truncate leading-tight text-text-muted",
                compact ? "text-2xs" : "text-xs",
              )}
            >
              {subtitle}
            </p>
          </div>
        </div>

        <div className="absolute right-1.5 top-1.5">
          <button
            ref={triggerRef}
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className={cn(
              "rounded-lg p-1.5 transition-colors cursor-pointer",
              "bg-black/40 text-white/70 hover:bg-black/60 hover:text-white",
              menuOpen
                ? "opacity-100"
                : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
            )}
          >
            <MoreVertical size={16} />
          </button>

          <FloatingMenu
            open={menuOpen}
            anchorRef={triggerRef}
            onClose={() => setMenuOpen(false)}
            className="w-48"
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                open();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <ExternalLink size={14} />
              {t("library.resource.open", { defaultValue: "Open resource" })}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setMoveOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
            >
              <FolderInput size={14} />
              {t("library.actions.moveToFolder")}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                void deleteResource(resource.id).catch((err) =>
                  logError("library:deleteResource", err),
                );
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-glass-hover cursor-pointer"
            >
              <Trash2 size={14} />
              {t("common.delete")}
            </button>
          </FloatingMenu>
        </div>
      </div>

      <FolderPickerModal
        open={moveOpen}
        folders={folders}
        currentFolderId={resource.folder_id}
        onClose={() => setMoveOpen(false)}
        onSelect={(folderId) => {
          void moveResourceToFolder(resource.id, folderId);
          setMoveOpen(false);
        }}
      />
    </div>
  );
}
