import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Brush, FolderPlus, MessageSquare, Plus, StickyNote } from "lucide-react";
import { useFeatures } from "@/lib/use-features";
import { useChatStore } from "@/stores/chat-store";
import { useNoteStore } from "@/stores/note-store";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import type { ContextMenuEntry, ContextMenuItem } from "@/stores/context-menu-store";

/**
 * "New in this folder" submenu for a folder's right-click menu: note,
 * whiteboard, chat and (when the host can prompt for a name) subfolder,
 * each created inside that folder and opened right away.
 */
export function useCreateInFolderEntry(
  onCreateSubfolder?: (parentFolderId: string) => void,
): (folderId: string) => ContextMenuItem {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const features = useFeatures();
  return (folderId) => {
    const children: ContextMenuEntry[] = [
      ...(features.notes
        ? [
            {
              id: "in-note",
              label: t("library.create.note"),
              icon: StickyNote,
              onClick: () => navigate(`/notes/${useNoteStore.getState().createNote(folderId)}`),
            },
          ]
        : []),
      ...(features.whiteboard
        ? [
            {
              id: "in-whiteboard",
              label: t("library.create.whiteboard"),
              icon: Brush,
              accent: true,
              onClick: () =>
                navigate(`/whiteboards/${useWhiteboardStore.getState().createWhiteboard({ folderId })}`),
            },
          ]
        : []),
      {
        id: "in-chat",
        label: t("library.create.chat"),
        icon: MessageSquare,
        onClick: async () => {
          await useChatStore.getState().createConversation(undefined, folderId);
          navigate("/chat");
        },
      },
      ...(onCreateSubfolder
        ? [
            {
              id: "in-subfolder",
              label: t("library.folderCard.newSubfolder"),
              icon: FolderPlus,
              onClick: () => onCreateSubfolder(folderId),
            },
          ]
        : []),
    ];
    return {
      id: "new-in-folder",
      label: t("library.folderCard.newInFolder"),
      icon: Plus,
      onClick: () => {},
      children,
    };
  };
}
