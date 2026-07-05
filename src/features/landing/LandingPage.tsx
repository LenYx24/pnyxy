import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Sun, Moon } from "lucide-react";
import { MeshBackground, Button, Reveal } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";
import { Footer } from "@/components/layout/Footer";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";
import { PricingSection } from "./PricingSection";
import { FaqSection } from "./FaqSection";
import { OpenSourceSection } from "./OpenSourceSection";

export function LandingPage() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [scrolled, setScrolled] = useState(false);
  // Landing-only light/dark theme (default dark). Persisted so a
  // returning visitor keeps their choice. Scoped to the landing via
  // the data-static-theme attribute + CSS token overrides in index.css.
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("pnyxy:landing-theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("pnyxy:landing-theme", theme);
    } catch {
      // storage blocked; in-memory choice still applies this session
    }
  }, [theme]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mark that this visitor has seen the landing. The index-route
  // loader in src/app/router.tsx reads this flag and skips the
  // redirect on future visits.
  useEffect(() => {
    try {
      localStorage.setItem("pnyxy:has-seen-landing", "1");
    } catch {
      // Storage may be blocked (private mode + strict settings) -
      // that's fine, user will see landing again next time.
    }
  }, []);

  return (
    <div className="min-h-screen" data-static-theme={theme}>
      <MeshBackground theme={theme} />

      {/* Top nav. Logo only appears once scrolled (the hero already
          shows a big one), so the top of the page stays clean. */}
      <header
        className={cn(
          "fixed top-0 z-50 flex w-full items-center justify-between px-4 py-3 transition-colors duration-200 sm:px-6",
          scrolled
            ? "border-b border-glass-border/40 bg-bg-primary/70 backdrop-blur-md"
            : "border-b border-transparent",
        )}
      >
        <Link
          to="/"
          aria-label="Pnyxy home"
          className={cn(
            "transition-opacity duration-200",
            scrolled ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          <img src="/logo.svg" alt="Pnyxy" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setTheme((prev) => (prev === "dark" ? "light" : "dark"))
            }
            aria-label={
              theme === "dark"
                ? t("landing.themeLight", { defaultValue: "Switch to light" })
                : t("landing.themeDark", { defaultValue: "Switch to dark" })
            }
            title={
              theme === "dark"
                ? t("landing.themeLight", { defaultValue: "Switch to light" })
                : t("landing.themeDark", { defaultValue: "Switch to dark" })
            }
            className="rounded-lg border border-glass-border p-2 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
          >
            {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link to="/tutorial" className="hidden sm:block">
            <Button variant="ghost" className="text-sm">
              {t("landing.tutorial")}
            </Button>
          </Link>
          <Link to="/download">
            <Button variant="ghost" className="text-sm">
              {t("landing.download")}
            </Button>
          </Link>
          <Link to={user ? "/library" : "/auth"}>
            <Button variant="secondary" className="text-sm">
              {user ? t("landing.goToLibrary") : t("landing.signIn")}
            </Button>
          </Link>
        </div>
      </header>

      <HeroSection theme={theme} />
      <Reveal>
        <FeaturesSection />
      </Reveal>
      <Reveal>
        <PricingSection />
      </Reveal>
      <Reveal>
        <FaqSection />
      </Reveal>
      <Reveal>
        <OpenSourceSection />
      </Reveal>
      <Footer />
    </div>
  );
}
