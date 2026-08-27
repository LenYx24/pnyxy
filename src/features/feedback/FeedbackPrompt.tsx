import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useFocusStore } from "@/stores/focus-store";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/cn";

// Slide-in feedback prompt (bottom-right): sentiment buttons -> optional
// textarea -> thank-you. Frequency gated in localStorage (per-device on
// purpose): hidden for the first 3 days, 30-day cooldown after any
// interaction, suppressed on reader/auth/static/focus routes.

const STORAGE_KEY = "pnyxy:feedback-prompt:v1";
const ACCOUNT_AGE_GATE_DAYS = 3;
const COOLDOWN_DAYS = 30;
// Only ask after the user has genuinely used the app this session: this
// much ACTIVE time (tab visible) must elapse AND they must have interacted
// at least once. Popping 6s after load felt pointless, you hadn't used it.
const ENGAGEMENT_DELAY_MS = 3 * 60 * 1000; // ~3 min of real in-app time

const STATIC_PATHS = ["/about", "/privacy", "/terms", "/help", "/tutorial"];

type Sentiment = "love" | "fine" | "frustrated";

interface PromptState {
  lastSeen?: string; // ISO date
}

function readState(): PromptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as PromptState;
  } catch {
    return {};
  }
}

function writeState(next: PromptState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode
  }
}

function daysSince(iso: string | undefined): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

function shouldShowFor(user: { created_at?: string } | null): boolean {
  if (!user) return false; // no email to follow up on
  if (daysSince(user.created_at) < ACCOUNT_AGE_GATE_DAYS) return false;
  if (daysSince(readState().lastSeen) < COOLDOWN_DAYS) return false;
  return true;
}

