import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";

export function HeroSection() {
  const { t } = useTranslation();
  const { user } = useAuthStore();

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center px-6 text-center">
      {/* Floating geometric shapes (hidden on mobile) */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden sm:block">
        <div className="absolute left-[15%] top-[20%] h-24 w-24 rotate-45 rounded-lg border border-accent-purple/20 animate-[float_6s_ease-in-out_infinite]" />
        <div className="absolute right-[20%] top-[30%] h-16 w-16 rounded-full border border-accent-blue/20 animate-[float_8s_ease-in-out_infinite_1s]" />
        <div className="absolute bottom-[25%] left-[25%] h-20 w-20 rotate-12 border border-accent-purple/15 animate-[float_7s_ease-in-out_infinite_2s]" />
        <div className="absolute bottom-[30%] right-[15%] h-12 w-12 rotate-45 rounded-lg border border-accent-blue/15 animate-[float_9s_ease-in-out_infinite_0.5s]" />
      </div>

      {/* The h1's VISIBLE text includes the purpose ("Pnyxy —
          AI-assisted reading and learning") so the first line a
          crawler/reviewer sees on the page is "what does this app
          do?". Earlier we tried hiding the descriptive half in an
          `sr-only` span — Google's OAuth verifier still rejected
          the page for "no purpose explanation", almost certainly
          because their JS-rendered review skips screen-reader-only
          content. The descriptive line uses a smaller weight so the
          "Pnyxy" wordmark stays the visual anchor. */}
      <h1 className="mb-6 flex flex-col items-center gap-2">
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          className="h-24 w-auto sm:h-28 md:h-32"
        />
        <span className="text-5xl font-bold tracking-tight text-text-primary sm:text-6xl md:text-7xl">
          Pnyxy
        </span>
        <span className="mt-1 text-lg font-medium text-text-secondary sm:text-xl md:text-2xl">
          {t("landing.h1Purpose", {
            defaultValue: "AI-assisted reading and learning platform",
          })}
        </span>
      </h1>

      <p className="mb-4 max-w-2xl text-base text-text-secondary sm:text-lg">
        {t("landing.tagline")}
      </p>
      <p className="mb-10 max-w-xl text-base text-text-muted">
        {t("landing.subtitle")}
      </p>

      <div className="flex flex-col items-center gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:gap-4">
          <Link to={user ? "/library" : "/auth"}>
            <Button variant="primary">{t("landing.getStarted")}</Button>
          </Link>
          <Link to="/download">
            <Button variant="secondary" className="gap-2">
              <Download size={16} />
              {t("landing.download")}
            </Button>
          </Link>
        </div>
        {!user && (
          <Link
            to="/library"
            className="text-sm text-text-muted transition-colors hover:text-text-secondary"
          >
            {t("landing.continueNoAccount")}
          </Link>
        )}
      </div>
    </section>
  );
}
