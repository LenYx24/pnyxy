/**
 * "Available from this course" placeholders for a library folder that mirrors
 * a course (folders.source_space_id, migration 00078). Lists the course's
 * files (space_content kind="file") for this folder's section that the member
 * hasn't copied into their library yet, so the folder shows the whole course
 * even before anything is downloaded. Clicking a placeholder runs the same
 * copy-on-open path as the course page (openSpaceFile).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useLibraryStore } from "@/stores/library-store";
import type { Folder } from "@/types/database";

export interface CoursePlaceholder {
  /** Storage file name within the space bucket; what openSpaceFile expects. */
  name: string;
  /** Display label (the course item title, falling back to the file name). */
  title: string;
}

/** Strip the `<spaceId>/` prefix a stored space-file url carries. */
function fileNameOf(url: string, spaceId: string): string {
  const prefix = `${spaceId}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : url;
}

function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

export function useCoursePlaceholders(folder: Folder | null): {
  placeholders: CoursePlaceholder[];
  loading: boolean;
} {
  const spaceId = folder?.source_space_id ?? null;
  const sectionId = folder?.source_section_id ?? null;
  const folderId = folder?.id ?? null;

  const [files, setFiles] = useState<CoursePlaceholder[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!spaceId) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      let query = supabase
        .from("space_content")
        .select("url, title, section_id")
        .eq("space_id", spaceId)
        .eq("kind", "file");
      // Root course folder mirrors the General group (section_id null); a
      // subfolder mirrors exactly its section.
      query = sectionId
        ? query.eq("section_id", sectionId)
        : query.is("section_id", null);
      const { data, error } = await query;
      if (cancelled) return;
      if (error) {
        logError("library:coursePlaceholders", error.message);
        setFiles([]);
        setLoading(false);
        return;
      }
      const list: CoursePlaceholder[] = (data ?? [])
        .filter((r) => typeof r.url === "string" && r.url.length > 0)
        .map((r) => {
          const name = fileNameOf(r.url as string, spaceId);
          return { name, title: (r.title as string | null)?.trim() || name };
        });
      setFiles(list);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [spaceId, sectionId]);

  // Select the stable books array (never a fresh object) so this hook doesn't
  // spin: the copied-name set is derived with useMemo instead.
  const books = useLibraryStore((s) => s.books);

  const placeholders = useMemo(() => {
    if (!spaceId || !folderId) return [];
    // A course file is "already here" when a copy of it sits in THIS folder
    // (openSpaceFile copies into the section folder and tags source_space_id).
    const copied = new Set<string>();
    for (const item of books) {
      if (item.source !== "uploaded") continue;
      if (item.folder_id !== folderId) continue;
      if (item.book.source_space_id !== spaceId) continue;
      if (item.book.file_name) copied.add(item.book.file_name);
      if (item.book.title) copied.add(item.book.title);
    }
    return files.filter(
      (f) =>
        !copied.has(f.name) &&
        !copied.has(stripExt(f.name)) &&
        !copied.has(f.title),
    );
  }, [files, books, spaceId, folderId]);

  return { placeholders, loading };
}
