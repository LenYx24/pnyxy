import { useEffect, useState } from "react";
import { Link } from "react-router";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";

export function LandingPage() {
  const { user } = useAuthStore();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 32);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
        <span className="bg-gradient-to-r from-accent-purple to-accent-blue bg-clip-text text-lg font-bold text-transparent">
          Pnyxy
        </span>
        <Link to={user ? "/library" : "/auth"}>
          <Button variant="secondary" className="text-sm">
            {user ? "Go to Library" : "Sign In"}
          </Button>
        </Link>
      </header>

      <HeroSection />
      <FeaturesSection />
    </div>
  );
}
