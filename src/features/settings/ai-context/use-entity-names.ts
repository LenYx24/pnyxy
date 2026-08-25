import { useEffect, useMemo } from "react";
import { useLibraryStore } from "@/stores/library-store";
import { useOrgStore } from "@/stores/org-store";
import { bookBindingKey, bookDisplayTitle } from "./library-keys";
import type { AiContextBindingKind } from "./types";

export interface BindableEntity {
  kind: AiContextBindingKind;
  id: string;
  name: string;
  /** Secondary line: author / parent folder. */
  detail?: string;
}

/**
 * Books, folders and orgs as flat pick-lists, plus a name lookup for the
 * binding chips. Triggers the (cached) fetches so the Settings page works
 * without visiting the Library first.
 */
export function useBindableEntities() {
  const books = useLibraryStore((s) => s.books);
  const folders = useLibraryStore((s) => s.folders);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const fetchFolders = useLibraryStore((s) => s.fetchFolders);
  const organizations = useOrgStore((s) => s.organizations);
  const fetchMine = useOrgStore((s) => s.fetchMine);

  useEffect(() => {
    void fetchLibrary();
    void fetchFolders();
    if (organizations.length === 0) void fetchMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entities = useMemo<Record<AiContextBindingKind, BindableEntity[]>>(() => {
    const folderName = new Map(folders.map((f) => [f.id, f.name]));
    return {
      books: books.map((b) => ({
        kind: "books",
        id: bookBindingKey(b),
        name: bookDisplayTitle(b),
        detail: b.folder_id ? folderName.get(b.folder_id) : undefined,
      })),
      folders: folders.map((f) => ({
        kind: "folders",
        id: f.id,
        name: f.name,
        detail: f.parent_id ? folderName.get(f.parent_id) : undefined,
      })),
      orgs: organizations.map((o) => ({ kind: "orgs", id: o.id, name: o.name })),
    };
  }, [books, folders, organizations]);

  const nameOf = useMemo(() => {
    const maps: Record<AiContextBindingKind, Map<string, string>> = {
      books: new Map(entities.books.map((e) => [e.id, e.name])),
      folders: new Map(entities.folders.map((e) => [e.id, e.name])),
      orgs: new Map(entities.orgs.map((e) => [e.id, e.name])),
    };
    return (kind: AiContextBindingKind, id: string) => maps[kind].get(id) ?? null;
  }, [entities]);

  return { entities, nameOf };
}
