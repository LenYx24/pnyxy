import { MeshBackground } from "@/components/ui";
import { HeroSection } from "./HeroSection";
import { FeaturesSection } from "./FeaturesSection";

export function LandingPage() {
  return (
    <div className="min-h-screen">
      <MeshBackground />
      <HeroSection />
      <FeaturesSection />
    </div>
  );
}
