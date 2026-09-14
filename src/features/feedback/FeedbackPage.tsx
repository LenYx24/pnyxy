import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import {
  MessageSquareText,
  Send,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Bug,
  Lightbulb,
  MessageCircle,
} from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/cn";

type FeedbackKind = "bug" | "idea" | "other";

interface FeedbackRow {
  id: string;
  created_at: string;
  kind: FeedbackKind;
  subject: string | null;
  body: string;
  status: string;
}

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

const KIND_META: Record<FeedbackKind, { icon: typeof Bug; labelKey: string }> = {
  bug: { icon: Bug, labelKey: "feedback.kind.bug" },
  idea: { icon: Lightbulb, labelKey: "feedback.kind.idea" },
  other: { icon: MessageCircle, labelKey: "feedback.kind.other" },
};

/**
 * Send through the send-feedback edge function: it stores the feedback (service
 * role, signed-in or anonymous) and best-effort emails a copy, rate-limited by
 * account or hashed IP plus a global daily cap. The single writer for both
 * cases, so its result drives success/failure. Returns a coarse status.
 */
async function callFeedbackEdge(
  subject: string,
  body: string,
  kind: FeedbackKind,
): Promise<{ ok: boolean; code?: string }> {
  try {
    const { data } = await supabase.auth.getSession();
    const accessToken = data?.session?.access_token;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-feedback`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject,
          body,
          kind,
          page_url: window.location.pathname,
        }),
      },
    );
    if (res.ok) return { ok: true };
    const text = await res.text().catch(() => "");
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { error?: { code?: string } })?.error?.code;
    } catch {
      code = undefined;
    }
    return { ok: false, code };
  } catch {
    return { ok: false };
  }
}

export function FeedbackPage() {
  const { t, i18n } = useTranslation();
  useDocumentTitle(t("feedback.title"));
  const user = useAuthStore((s) => s.user);

  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) return;
    const { data, error } = await supabase
      .from("feedback")
      .select("id, created_at, kind, subject, body, status")
      .order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) setRows(data as FeedbackRow[]);
    setLoadingRows(false);
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canSend = body.trim().length > 0 && status.kind !== "sending";

  async function handleSend() {
    if (!canSend) return;
    setStatus({ kind: "sending" });
    // The edge function is the single writer (stores the row + best-effort
    // email) for both signed-in and anonymous senders.
    const res = await callFeedbackEdge(subject.trim(), body.trim(), kind);
    if (!res.ok) {
      setStatus({
        kind: "error",
        message:
          res.code === "rate_limited"
            ? t("feedback.rateLimited")
            : t("feedback.errorGeneric"),
      });
      return;
    }
    setStatus({ kind: "sent" });
    setSubject("");
    setBody("");
    if (user) void refresh();
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-8 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <MessageSquareText size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("feedback.title")}
          </h1>
          <p className="text-sm text-text-secondary">{t("feedback.subtitle")}</p>
        </div>
      </div>

      {/* Form */}
      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <div className="space-y-1.5">
          <span className="block text-[13px] font-medium text-text-secondary">
            {t("feedback.kindLabel")}
          </span>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(KIND_META) as FeedbackKind[]).map((k) => {
              const Icon = KIND_META[k].icon;
              const active = kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-control border px-3 py-1.5 text-sm transition-colors",
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-glass-border bg-bg-tertiary text-text-secondary hover:bg-surface-3",
                  )}
                >
                  <Icon size={14} />
                  {t(KIND_META[k].labelKey)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="fb-subject"
            className="block text-[13px] font-medium text-text-secondary"
          >
            {t("feedback.subjectLabel")}
          </label>
          <input
            id="fb-subject"
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder={t("feedback.subjectPlaceholder")}
            maxLength={200}
            disabled={status.kind === "sending"}
            className="field bg-bg-secondary"
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="fb-body"
            className="block text-[13px] font-medium text-text-secondary"
          >
            {t("feedback.bodyLabel")}
          </label>
          <textarea
            id="fb-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={t("feedback.bodyPlaceholder")}
            rows={6}
            maxLength={10000}
            disabled={status.kind === "sending"}
            className="field resize-y bg-bg-secondary"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div aria-live="polite" className="min-w-0 flex-1 text-[13px]">
            {status.kind === "sent" && (
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 size={14} />
                {t("feedback.sent")}
              </span>
            )}
            {status.kind === "error" && (
              <span className="inline-flex items-center gap-1.5 text-danger">
                <AlertCircle size={14} />
                {status.message}
              </span>
            )}
          </div>
          <Button variant="primary" onClick={handleSend} disabled={!canSend}>
            {status.kind === "sending" ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
            {status.kind === "sending" ? t("feedback.sending") : t("feedback.send")}
          </Button>
        </div>
      </section>

      {/* History (signed-in only; anonymous feedback isn't tied to an account) */}
      {!user ? (
        <p className="text-center text-sm text-text-muted">
          {t("feedback.anonHistoryNote")}{" "}
          <Link to="/auth" className="text-accent hover:underline">
            {t("auth.signIn")}
          </Link>
        </p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-text-primary">
            {t("feedback.historyTitle")}
          </h2>
          {loadingRows ? (
          <div className="flex justify-center py-8">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-xl border border-glass-border bg-glass-bg/50 px-4 py-6 text-center text-sm text-text-muted">
            {t("feedback.empty")}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const meta = KIND_META[row.kind] ?? KIND_META.other;
              const Icon = meta.icon;
              return (
                <li
                  key={row.id}
                  className="rounded-xl border border-glass-border bg-glass-bg/50 p-4"
                >
                  <div className="flex items-center gap-2 text-xs text-text-muted">
                    <span className="inline-flex items-center gap-1 rounded-full bg-bg-tertiary px-2 py-0.5 text-text-secondary">
                      <Icon size={12} />
                      {t(meta.labelKey)}
                    </span>
                    <span className="inline-flex items-center rounded-full bg-bg-tertiary px-2 py-0.5">
                      {t(`feedback.status.${row.status}`, {
                        defaultValue: row.status,
                      })}
                    </span>
                    <span className="ml-auto">
                      {new Date(row.created_at).toLocaleDateString(
                        i18n.resolvedLanguage,
                        { year: "numeric", month: "short", day: "numeric" },
                      )}
                    </span>
                  </div>
                  {row.subject && (
                    <p className="mt-2 text-sm font-medium text-text-primary">
                      {row.subject}
                    </p>
                  )}
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-secondary">
                    {row.body}
                  </p>
                </li>
              );
            })}
          </ul>
          )}
        </section>
      )}
    </div>
  );
}
