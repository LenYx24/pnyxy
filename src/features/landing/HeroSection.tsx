import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { HeroStripes } from "./DiagonalStripes";

export function HeroSection() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  return (
    <section className="relative flex min-h-screen items-center overflow-hidden px-6 pt-24 pb-16">
      {/* Scattered geometric accents: asymmetric, off to the side. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute left-[7%] top-[28%] size-1.5 rounded-full bg-accent" />
        <span className="absolute left-[12%] top-[32%] size-1 rounded-full bg-accent/50" />
        <svg
          className="absolute bottom-[18%] left-[5%] size-14 text-accent/35"
          viewBox="0 0 40 40"
          fill="none"
        >
          <circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="1" />
          <circle cx="20" cy="20" r="2.5" fill="currentColor" />
        </svg>
      </div>

      <div className="mx-auto grid w-full max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-8">
        {/* Left: copy + actions. */}
        <div className="relative flex flex-col items-center text-center lg:items-start lg:text-left">
          <span className="mb-6 inline-flex items-center gap-2.5 font-mono text-2xs font-medium uppercase tracking-[0.22em] text-accent">
            <span className="h-px w-6 bg-accent" />
            {t("landing.h1Purpose", {
              defaultValue: "AI-assisted reading & learning",
            })}
          </span>

          <h1 className="flex items-center gap-3">
            <img
              src="/logo.svg"
              alt=""
              aria-hidden="true"
              className="h-12 w-auto sm:h-14"
            />
            <span className="font-display text-6xl font-bold tracking-tight text-text-primary sm:text-7xl">
              Pnyxy
            </span>
          </h1>

          <p className="mt-6 max-w-xl font-display text-xl font-medium text-text-secondary sm:text-2xl">
            {t("landing.tagline")}
          </p>
          <p className="mt-3 max-w-lg text-base leading-relaxed text-text-muted">
            {t("landing.subtitle")}
          </p>

          <div className="mt-9 flex flex-col items-center gap-3 sm:flex-row lg:items-start">
            <Link
              to={user ? "/library" : "/auth"}
              className="rounded-lg bg-accent px-6 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_var(--color-accent)] transition-transform hover:-translate-y-0.5"
            >
              {t("landing.getStarted")}
            </Link>
            <Link
              to="/download"
              className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-bg-secondary px-6 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-glass-hover"
            >
              <Download size={16} />
              {t("landing.download")}
            </Link>
          </div>
          {!user && (
            <Link
              to="/library"
              className="mt-5 font-mono text-2xs uppercase tracking-[0.15em] text-text-muted underline-offset-4 transition-colors hover:text-accent hover:underline"
            >
              {t("landing.continueNoAccount")}
            </Link>
          )}
        </div>

        {/* Right: product mock, sitting over a slanted accent band. */}
        <div className="relative hidden lg:block">
          <HeroStripes className="-inset-8 opacity-80" />

          <div
            className="relative overflow-hidden rounded-xl border border-glass-border bg-bg-secondary shadow-2xl"
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
