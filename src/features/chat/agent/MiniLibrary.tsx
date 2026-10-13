import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Folder } from "lucide-react";
import { useLibraryStore } from "@/stores/library-store";
import { REF_ICONS, refHref, useFolderChildren, useFolderPath } from "./agent-items";

/** The items filed in one folder, each a link to its page. */
export function FolderItemList({ folderId, max }: { folderId: string; max?: number }) {
  const { t } = useTranslation();
  const children = useFolderChildren(folderId);
  if (children.length === 0) {
    return <p className="px-2 py-1.5 text-xs text-text-muted">{t("chat.agent.emptyFolder")}</p>;
  }
  const shown = max ? children.slice(0, max) : children;
  return (
    <ul>
      {shown.map((c) => {
        const Icon = REF_ICONS[c.k];
        const href = refHref(c);
        const row = (
          <>
            <Icon size={15} strokeWidth={1.5} className="shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1 truncate">{c.label}</span>
            <span className="shrink-0 text-2xs text-text-muted">{t(`chat.agent.kinds.${c.k}`)}</span>
          </>
        );
        const cls =
          "flex h-8 items-center gap-2 rounded-control px-2 text-sm text-text-primary";
        return (
          <li key={`${c.k}:${c.id}`}>
            {href ? (
              <Link to={href} className={`${cls} transition-colors hover:bg-surface-3`}>
                {row}
              </Link>
            ) : (
              <span className={cls}>{row}</span>
            )}
          </li>
        );
      })}
      {max && children.length > max && (
        <li className="px-2 pt-1 text-xs text-text-muted">
          {t("chat.agent.more", { count: children.length - max })}
        </li>
      )}
    </ul>
  );
}

/** One folder embedded under an agent reply, live as things move in. */
export function MiniLibrary({ folderId }: { folderId: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const path = useFolderPath(folderId);
  const navigateToFolder = useLibraryStore((s) => s.navigateToFolder);
  // a folder deleted since (e.g. undone) leaves nothing to show
  if (!path) return null;
  return (
    <div className="mt-3 rounded-panel bg-bg-secondary px-3 py-2.5">
      <div className="mb-1 flex items-center gap-2 px-1">
        <Folder size={15} strokeWidth={1.5} className="shrink-0 text-text-muted" />
        <span className="min-w-0 truncate text-sm font-medium text-text-primary">{path}</span>
        <button
          type="button"
          onClick={() => {
            navigateToFolder(folderId);
            navigate("/library");
          }}
          className="ml-auto shrink-0 cursor-pointer text-xs text-accent hover:underline"
        >
          {t("chat.agent.openInLibrary")}
        </button>
      </div>
      <FolderItemList folderId={folderId} />
    </div>
  );
}
