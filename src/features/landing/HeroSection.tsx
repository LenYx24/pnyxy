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

      <h1 className="mb-6">
        <img
          src="/logo_with_text.svg"
          alt="Pnyxy"
          className="mx-auto h-32 w-auto sm:h-40 md:h-48"
          // Glow temporarily disabled now that the lighter logo variant
          // is used. Re-enable by restoring the filter below.
          // style={{
          //   filter:
          //     "drop-shadow(0 0 18px rgba(230,220,255,0.95)) drop-shadow(0 0 60px rgba(196,181,253,0.75)) drop-shadow(0 0 140px rgba(139,92,246,0.5))",
          // }}
        />
      </h1>

      <p className="mb-4 max-w-2xl text-xl text-text-secondary sm:text-2xl">
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
