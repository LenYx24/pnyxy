import { useTranslation } from "react-i18next";
import {
  BookOpen,
  PenTool,
  Sparkles,
  Flame,
  Users,
  Puzzle,
} from "lucide-react";
import { Reveal } from "@/components/ui";
import { SectionHeading } from "./SectionHeading";

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
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        eyebrow={t("landing.eyebrow.features")}
        title={t("landing.featuresTitle")}
        subtitle={t("landing.featuresSubtitle")}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, key }, i) => (
          <Reveal key={key} delay={i * 60}>
            <div className="group h-full rounded-xl border border-glass-border bg-bg-secondary p-6 transition-colors hover:border-accent/40">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/12 text-accent">
                  <Icon size={20} />
                </div>
                <span className="font-mono text-2xs text-text-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
              </div>
              <h3 className="mb-2 font-display text-lg font-semibold text-text-primary">
                {t(`landing.features.${key}.title`)}
              </h3>
              <p className="text-sm leading-relaxed text-text-secondary">
                {t(`landing.features.${key}.description`)}
              </p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
