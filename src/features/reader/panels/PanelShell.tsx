import { useTranslation } from "react-i18next";
import { BotMessageSquare, X } from "lucide-react";

/**
 * Lightweight wrapper around the AI chat panel content with a small
 * "AI chat" header + close button. Used both inside the dockview
 * desktop panel and the mobile slide-over so the empty state stays
 * recognisable and lets the user dismiss it on mobile even before
 * they have a working chat to show.
 */
export function PanelShell({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      {onClose && (
        <div className="flex items-center justify-between py-1 pl-3 pr-1">
          <div className="flex items-center gap-2">
            <BotMessageSquare size={16} strokeWidth={1.5} className="text-text-muted" />
            <span className="text-sm font-medium text-text-primary">
              {t("reader.aiChat.title")}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-bg-secondary hover:text-text-primary cursor-pointer"
            aria-label={t("reader.aiChat.closeAria")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
