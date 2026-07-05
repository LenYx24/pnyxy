import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Download, Sparkles } from "lucide-react";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";

interface HeroSectionProps {
  theme: "dark" | "light";
}

export function HeroSection({ theme }: HeroSectionProps) {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isDark = theme === "dark";

  // Per-mode colors so both stay high-contrast. The eyebrow uses a
  // brighter blue accent on dark (the cyan accent is too dark on
  // near-black); the CTAs invert via tokens (light button on dark,
  // dark button on light) for maximum readability either way.
  const eyebrowCls = isDark
    ? "border-accent-blue/30 bg-accent-blue/10 text-accent-blue"
    : "border-accent/30 bg-accent/10 text-accent";
  const primaryCta =
    "rounded-lg bg-text-primary px-6 py-2.5 text-sm font-semibold text-bg-primary shadow-lg transition-opacity hover:opacity-90";
  const secondaryCta =
    "inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-6 py-2.5 text-sm font-semibold text-text-primary backdrop-blur-md transition-colors hover:bg-glass-hover";

  return (
    <section className="relative flex min-h-screen items-center px-6 pt-24 pb-16">
      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-8">
        {/* Left: copy + actions, left-aligned on desktop, centered on
            mobile where the visual is hidden. */}
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <span
            className={cn(
              "mb-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
              eyebrowCls,
            )}
          >
            <Sparkles size={13} />
            {t("landing.h1Purpose", {
              defaultValue: "AI-assisted reading and learning",
            })}
          </span>

          <h1 className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              className="h-12 w-auto sm:h-14"
            />
            <span className="text-5xl font-bold tracking-tight text-text-primary sm:text-6xl">
              Pnyxy
            </span>
          </h1>

          <p className="mt-6 max-w-xl text-lg font-medium text-text-secondary sm:text-xl">
            {t("landing.tagline")}
          </p>
          <p className="mt-3 max-w-xl text-base text-text-muted">
            {t("landing.subtitle")}
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
            <Link to={user ? "/library" : "/auth"} className={primaryCta}>
              {t("landing.getStarted")}
            </Link>
            <Link to="/download" className={secondaryCta}>
              <Download size={16} />
              {t("landing.download")}
            </Link>
          </div>
          {!user && (
            <Link
              to="/library"
              className="mt-4 text-sm text-text-muted underline-offset-4 transition-colors hover:text-text-secondary hover:underline"
            >
              {t("landing.continueNoAccount")}
            </Link>
          )}
        </div>

        {/* Right: product-mock visual. A faux app window showing the
            "one workspace" idea (PDF + AI chat). Swap this block for a
            real <img src="/hero.gif" /> when a recording is ready. */}
        <div className="relative hidden lg:block">
          {/* floating accent shapes behind the mock */}
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute -left-6 top-8 h-24 w-24 rotate-12 rounded-2xl border border-accent/20 animate-[float_7s_ease-in-out_infinite]" />
            <div className="absolute -right-4 bottom-10 h-16 w-16 rounded-full border border-accent-blue/20 animate-[float_9s_ease-in-out_infinite_1s]" />
          </div>

          <div
            className="overflow-hidden rounded-2xl border border-glass-border bg-bg-secondary/80 shadow-2xl backdrop-blur-md"
            style={{
              transform: "perspective(1600px) rotateY(-9deg) rotateX(3deg)",
            }}
          >
            {/* window chrome */}
            <div className="flex items-center gap-1.5 border-b border-glass-border bg-glass-bg px-4 py-2.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
              <span className="ml-3 h-3 w-40 rounded bg-glass-border" />
            </div>

            {/* two-pane body: faux PDF + faux AI chat */}
            <div className="grid grid-cols-5 gap-px bg-glass-border">
              {/* PDF page */}
              <div className="col-span-3 space-y-2.5 bg-bg-primary p-5">
                <div className="h-3 w-2/3 rounded bg-text-muted/40" />
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-2 rounded bg-text-muted/20"
                    style={{ width: `${92 - (i % 3) * 14}%` }}
                  />
                ))}
                <div className="my-3 h-16 rounded bg-accent/10" />
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-2 rounded bg-text-muted/20"
                    style={{ width: `${88 - i * 12}%` }}
                  />
                ))}
              </div>
              {/* AI chat */}
              <div className="col-span-2 space-y-3 bg-bg-secondary p-4">
                <div className="ml-auto w-4/5 rounded-lg rounded-br-sm bg-accent/15 px-2.5 py-2">
                  <div className="h-1.5 w-full rounded bg-accent/40" />
                  <div className="mt-1.5 h-1.5 w-2/3 rounded bg-accent/40" />
                </div>
                <div className="w-11/12 space-y-1.5 rounded-lg rounded-bl-sm bg-glass-bg px-2.5 py-2">
                  <div className="h-1.5 w-full rounded bg-text-muted/30" />
                  <div className="h-1.5 w-full rounded bg-text-muted/30" />
                  <div className="h-1.5 w-3/4 rounded bg-text-muted/30" />
                </div>
                <div className="w-2/3 space-y-1.5 rounded-lg rounded-bl-sm bg-glass-bg px-2.5 py-2">
                  <div className="h-1.5 w-full rounded bg-text-muted/30" />
                  <div className="h-1.5 w-1/2 rounded bg-text-muted/30" />
                </div>
                <div className="mt-auto flex items-center gap-2 rounded-lg border border-glass-border px-2.5 py-2">
                  <div className="h-1.5 flex-1 rounded bg-text-muted/20" />
                  <div className="h-4 w-4 rounded bg-accent/60" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
