import { Link } from "react-router";
import { MeshBackground, Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";

export function LandingPage() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen">
      <MeshBackground />

      {/* Top nav */}
      <header className="fixed top-0 z-50 flex w-full items-center justify-between px-4 py-4 sm:px-6">
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
