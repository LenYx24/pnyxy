import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  X,
  Sparkles,
  FileText,
  Brain,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

interface Step {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * Lightweight first-run tour. A centered modal carousel (no DOM-anchored
 * coach marks) so it stays robust regardless of the current route. Any exit
 * path — finish, skip, X, Esc, backdrop — marks onboarding complete so the
 * user is never nagged twice. Restartable from Settings › General.
 */
export function OnboardingTour() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const setOnboardingCompleted = useSettingsStore(
    (s) => s.setOnboardingCompleted,
  );
  const [index, setIndex] = useState(0);

  const shouldShow = Boolean(user) && !onboardingCompleted;

  const steps: Step[] = [
    {
      icon: Sparkles,
      title: t("onboarding.welcome.title", { defaultValue: "Welcome to Pnyxy" }),
      body: t("onboarding.welcome.body", {
        defaultValue:
          "Your study workspace for reading, understanding, and remembering. This quick tour takes under a minute.",
      }),
    },
    {
      icon: FileText,
      title: t("onboarding.read.title", {
        defaultValue: "Read PDFs & ask the AI",
      }),
      body: t("onboarding.read.body", {
        defaultValue:
          "Open a PDF and ask questions in the chat. Answers cite the page — click a citation to jump straight there.",
      }),
    },
    {
      icon: Brain,
      title: t("onboarding.memory.title", {
        defaultValue: "Turn reading into memory",
      }),
      body: t("onboarding.memory.body", {
        defaultValue:
          "Generate quizzes, flashcards, and study roadmaps from anything you read to lock it in.",
      }),
    },
    {
      icon: Rocket,
      title: t("onboarding.ready.title", { defaultValue: "You're all set" }),
      body: t("onboarding.ready.body", {
        defaultValue:
          "It's free to start — pick your AI model anytime in Settings. Happy studying!",
      }),
    },
  ];

  const finish = useCallback(() => {
    // Rewind so a later restart (from Settings) reopens at the first step.
    setIndex(0);
    setOnboardingCompleted(true);
  }, [setOnboardingCompleted]);

  // Esc closes the whole tour. Mirrors the app's other modal patterns.
  useEffect(() => {
    if (!shouldShow) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shouldShow, finish]);

  if (!shouldShow || typeof document === "undefined") return null;

  const step = steps[index];
  const Icon = step.icon;
  const isLast = index === steps.length - 1;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={finish}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-title"
        className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl"
      >
        <button
          type="button"
          onClick={finish}
          aria-label={t("common.close", { defaultValue: "Close" })}
          className="absolute right-3 top-3 cursor-pointer rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
        >
          <X size={16} />
        </button>

        <div className="mb-4 flex size-11 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <Icon size={22} />
        </div>

        <h3
          id="onboarding-title"
          className="mb-2 text-lg font-semibold text-text-primary"
        >
          {step.title}
        </h3>
        <p className="text-sm text-text-muted">{step.body}</p>

        {/* Step dots */}
        <div className="mt-5 flex items-center gap-1.5">
          {steps.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-4 bg-accent" : "w-1.5 bg-glass-border",
              )}
            />
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="cursor-pointer text-sm font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            {t("onboarding.skip", { defaultValue: "Skip tour" })}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex((i) => i - 1)}
              >
                {t("onboarding.back", { defaultValue: "Back" })}
              </Button>
            )}
            {isLast ? (
              <Button variant="primary" size="sm" onClick={finish}>
                {t("onboarding.done", { defaultValue: "Get started" })}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIndex((i) => i + 1)}
              >
                {t("onboarding.next", { defaultValue: "Next" })}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
