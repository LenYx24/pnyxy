import { useTranslation } from "react-i18next";
import { WifiOff } from "lucide-react";
import { useIsOnline } from "@/stores/network-store";

/**
 * Slim app-wide banner that surfaces when the browser thinks the
 * network adapter is down OR the most recent best-effort server
 * heartbeat failed. Renders nothing when online — zero footprint
 * for the common case.
 *
 * Lives in AppLayout above the sidebar/content so it's visible on
 * every route. The sync queue surfaces individual pending mutations
 * inline at their use sites; this banner is the global "you're
 * working offline" cue.
 */
export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useIsOnline();
  if (online) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-40 flex items-center justify-center gap-2 border-b border-warning/30 bg-warning/15 backdrop-blur-md px-3 py-1.5 text-xs text-warning"
    >
      <WifiOff size={12} className="shrink-0" />
      <span className="text-center">
        {t("offline.banner", {
          defaultValue:
            "You're offline. Changes are saved locally and will sync when you're back online.",
        })}
      </span>
    </div>
  );
}
