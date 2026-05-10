import { useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Send, Sparkles, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import { useFocusStore } from "@/stores/focus-store";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/cn";

/**
 * Lightweight, non-blocking feedback prompt that slides into the
 * bottom-right corner. UX shape:
 *
 *   1. "How's Pnyxy?"  + three sentiment buttons (love / fine /
 *      frustrated) + a small X.
 *   2. After a sentiment is picked: optional textarea + Send.
 *   3. After send: brief thank-you, then auto-dismiss.
 *
 * Frequency control (localStorage, per-device — deliberate so it
 * doesn't sync across devices and keep nagging from the cloud):
 *   - Never shown for the first 3 days after account creation.
 *   - Cooldown of 30 days after ANY interaction (X / sentiment /
 *     send).
 *   - Suppressed on routes where it would be intrusive (reader,
 *     auth, onboarding, focus session, static pages).
 *
 * Storage key shape:  pnyxy:feedback-prompt:v1 → `{ lastSeen: ISO }`
 */

const STORAGE_KEY = "pnyxy:feedback-prompt:v1";
const ACCOUNT_AGE_GATE_DAYS = 3;
const COOLDOWN_DAYS = 30;
const MOUNT_DELAY_MS = 6000; // don't pop the moment a page loads

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
  if (!user) return false; // anonymous users don't see this — they have no email to follow up on
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

  // Suppress on focused / blocked routes. Computing these here
  // (instead of unmounting from the parent) keeps the slide-out
  // animation possible: when the user navigates into a blocked
  // route, the toast slides off the screen instead of vanishing.
  const isReader = location.pathname.startsWith("/reader");
  const isAuth = location.pathname.startsWith("/auth");
  const isStatic = STATIC_PATHS.some((p) => location.pathname.startsWith(p));
  const blocked = isReader || isAuth || isStatic || focusActive;

  // Initial gate. Runs once per signed-in mount; we don't poll.
  useEffect(() => {
    if (!user) return;
    if (!shouldShowFor(user)) return;
    if (blocked) return;
    const timer = window.setTimeout(() => {
      setVisible(true);
    }, MOUNT_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Deliberately only re-runs on user change, not on every route
    // change — once we've decided to show, we keep it shown until
    // the user dismisses or the route blocks (handled below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        love: "(no message — just a thumbs-up)",
        fine: "(no message — neutral signal)",
        frustrated: "(no message — but they're not happy)",
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
        const payload = (await res.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          payload?.error?.message ??
            t("feedbackPrompt.errorGeneric", {
              defaultValue: "Couldn't send. Try again from Settings → Feedback.",
            }),
        );
      }
      setPhase("sent");
      // Auto-dismiss after the thank-you sits long enough to be read.
      dismissTimerRef.current = window.setTimeout(() => {
        closeAndCooldown();
      }, 2200);
    } catch (err) {
      logError("FeedbackPrompt:send", err);
      setError(err instanceof Error ? err.message : "Send failed.");
      setPhase("compose");
    }
  };

  // Hide while blocked OR not yet visible. Don't unmount during the
  // dismiss animation — let the slide-off finish first by gating on
  // `visible` with a CSS transform.
  if (!user) return null;
  const onScreen = visible && !blocked;

  // While not yet shown / fully off screen we don't render anything,
  // saving the cost of the form on every page that doesn't surface
  // the prompt.
  if (!onScreen && phase === "prompt" && !sentiment) return null;

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label={t("feedbackPrompt.aria", {
        defaultValue: "Feedback prompt",
      })}
      className={cn(
        // Bottom-right by default, clears the mobile bottom nav (which
        // is 3.5rem tall + safe-area). Doesn't intercept clicks on
        // the page underneath because pointer-events-none on the
        // wrapper, and the inner card opts back in.
        "pointer-events-none fixed right-4 z-40 transition-all duration-200 ease-out",
        // Sit above the global bottom nav on mobile; on desktop it
        // can sit closer to the bottom edge.
        "bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] md:bottom-4",
        // Slide-in / slide-out by translating instead of unmounting.
        onScreen
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-4 opacity-0",
      )}
    >
      <div className="pointer-events-auto w-[18rem] max-w-[calc(100vw-2rem)] rounded-xl border border-glass-border bg-bg-secondary/95 p-3 shadow-xl backdrop-blur-xl">
        {phase === "sent" ? (
          <div className="flex items-center gap-2 py-2 text-sm text-text-primary">
            <Sparkles size={16} className="text-accent-purple" />
            <span>
              {t("feedbackPrompt.thanks", {
                defaultValue: "Thanks for the feedback!",
              })}
            </span>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-start justify-between gap-2">
              <p className="text-sm font-medium text-text-primary">
                {phase === "compose"
                  ? t("feedbackPrompt.composeTitle", {
                      defaultValue: "Tell us a bit more (optional)",
                    })
                  : t("feedbackPrompt.title", {
                      defaultValue: "How's Pnyxy treating you?",
                    })}
              </p>
              <button
                type="button"
                onClick={closeAndCooldown}
                className="-mr-1 -mt-1 rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
                aria-label={t("common.close", { defaultValue: "Close" })}
                title={t("feedbackPrompt.dismiss", {
                  defaultValue: "Maybe later",
                })}
              >
                <X size={14} />
              </button>
            </div>

            {phase === "prompt" && (
              <div className="flex items-center justify-between gap-1">
                <SentimentButton
                  label={t("feedbackPrompt.love", {
                    defaultValue: "Loving it",
                  })}
                  emoji="😊"
                  onClick={() => handlePickSentiment("love")}
                />
                <SentimentButton
                  label={t("feedbackPrompt.fine", { defaultValue: "It's fine" })}
                  emoji="😐"
                  onClick={() => handlePickSentiment("fine")}
                />
                <SentimentButton
                  label={t("feedbackPrompt.frustrated", {
                    defaultValue: "Frustrating",
                  })}
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
                      ? t("feedbackPrompt.placeholderFrustrated", {
                          defaultValue:
                            "What's bugging you? We read every reply.",
                        })
                      : t("feedbackPrompt.placeholder", {
                          defaultValue:
                            "Anything you'd like us to know — features, bugs, ideas.",
                        })
                  }
                  className="w-full resize-none rounded-md border border-glass-border bg-bg-primary/50 px-2 py-1.5 text-xs text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple/50 focus:ring-1 focus:ring-accent-purple/25 disabled:opacity-60"
                  autoFocus
                />
                {error && (
                  <p className="text-[11px] text-red-400">{error}</p>
                )}
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={closeAndCooldown}
                    disabled={phase === "sending"}
                    className="rounded-md px-2 py-1 text-xs text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
                  >
                    {t("common.skip", { defaultValue: "Skip" })}
                  </button>
                  <button
                    type="submit"
                    disabled={phase === "sending"}
                    className="inline-flex items-center gap-1 rounded-md bg-accent-purple/80 px-2 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-purple disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
                  >
                    {phase === "sending" ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Send size={11} />
                    )}
                    {t("feedbackPrompt.send", { defaultValue: "Send" })}
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
      className="flex flex-1 flex-col items-center gap-0.5 rounded-md border border-glass-border bg-glass-bg/40 px-2 py-2 text-[11px] text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
      title={label}
    >
      <span className="text-lg leading-none">{emoji}</span>
      <span>{label}</span>
    </button>
  );
}
