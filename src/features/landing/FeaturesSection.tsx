import { useTranslation } from "react-i18next";
import {
  BookOpen,
  PenTool,
  Sparkles,
  Flame,
  Users,
  Puzzle,
} from "lucide-react";
import { GlassCard, Reveal } from "@/components/ui";

const features = [
  { icon: BookOpen, key: "smartReading" as const },
  { icon: PenTool, key: "studyTools" as const },
  { icon: Sparkles, key: "aiAssistant" as const },
  { icon: Flame, key: "streaks" as const },
  { icon: Users, key: "community" as const },
  { icon: Puzzle, key: "plugins" as const },
];

export function FeaturesSection() {
  const { t } = useTranslation();
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="mb-4 text-center text-3xl font-bold text-text-primary">
        {t("landing.featuresTitle")}
      </h2>
      <p className="mb-16 text-center text-text-secondary">
        {t("landing.featuresSubtitle")}
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, key }, i) => (
          <Reveal key={key} delay={i * 80}>
            <GlassCard className="p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-purple/15">
                <Icon size={20} className="text-accent-purple" />
              </div>
              <h3 className="mb-2 text-lg font-semibold text-text-primary">
                {t(`landing.features.${key}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-text-secondary">
                {t(`landing.features.${key}.description`)}
              </p>
            </GlassCard>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
