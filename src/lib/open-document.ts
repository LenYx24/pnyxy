import type { NavigateFunction } from "react-router";
import { createAdapterForFile } from "@/features/reader/adapters";
import { useReaderStore } from "@/stores/reader-store";
import { useUIStore } from "@/stores/ui-store";
import { registerFile } from "@/lib/file-store";
import { saveLastOpenedBook, type LastOpenedBook } from "@/lib/last-opened-book";

export interface OpenDocumentOptions {
  file: File;
  navigate: NavigateFunction;
  /**
   * Where the user opened from (pathname + search), stored on the
   * reader route's state so its back arrow can return there. Omit for
   * plain local-file opens, which keep the default back behaviour.
   */
  openedFrom?: string;
  /** Remembered as the "last opened book" (home shelf, resume). */
  lastOpened?: LastOpenedBook;
  /**
   * Pre-assigned reader document id. When given, the file is only
   * registered under that id (the reader parses it on mount); when
   * omitted, the file is parsed here via the adapter pipeline and the
   * reader store assigns the id.
   */
  docId?: string;
  /** Skip the `/reader/:id` navigation (multi-file import). */
  shouldNavigate?: boolean;
}

/**
 * Shared "put a File into the reader" frame used by the three open
 * hooks (local file, uploaded book, catalog book). The hooks only differ
 * in how they obtain the File; everything from parsing to navigation
 * lives here. Loading messages are the ones the hooks always showed;
 * the caller owns setLoading(false) in its own finally block.
 */
export async function openDocumentFromFile({
  file,
  navigate,
  openedFrom,
  lastOpened,
  docId: presetId,
  shouldNavigate = true,
}: OpenDocumentOptions): Promise<string> {
  let docId = presetId;
  if (!docId) {
    const { setLoading } = useUIStore.getState();
    setLoading(true, "Loading document...");
    const adapter = createAdapterForFile(file);
    setLoading(true, "Extracting table of contents...");
    docId = await useReaderStore.getState().addDocument(adapter, file);
  }

  registerFile(docId, file);
  if (lastOpened) saveLastOpenedBook(lastOpened);

  if (shouldNavigate) {
    navigate(
      `/reader/${docId}`,
      openedFrom !== undefined ? { state: { from: openedFrom } } : undefined,
    );
  }
  return docId;
}
