import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { TutorNudge } from "@/stores/tutor-nudge-store";

/** The proactive tutor's offer above the reader composer: one line of text
 *  and two choices. Nothing is sent to the model until "Yes". */
export function TutorNudgeCard({
  nudge,
  onAccept,
  onDecline,
}: {
  nudge: TutorNudge;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { t } = useTranslation();
  const message =
    nudge.kind === "stuck"
      ? t("reader.aiChat.nudge.stuck", { page: nudge.page })
      : t("reader.aiChat.nudge.resume", { page: nudge.page });

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-panel bg-bg-secondary px-3 py-2.5"
    >
      <div className="flex items-start gap-2 text-[13px] leading-snug text-text-secondary">
        <Sparkles size={14} strokeWidth={1.5} className="mt-0.5 shrink-0 text-text-muted" />
        <span>{message}</span>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onDecline}>
          {t("reader.aiChat.nudge.notNow")}
        </Button>
        <Button variant="secondary" size="sm" onClick={onAccept}>
          {t("reader.aiChat.nudge.yes")}
        </Button>
      </div>
    </div>
  );
}
