import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

const QUESTIONS = [
  "isItFree",
  "copyright",
  "privacy",
  "ai",
  "offline",
  "formats",
  "openSource",
  "selfHost",
] as const;

/**
 * FAQ using native <details>/<summary>, no JS accordion, no library.
 * Users can open multiple at once; the Plus icon rotates into an ×
 * via the [open] attribute group selector. Solid rows, no blur.
 */
export function FaqSection() {
  const { t } = useTranslation();

  return (
    <section id="faq" className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <SectionHeading
        eyebrow={t("landing.eyebrow.faq")}
        title={t("landing.faq.title")}
        subtitle={t("landing.faq.subtitle")}
      />

      <div className="space-y-2">
        {QUESTIONS.map((key) => (
          <details
            key={key}
            className="group rounded-lg border border-glass-border bg-bg-secondary transition-colors hover:border-accent/30"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-medium text-text-primary">
              {t(`landing.faq.items.${key}.q`)}
              <Plus
                size={16}
                className="shrink-0 text-accent transition-transform group-open:rotate-45"
              />
            </summary>
            <div className="border-t border-glass-border/60 px-4 py-3.5 text-sm leading-relaxed text-text-secondary">
              {t(`landing.faq.items.${key}.a`)}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
