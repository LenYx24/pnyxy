import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Mail, MessageSquarePlus, Send, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";

const FEEDBACK_EMAIL = "feedback@pnyxy.com";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

export function FeedbackTab() {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const canSend =
    subject.trim().length > 0 &&
    body.trim().length > 0 &&
    status.kind !== "sending";

  async function handleSend() {
    if (!canSend) return;
    setStatus({ kind: "sending" });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-feedback`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
      });

      if (!res.ok) {
        // Read as text first, a 401/403 from the edge often comes
        // back as plain text, and `res.json()` would have thrown a
        // SyntaxError that hid the real reason ("Invalid JWT" /
        // "Service not enabled" / etc.).
        const bodyText = await res.text().catch(() => "");
        type ErrorPayload = { error?: { message?: string } };
        let parsed: ErrorPayload | null = null;
        try {
          parsed = bodyText
            ? (JSON.parse(bodyText) as ErrorPayload)
            : null;
        } catch {
          parsed = null;
        }
        const msg =
          parsed?.error?.message ||
          bodyText.slice(0, 200) ||
          t("settings.feedbackSection.errorGeneric");
        throw new Error(msg);
      }

      setStatus({ kind: "sent" });
      setSubject("");
      setBody("");
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : t("settings.feedbackSection.errorGeneric"),
      });
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.feedbackSection.heading")}
        </h2>
        <p className="text-sm text-text-muted">
          {t("settings.feedbackSection.description")}
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <MessageSquarePlus size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-primary">
              {t("settings.feedbackSection.formLabel")}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-text-muted">
              <Mail size={12} />
              {t("settings.feedbackSection.deliversTo", {
                email: FEEDBACK_EMAIL,
              })}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="feedback-subject"
            className="block text-xs font-medium text-text-secondary"
          >
            {t("settings.feedbackSection.subjectLabel")}
          </label>
          <input
            id="feedback-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("settings.feedbackSection.subjectPlaceholder")}
            maxLength={200}
            disabled={status.kind === "sending"}
            className="w-full rounded-lg border border-glass-border bg-bg-secondary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="feedback-body"
            className="block text-xs font-medium text-text-secondary"
          >
            {t("settings.feedbackSection.bodyLabel")}
          </label>
          <textarea
            id="feedback-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("settings.feedbackSection.bodyPlaceholder")}
            rows={7}
            maxLength={10000}
            disabled={status.kind === "sending"}
            className="w-full resize-y rounded-lg border border-glass-border bg-bg-secondary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent disabled:opacity-60"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="min-w-0 flex-1 text-xs">
            {status.kind === "sent" && (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 size={14} />
                {t("settings.feedbackSection.sent")}
              </span>
            )}
            {status.kind === "error" && (
              <span className="inline-flex items-center gap-1.5 text-danger">
                <AlertCircle size={14} />
                {status.message}
              </span>
            )}
          </div>
          <Button
            variant="primary"
            onClick={handleSend}
            disabled={!canSend}
            className="gap-2"
          >
            {status.kind === "sending" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {status.kind === "sending"
              ? t("settings.feedbackSection.sending")
              : t("settings.feedbackSection.send")}
          </Button>
        </div>
      </div>
    </div>
  );
}