export function FeedbackPrompt() {
  const { t } = useTranslation();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const focusActive = useFocusStore((s) => s.active);

  const [visible, setVisible] = useState(false);
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<"prompt" | "compose" | "sending" | "sent">(
    "prompt",
  );
  const [error, setError] = useState<string | null>(null);
  const dismissTimerRef = useRef<number | null>(null);

  // computed here (not unmounted by parent) so navigating into a blocked
  // route slides the toast off instead of vanishing mid-animation.
  const isReader = location.pathname.startsWith("/reader");
  const isAuth = location.pathname.startsWith("/auth");
  const isStatic = STATIC_PATHS.some((p) => location.pathname.startsWith(p));
  const blocked = isReader || isAuth || isStatic || focusActive;

  useEffect(() => {
    if (!user) return;
    if (!shouldShowFor(user)) return;

    // Accumulate ACTIVE in-app time (only while the tab is visible) and
    // require at least one interaction, so the prompt appears after real
    // usage instead of the moment a page loads. Route blocking is applied
    // at render time (onScreen), so we don't gate the timer on it here.
    let activeMs = 0;
    let interacted = false;
    const markInteracted = () => {
      interacted = true;
    };
    window.addEventListener("pointerdown", markInteracted);
    window.addEventListener("keydown", markInteracted);

    const TICK_MS = 5000;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") activeMs += TICK_MS;
      if (interacted && activeMs >= ENGAGEMENT_DELAY_MS) {
        window.clearInterval(interval);
        setVisible(true);
      }
    }, TICK_MS);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("pointerdown", markInteracted);
      window.removeEventListener("keydown", markInteracted);
    };
    // only re-run on user change; route blocking is handled separately
  }, [user]);

  const closeAndCooldown = () => {
    writeState({ lastSeen: new Date().toISOString() });
    setVisible(false);
    if (dismissTimerRef.current !== null) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
  };

  const handlePickSentiment = (s: Sentiment) => {
    setSentiment(s);
    setPhase("compose");
  };

  const handleSend = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!sentiment || phase === "sending") return;
    setPhase("sending");
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-feedback`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const subjectMap: Record<Sentiment, string> = {
        love: "[Pnyxy feedback · loving it]",
        fine: "[Pnyxy feedback · neutral]",
        frustrated: "[Pnyxy feedback · frustrated]",
      };
      const fallbackBody: Record<Sentiment, string> = {
        love: "(no message, just a thumbs-up)",
        fine: "(no message, neutral signal)",
        frustrated: "(no message, but they're not happy)",
      };

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          subject: subjectMap[sentiment],
          body: body.trim() || fallbackBody[sentiment],
        }),
      });
      if (!res.ok) {
        // read as text first: error responses may be non-JSON (401 HTML,
        // rate-limit text) which would throw on JSON.parse.
        const bodyText = await res.text().catch(() => "");
        type ErrorPayload = { error?: { message?: string } };
        let parsed: ErrorPayload | null = null;
        try {
          parsed = bodyText ? (JSON.parse(bodyText) as ErrorPayload) : null;
        } catch {
          parsed = null;
        }
        const detail = parsed?.error?.message ?? bodyText.slice(0, 200) ?? "";
        logError("FeedbackPrompt:send", {
          status: res.status,
          statusText: res.statusText,
          detail,
        });
        throw new Error(detail || t("feedbackPrompt.errorGeneric"));
      }
      setPhase("sent");
      dismissTimerRef.current = window.setTimeout(() => {
        closeAndCooldown();
      }, 2200);
    } catch (err) {
      logError("FeedbackPrompt:send", err);
      setError(err instanceof Error ? err.message : "Send failed.");
      setPhase("compose");
    }
  };

  if (!user) return null;
  const onScreen = visible && !blocked;

  // skip rendering entirely until first shown / after fully off screen
  if (!onScreen && phase === "prompt" && !sentiment) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("feedbackPrompt.aria")}
      className={cn(
        // wrapper is pointer-events-none so it doesn't block the page; the
        // inner card opts back in.
        "pointer-events-none fixed right-4 z-40 transition-all duration-200 ease-out",
        // clear the mobile bottom nav
        "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-4",
        onScreen
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="pointer-events-auto w-[18rem] max-w-[calc(100vw-2rem)] rounded-xl border border-glass-border bg-bg-secondary/95 p-3 shadow-xl backdrop-blur-xl">
        {phase === "sent" ? (
          <div className="flex items-center gap-2 py-2 text-sm text-text-primary">
            <Sparkles size={16} className="text-accent" />
            <span>{t("feedbackPrompt.thanks")}</span>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-text-primary">
                {phase === "compose"
                  ? t("feedbackPrompt.composeTitle")
                  : t("feedbackPrompt.title")}
              </p>
              <button
                type="button"
                onClick={closeAndCooldown}
                className="-mr-1 -mt-1 rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                aria-label={t("common.close")}
                title={t("feedbackPrompt.dismiss")}
              >
                <X size={14} />
              </button>
            </div>

            {phase === "prompt" && (
              <div className="flex items-center justify-between gap-1">
                <SentimentButton
                  label={t("feedbackPrompt.love")}
                  emoji="😊"
                  onClick={() => handlePickSentiment("love")}
                />
                <SentimentButton
                  label={t("feedbackPrompt.fine")}
                  emoji="😐"
                  onClick={() => handlePickSentiment("fine")}
                />
                <SentimentButton
                  label={t("feedbackPrompt.frustrated")}
                  emoji="😤"
                  onClick={() => handlePickSentiment("frustrated")}
                />
              </div>
            )}

            {phase === "compose" || phase === "sending" ? (
              <form onSubmit={handleSend} className="space-y-2">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  disabled={phase === "sending"}
                  placeholder={
                    sentiment === "frustrated"
                      ? t("feedbackPrompt.placeholderFrustrated")
                      : t("feedbackPrompt.placeholder")
                  }
                  className="w-full resize-none rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/25 disabled:opacity-60"
                  autoFocus
                />
                {error && <p className="text-2xs text-danger">{error}</p>}
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={closeAndCooldown}
                    disabled={phase === "sending"}
                    className="rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
                  >
                    {t("common.skip")}
                  </button>
                  <button
                    type="submit"
                    disabled={phase === "sending"}
                    className="inline-flex items-center gap-1 rounded-md bg-accent/80 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {phase === "sending" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Send size={11} />
                    )}
                    {t("feedbackPrompt.send")}
                  </button>
                </div>
              </form>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function SentimentButton({
  label,
  emoji,
  onClick,
}: {
  label: string;
  emoji: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-1 flex-col items-center gap-0.5 rounded-md border border-glass-border bg-glass-bg/40 px-2 py-2 text-2xs text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title={label}
    >
      <span className="text-lg leading-none">{emoji}</span>
      <span>{label}</span>
    </button>
  );
}
