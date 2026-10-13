import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Brush, Check, ExternalLink } from "lucide-react";
import type { AgentOffer } from "@/lib/ai/agent-blocks";
import { Button } from "@/components/ui/Button";
import { fieldClass } from "@/components/ui/classes";
import { useWhiteboardStore } from "@/stores/whiteboard-store";
import { useFolderPath } from "./agent-items";

/**
 * Action card ("akciókártya"): the agent prepared a whiteboard, the user
 * names it and creates it with Enter, then opens it here or in a new tab.
 */
export function AgentOfferCard({
  offer,
  disabled,
  onCreated,
}: {
  offer: AgentOffer;
  disabled: boolean;
  /** Records the created id on the message so a reload keeps the result. */
  onCreated: (next: AgentOffer) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(offer.title);
  const folderPath = useFolderPath(offer.folderId);
  const createWhiteboard = useWhiteboardStore((s) => s.createWhiteboard);
  const created = offer.createdId;

  if (offer.kind !== "whiteboard") return null;

  const create = () => {
    const title = name.trim() || offer.title;
    const id = createWhiteboard({ title, folderId: offer.folderId });
    onCreated({ ...offer, title, createdId: id });
  };

  return (
    <div className="mt-3 rounded-panel bg-bg-secondary px-4 py-3.5 outline outline-1 outline-accent/35">
      <div className="mb-2.5 flex items-center gap-2">
        <Brush size={16} strokeWidth={1.5} className="text-accent" />
        <span className="text-sm font-semibold text-text-primary">{t("chat.agent.offer.whiteboard")}</span>
      </div>
      {created ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success/15 text-success">
            <Check size={11} strokeWidth={3} />
          </span>
          <span className="text-sm text-text-primary">
            {t("chat.agent.offer.done")} <b>{offer.title}</b>
          </span>
          <span className="ml-auto flex gap-2">
            <Link
              to={`/whiteboards/${created}`}
              className="inline-flex items-center gap-1.5 rounded-control bg-text-primary px-3 py-1.5 text-xs font-semibold text-bg-primary hover:opacity-90"
            >
              {t("chat.agent.offer.openHere")}
            </Link>
            <a
              href={`/whiteboards/${created}`}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1.5 rounded-control bg-bg-tertiary px-3 py-1.5 text-xs text-text-primary hover:bg-surface-3"
            >
              <ExternalLink size={13} />
              {t("chat.agent.offer.openNewTab")}
            </a>
          </span>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <label htmlFor={`offer-${offer.title}`} className="mb-1.5 block text-xs text-text-muted">
            {t("chat.agent.offer.nameLabel")}
          </label>
          <div className="flex gap-2">
            <input
              id={`offer-${offer.title}`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={disabled}
              className={`${fieldClass} min-w-0 flex-1`}
            />
            <Button type="submit" size="sm" disabled={disabled}>
              {t("chat.agent.offer.create")}
            </Button>
          </div>
          <p className="mt-2 text-xs text-text-muted">
            {folderPath
              ? t("chat.agent.offer.into", { folder: folderPath })
              : t("chat.agent.offer.intoRoot")}
          </p>
        </form>
      )}
    </div>
  );
}
