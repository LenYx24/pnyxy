import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";

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
 * FAQ using native <details>/<summary> — no JS accordion, no library.
 * Users can open multiple at once; ChevronDown rotates via the
 * [open] attribute group selector.
 */
export function FaqSection() {
  const { t } = useTranslation();

  return (
    <section
      id="faq"
      className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <h2 className="mb-4 text-center text-3xl font-bold text-text-primary">
        {t("landing.faq.title")}
      </h2>
      <p className="mb-10 text-center text-text-secondary">
        {t("landing.faq.subtitle")}
      </p>

      <div className="space-y-2">
        {QUESTIONS.map((key) => (
          <details
            key={key}
            className="group rounded-lg border border-glass-border bg-glass-bg/40 backdrop-blur-md"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text-primary transition-colors hover:bg-glass-hover">
              {t(`landing.faq.items.${key}.q`)}
              <ChevronDown
                size={16}
                className="shrink-0 text-text-muted transition-transform group-open:rotate-180"
              />
            </summary>
            <div className="border-t border-glass-border/60 px-4 py-3 text-sm leading-relaxed text-text-secondary">
              {t(`landing.faq.items.${key}.a`)}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
