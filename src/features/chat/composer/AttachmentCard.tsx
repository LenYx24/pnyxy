import { useTranslation } from "react-i18next";
import { Image as ImageIcon, X } from "lucide-react";
import { Tooltip } from "@/components/ui";
import type { ChatMessageAttachment } from "@/types/chat";

/** Attached image as a plain thumbnail (the picture, not a name card);
 *  the filename only appears in a tooltip on hover, Gemini-style. */
export function AttachmentCard({
  attachment,
  onRemove,
}: {
  attachment: ChatMessageAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const dataUri = `data:${attachment.media_type};base64,${attachment.data}`;
  const card = (
    <div className="group relative h-16 shrink-0 overflow-hidden rounded-control bg-surface-3">
      {attachment.kind === "image" ? (
        <img
          src={dataUri}
          alt={attachment.name ?? "attachment"}
          className="h-full w-auto min-w-10 max-w-40 object-cover"
        />
      ) : (
        <div className="flex h-full w-16 items-center justify-center text-text-muted">
          <ImageIcon size={20} strokeWidth={1.5} />
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("chat.composer.attachments.remove")}
        className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition-opacity cursor-pointer group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/80"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  );
  return attachment.name ? (
    <Tooltip label={attachment.name} side="top">
      {card}
    </Tooltip>
  ) : (
    card
  );
}
