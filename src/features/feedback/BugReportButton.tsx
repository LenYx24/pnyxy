import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";
import { Bug } from "lucide-react";
import { Button, FormModal } from "@/components/ui";
import { reportClientError, getRecentClientErrors } from "@/lib/error-report";
import { showToast } from "@/stores/toast-store";

/**
 * One-click "report a problem": a small modal with an optional "what
 * happened?" textarea. Submitting auto-attaches the current route,
 * user agent (added by reportClientError itself), and the last few
 * errors this session already auto-captured, as a `report`-kind row
 * in client_errors. Always sent regardless of the research-consent
 * gate that auto-captured crashes respect, the user explicitly asked
 * for this one (see error-report.ts).
 */
export function BugReportButton() {
  const { t } = useTranslation();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setBody("");
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    await reportClientError({
      kind: "report",
      message: body.trim() || t("bugReport.noDescription"),
      route: location.pathname,
      context: { recentErrors: getRecentClientErrors() },
    });
    setSubmitting(false);
    setOpen(false);
    setBody("");
    showToast(t("bugReport.sent"), "success");
  };

  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Bug size={14} />
        {t("bugReport.trigger")}
      </Button>

      <FormModal
        open={open}
        onClose={close}
        title={t("bugReport.modalTitle")}
        icon={Bug}
        size="sm"
        onSubmit={() => void handleSubmit()}
        submitLabel={t("bugReport.send")}
        submitting={submitting}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="bug-report-body"
            className="block text-[13px] font-medium text-text-secondary"
          >
            {t("bugReport.bodyLabel")}
          </label>
          <textarea
            id="bug-report-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("bugReport.bodyPlaceholder")}
            rows={4}
            maxLength={2000}
            disabled={submitting}
            className="field w-full resize-y bg-bg-secondary"
          />
        </div>
        <p className="text-2xs text-text-muted">{t("bugReport.autoCaptureNote")}</p>
      </FormModal>
    </>
  );
}
