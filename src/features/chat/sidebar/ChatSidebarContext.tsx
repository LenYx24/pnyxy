/**
 * Sidebar callbacks + inline-edit state shared with the tree rows, so
 * ChatTree / FolderRow / ConversationRow read them via `useChatSidebar()`
 * instead of a 25-prop chain. ChatSidebar builds the value; rows only get
 * data props (folders, conversations, active ids, collapsed set).
 */
import { createContext, useContext } from "react";

export interface ChatSidebarActions {
  /** Conversation whose title is being edited inline, if any. */
  editingId: string | null;
  editTitle: string;
  onOpen: (id: string) => void;
  onStartEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onSaveTitle: (id: string) => void;
  onEditTitleChange: (s: string) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  /** Open the folder-picker modal for this conversation (ChatSidebar owns it). */
  onRequestMove: (id: string, currentFolderId: string | null) => void;
  /** Archive (true) / restore (false) a conversation. */
  onArchive: (id: string, archived: boolean) => void;
  onToggleFolder: (id: string) => void;
  /** New conversation directly inside this folder. */
  onNewInFolder: (folderId: string) => void;
  /** New folder nested under this one. */
  onNewSubfolder: (parentFolderId: string) => void;
  /** Chat folders share the library `folders` table, so the id maps over. */
  onOpenFolderInLibrary: (folderId: string) => void;
  /** Right-click "Enter folder" -> drill into it (ChatSidebar owns the state). */
  onEnterFolder?: (id: string) => void;
  /** Folder modals live in ChatSidebar; rows just pass (id, name). */
  onRequestRenameFolder: (id: string, currentName: string) => void;
  onRequestDeleteFolder: (id: string, currentName: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

const ChatSidebarContext = createContext<ChatSidebarActions | null>(null);

export const ChatSidebarProvider = ChatSidebarContext.Provider;

export function useChatSidebar(): ChatSidebarActions {
  const ctx = useContext(ChatSidebarContext);
  if (!ctx) {
    throw new Error("useChatSidebar must be used inside <ChatSidebar>");
  }
  return ctx;
}
