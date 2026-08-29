import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Clapperboard, ExternalLink, Globe, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { detectResourceKind, normalizeUrl } from "@/lib/resource-url";
import { logError } from "@/lib/logger";
import { useChatStore } from "@/stores/chat-store";
import { useResourceStore } from "@/stores/resource-store";
import { showToast } from "@/stores/toast-store";
import type { ChatConversation } from "@/types/chat";

interface LinkOfferCardProps {
  conversation: ChatConversation;
  /** The user message the link was found in. */
  messageId: string;
  url: string;
  onDismiss: (messageId: string) => void;
}

/**
 * Inline offer under a user message that contains a link: one click
 * saves it as a library resource (YouTube → transcript + side-chat) and,
 * for videos, ties this conversation to it so the student continues
 * next to the player. Never automatic: pasting a link to just talk
 * about it stays a plain chat.
 */
export function LinkOfferCard({
  conversation,
  messageId,
  url,
  onDismiss,
}: LinkOfferCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const resources = useResourceStore((s) => s.resources);
  const createResource = useResourceStore((s) => s.createResource);
  const linkConversationToResource = useChatStore(
    (s) => s.linkConversationToResource,
  );
  const [saving, setSaving] = useState(false);

  const kind = detectResourceKind(url);
  const clean = normalizeUrl(url);
  const existing = useMemo(
    () => resources.find((r) => normalizeUrl(r.url) === clean) ?? null,
    [resources, clean],
  );

  const openResource = async (resourceId: string) => {
    if (kind === "youtube" && conversation.source_resource_id !== resourceId) {
      try {
        await linkConversationToResource(conversation.id, resourceId);
      } catch {
        // the viewer still opens; the thread just won't be attached
      }
    }
    navigate(`/resources/${resourceId}`);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (existing) {
        await openResource(existing.id);
        return;
      }
      const id = await createResource({ url: clean, folderId: conversation.folder_id });
      if (!id) throw new Error("no id");
      onDismiss(messageId);
      await openResource(id);
    } catch (err) {
      logError("chat:linkOffer:save", err);
      showToast(t("chat.linkOffer.failed"), "error");
    } finally {
      setSaving(false);
    }
  };

  const Icon = kind === "youtube" ? Clapperboard : Globe;
  return (
    <div className="ml-auto flex w-full max-w-[520px] items-start gap-3 rounded-panel border border-accent/25 bg-accent/5 px-3.5 py-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent/15 text-accent">
        <Icon size={16} strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">
          {kind === "youtube"
            ? t("chat.linkOffer.youtubeTitle")
            : t("chat.linkOffer.webTitle")}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          {kind === "youtube"
            ? t("chat.linkOffer.youtubeBody")
            : t("chat.linkOffer.webBody")}
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void handleSave()} disabled={saving} className="gap-1.5">
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : existing ? (
              <ExternalLink size={14} strokeWidth={1.5} />
            ) : (
              <Sparkles size={14} strokeWidth={1.5} />
            )}
            {saving
              ? t("chat.linkOffer.saving")
              : existing
                ? t("chat.linkOffer.open")
                : kind === "youtube"
                  ? t("chat.linkOffer.save")
                  : t("chat.linkOffer.saveWeb")}
          </Button>
          <button
            type="button"
            onClick={() => onDismiss(messageId)}
            className="text-xs text-text-muted underline-offset-2 hover:text-text-primary hover:underline cursor-pointer"
          >
            {t("chat.linkOffer.dismiss")}
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onDismiss(messageId)}
        aria-label={t("chat.linkOffer.dismiss")}
        className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-3 hover:text-text-primary cursor-pointer"
      >
        <X size={14} />
      </button>
    </div>
  );
}
