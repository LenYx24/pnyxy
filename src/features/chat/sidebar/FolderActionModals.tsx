/**
 * The three folder modals (create / rename / delete), one open at a time,
 * dispatched by `action.kind`. ChatSidebar owns the `action` state; tree
 * rows and the toolbar only request an action.
 */
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ConfirmModal, PromptModal } from "@/components/ui";
import { useChatStore } from "@/stores/chat-store";

export type FolderAction =
  // parentId null = root folder
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "delete"; id: string; name: string };

interface FolderActionModalsProps {
  action: FolderAction | null;
  onClose: () => void;
}

export function FolderActionModals({ action, onClose }: FolderActionModalsProps) {
  const { t } = useTranslation();
  const { createFolder, renameFolder, deleteFolder } = useChatStore(
    useShallow((s) => ({
      createFolder: s.createFolder,
      renameFolder: s.renameFolder,
      deleteFolder: s.deleteFolder,
    })),
  );

  return (
    <>
      <PromptModal
        open={action?.kind === "create"}
        title={t("chat.folders.create")}
        placeholder={t("chat.folders.namePrompt")}
        onClose={onClose}
        onSubmit={(name) => {
          void createFolder(
            name,
            action?.kind === "create" ? action.parentId : null,
          );
        }}
      />
      <PromptModal
        open={action?.kind === "rename"}
        title={t("chat.folders.rename")}
        defaultValue={action?.kind === "rename" ? action.name : ""}
        placeholder={t("chat.folders.namePrompt")}
        onClose={onClose}
        onSubmit={(name) => {
          if (action?.kind === "rename") {
            void renameFolder(action.id, name);
          }
        }}
      />
      <ConfirmModal
        open={action?.kind === "delete"}
        title={t("chat.folders.delete")}
        body={
          action?.kind === "delete"
            ? t("chat.folders.deleteConfirm", { name: action.name })
            : ""
        }
        confirmLabel={t("common.delete")}
        danger
        onClose={onClose}
        onConfirm={() => {
          if (action?.kind === "delete") {
            void deleteFolder(action.id);
          }
        }}
      />
    </>
  );
}
