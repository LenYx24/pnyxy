/**
 * "Available from this course" strip, shown at the top of a library folder
 * that mirrors a course (folders.source_space_id). Lists the course files the
 * member hasn't copied yet as click-to-add placeholders, so the folder shows
 * the whole course even before anything is downloaded. Clicking runs the same
 * copy-on-open path as the course page (openSpaceFile: download, copy into
 * this folder tagged with the course, open the reader).
 */
import { useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { FileDown, GraduationCap, Loader2 } from "lucide-react";
import { useLibraryStore } from "@/stores/library-store";
import { openSpaceFile } from "@/features/spaces/space-files";
import { showToast } from "@/stores/toast-store";
import { useCoursePlaceholders } from "./useCoursePlaceholders";

export function CourseAvailableStrip({
  currentFolderId,
}: {
  currentFolderId: string | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const folder = useLibraryStore((s) =>
    currentFolderId ? (s.folders.find((f) => f.id === currentFolderId) ?? null) : null,
  );
  const { placeholders } = useCoursePlaceholders(folder);
  const [busy, setBusy] = useState<string | null>(null);

  const spaceId = folder?.source_space_id ?? null;
  if (!spaceId || placeholders.length === 0) return null;

  const add = async (name: string) => {
    if (busy) return;
    setBusy(name);
    try {
      await openSpaceFile(spaceId, name, navigate, { folderId: currentFolderId });
    } catch {
      showToast(t("library.course.addFailed"), "error");
      setBusy(null);
    }
    // success navigates to the reader; no need to clear busy (unmounts)
  };

  return (
    <section className="mb-4 rounded-lg border border-border-subtle bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
        <GraduationCap size={14} className="text-accent" />
        {t("library.course.availableTitle", { count: placeholders.length })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {placeholders.map((p) => {
          const isBusy = busy === p.name;
          return (
            <button
              key={p.name}
              type="button"
              disabled={busy !== null}
              onClick={() => void add(p.name)}
              title={t("library.course.addFileHint", { name: p.title })}
              className="flex max-w-full items-center gap-1.5 rounded-md border border-border-subtle bg-bg-primary px-2.5 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary disabled:cursor-default disabled:opacity-60 cursor-pointer"
            >
              {isBusy ? (
                <Loader2 size={13} className="shrink-0 animate-spin" />
              ) : (
                <FileDown size={13} className="shrink-0 text-text-muted" />
              )}
              <span className="truncate">{p.title}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
