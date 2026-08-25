/**
 * Full-sheet conversation graph overlay (feature-gated "graph"), opened
 * from the sheet header kebab. Clicking a node opens that conversation and
 * closes the overlay.
 */
import { useTranslation } from "react-i18next";
import { Network, X } from "lucide-react";
import { IconButton } from "@/components/ui";
import { useChatStore } from "@/stores/chat-store";
import { ConversationGraph } from "../ConversationGraph";

interface ChatGraphOverlayProps {
  scopeDocId?: string;
  onClose: () => void;
}

export function ChatGraphOverlay({ scopeDocId, onClose }: ChatGraphOverlayProps) {
  const { t } = useTranslation();
  const openConversation = useChatStore((s) => s.openConversation);
  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-bg-secondary sm:rounded-page">
      <div className="flex items-center justify-between px-7 py-4">
        <span className="flex items-center gap-2 font-display text-base font-semibold text-text-primary">
          <Network size={20} strokeWidth={1.5} className="text-text-muted" />
          {t("chat.graph.title")}
        </span>
        <IconButton
          size="sm"
          onClick={onClose}
          aria-label={t("common.close")}
        >
          <X size={20} strokeWidth={1.5} />
        </IconButton>
      </div>
      <ConversationGraph
        className="min-h-0 flex-1"
        scopeDocId={scopeDocId}
        onOpen={(id) => {
          void openConversation(id);
          onClose();
        }}
      />
    </div>
  );
}
