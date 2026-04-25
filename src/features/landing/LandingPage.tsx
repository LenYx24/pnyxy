import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
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
      // Storage may be blocked (private mode + strict settings) —
      // that's fine, user will see landing again next time.
    }
  }, []);

  return (
    <div className="min-h-screen">
      <MeshBackground />

      {/* Top nav — transparent over the hero, glass backdrop once
          scrolled so the logo doesn't clash with content below it. */}
      <header
        className={cn(
          "fixed top-0 z-50 flex w-full items-center justify-between px-4 py-4 transition-colors duration-200 sm:px-6",
          scrolled
            ? "border-b border-glass-border/40 bg-bg-primary/60 backdrop-blur-md"
            : "border-b border-transparent",
        )}
      >
        <Link to="/" aria-label="Pnyxy home">
          <img
            src="/logo.svg"
            alt="Pnyxy"
            className="h-14 w-auto sm:h-16"
            // Glow temporarily disabled now that the lighter logo variant
            // is used. Re-enable by restoring the filter below.
            // style={{
            //   filter:
            //     "drop-shadow(0 0 19px rgba(230,220,255,0.95)) drop-shadow(0 0 28px rgba(196,181,253,0.8)) drop-shadow(0 0 60px rgba(139,92,246,0.55))",
            // }}
          />
        </Link>
        <div className="flex items-center gap-2">
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

      <HeroSection />
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
