import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  BookOpen,
  Brush,
  Folder,
  Globe,
  MessageSquare,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import type { AgentRef, AgentRefKind, AgentUndo } from "@/lib/ai/agent-blocks";
import {
  conversationDisplayTitle,
  noteDisplayTitle,
  whiteboardDisplayTitle,
} from "@/lib/entity-title";
import { bookIdSegment } from "@/lib/slugify";
import { useChatStore } from "@/stores/chat-store";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore } from "@/stores/note-store";
import { useResourceStore } from "@/stores/resource-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";

export const REF_ICONS: Record<AgentRefKind, LucideIcon> = {
  folder: Folder,
  book: BookOpen,
  chat: MessageSquare,
  note: StickyNote,
  resource: Globe,
  whiteboard: Brush,
  url: Globe,
};

/** In-app route for a library item; null when it has no page of its own. */
export function refHref(ref: Pick<AgentRef, "k" | "id">): string | null {
  switch (ref.k) {
    case "folder":
      return `/library?folder=${encodeURIComponent(ref.id)}`;
    case "chat":
      return `/chat/${ref.id}`;
    case "note":
      return `/notes/${ref.id}`;
    case "whiteboard":
      return `/whiteboards/${ref.id}`;
    case "book": {
      const entry = useLibraryStore.getState().books.find((b) => b.id === ref.id);
      if (!entry) return null;
      return entry.source === "catalog"
        ? `/books/${bookIdSegment(entry.catalog_book_id, entry.catalog_book.title)}`
        : `/books/${bookIdSegment(entry.book.id, entry.book.title)}`;
    }
    case "url":
      return /^https?:\/\//i.test(ref.id) ? ref.id : null;
    default:
      return null;
  }
}

export interface FolderChild {
  k: AgentRefKind;
  id: string;
  label: string;
}

function collectChildren(folderId: string, t: TFunction): FolderChild[] {
  const lib = useLibraryStore.getState();
  const out: FolderChild[] = [];
  for (const f of lib.folders) {
    if (f.parent_id === folderId) out.push({ k: "folder", id: f.id, label: f.name });
  }
  for (const b of lib.books) {
    if (b.folder_id !== folderId) continue;
    out.push({
      k: "book",
      id: b.id,
      label: b.source === "uploaded" ? b.book.title : b.catalog_book.title,
    });
  }
  for (const n of useNoteStore.getState().notes) {
    if (n.folderId === folderId) out.push({ k: "note", id: n.id, label: noteDisplayTitle(n, t) });
  }
  for (const w of useWhiteboardStore.getState().whiteboards) {
    if ((w.folderId ?? null) === folderId) {
      out.push({ k: "whiteboard", id: w.id, label: whiteboardDisplayTitle(w, t) });
    }
  }
  for (const c of useChatStore.getState().conversations) {
    if (c.folder_id === folderId && !c.archived_at) {
      out.push({ k: "chat", id: c.id, label: conversationDisplayTitle(c, t) });
    }
  }
  for (const r of useResourceStore.getState().resources) {
    if (r.folder_id === folderId) out.push({ k: "resource", id: r.id, label: r.title || r.url });
  }
  return out;
}

let itemsLoad: Promise<unknown> | null = null;
/** The chat page doesn't load notes, boards or links on its own; the
 *  folder views here need them, once per session. */
export function ensureFolderItemsLoaded(): Promise<unknown> {
  itemsLoad ??= Promise.allSettled([
    useNoteStore.getState().loadNotes(),
    useWhiteboardStore.getState().loadWhiteboards(),
    useResourceStore.getState().fetchResources(),
  ]);
  return itemsLoad;
}

/** Live contents of one folder across every store that files into it. */
export function useFolderChildren(folderId: string | null): FolderChild[] {
  const { t } = useTranslation();
  // subscribe to each source so the list follows moves and creations
  const folders = useLibraryStore((s) => s.folders);
  const books = useLibraryStore((s) => s.books);
  const notes = useNoteStore((s) => s.notes);
  const boards = useWhiteboardStore((s) => s.whiteboards);
  const chats = useChatStore((s) => s.conversations);
  const resources = useResourceStore((s) => s.resources);
  useEffect(() => {
    if (folderId) void ensureFolderItemsLoaded();
  }, [folderId]);
  return useMemo(
    () => (folderId ? collectChildren(folderId, t) : []),
    // the store slices are the real inputs; collectChildren reads them via getState
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [folderId, t, folders, books, notes, boards, chats, resources],
  );
}

/** "Parent / Child" path of a folder, for headers. */
export function useFolderPath(folderId: string | null): string | null {
  const folders = useLibraryStore((s) => s.folders);
  return useMemo(() => {
    if (!folderId) return null;
    const byId = new Map(folders.map((f) => [f.id, f]));
    const parts: string[] = [];
    let cur = byId.get(folderId);
    for (let i = 0; cur && i < 64; i++) {
      parts.unshift(cur.name);
      cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
    }
    return parts.length ? parts.join(" / ") : null;
  }, [folderId, folders]);
}

/** Reverses one activity-log step. Returns false when it can't. */
export async function performUndo(undo: AgentUndo): Promise<boolean> {
  const lib = useLibraryStore.getState();
  if (undo.op === "delete_folder") {
    const hasChildren =
      lib.folders.some((f) => f.parent_id === undo.id) ||
      lib.books.some((b) => b.folder_id === undo.id) ||
      useNoteStore.getState().notes.some((n) => n.folderId === undo.id) ||
      useWhiteboardStore.getState().whiteboards.some((w) => w.folderId === undo.id) ||
      useChatStore.getState().conversations.some((c) => c.folder_id === undo.id) ||
      useResourceStore.getState().resources.some((r) => r.folder_id === undo.id);
    // never delete what the user has filed there since
    if (hasChildren) return false;
    await lib.deleteFolder(undo.id);
    return true;
  }
  switch (undo.kind) {
    case "book": {
      const entry = lib.books.find((b) => b.id === undo.id);
      if (!entry) return false;
      await lib.moveBookToFolder(entry, undo.to);
      return true;
    }
    case "chat":
      await useChatStore.getState().moveConversationToFolder(undo.id, undo.to);
      return true;
    case "note":
      useNoteStore.getState().moveNoteToFolder(undo.id, undo.to);
      return true;
    case "resource":
      await useResourceStore.getState().moveResourceToFolder(undo.id, undo.to);
      return true;
    case "folder":
      await lib.moveFolderToFolder(undo.id, undo.to);
      return true;
    default:
      return false;
  }
}
