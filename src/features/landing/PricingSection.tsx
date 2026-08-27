import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";
import { SectionHeading } from "./SectionHeading";

/**
 * Pricing section. Free plan reflects today's reality; Premium is the
 * paid tier. Solid panels (no glass/blur); the Premium card is lifted
 * with an accent hairline + a faint accent top-glow so the eye lands
 * on it.
 */
export function PricingSection() {
  const { t } = useTranslation();

  const freeFeatures = t("landing.pricing.free.features", {
    returnObjects: true,
  }) as string[];
  const premiumFeatures = t("landing.pricing.premium.features", {
    returnObjects: true,
  }) as string[];

  return (
    <section
      id="pricing"
      className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20"
    >
      <SectionHeading
        eyebrow={t("landing.eyebrow.pricing")}
        title={t("landing.pricing.title")}
        subtitle={t("landing.pricing.subtitle")}
      />

      <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-2">
        {/* Free */}
        <div className="flex flex-col rounded-xl border border-glass-border bg-bg-secondary p-6">
          <div className="mb-4">
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {t("landing.pricing.free.name")}
            </h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display text-3xl font-bold text-text-primary">
                {t("landing.pricing.free.price")}
              </span>
              <span className="text-sm text-text-muted">
                {t("landing.pricing.free.priceSuffix")}
              </span>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {t("landing.pricing.free.tagline")}
            </p>
          </div>
          <ul className="flex-1 space-y-2">
            {freeFeatures.map((f, i) => (
              <FeatureRow key={i} text={f} />
            ))}
          </ul>
        </div>

        {/* Premium: highlighted */}
        <div className="relative flex flex-col overflow-hidden rounded-xl border border-accent/40 bg-bg-secondary p-6">
          {/* faint accent top-glow */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{
              background:
                "radial-gradient(ellipse 70% 100% at 50% 0%, rgba(8,145,178,0.14), transparent)",
            }}
          />
          <span className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-white">
            <Sparkles size={12} />
            {t("landing.pricing.premium.comingSoon")}
          </span>
          <div className="relative mb-4">
            <h3 className="font-display text-lg font-semibold text-text-primary">
              {t("landing.pricing.premium.name")}
            </h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="font-display text-3xl font-bold text-text-primary">
                {t("landing.pricing.premium.price")}
              </span>
              <span className="text-sm text-text-muted">
                {t("landing.pricing.premium.priceSuffix")}
              </span>
            </div>
            {/* explicit "this tier costs money" note so nobody mistakes
                Premium for another free plan */}
            <span className="mt-2 inline-flex w-fit items-center rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide text-accent">
              {t("landing.pricing.premium.paidNote")}
            </span>
            <p className="mt-2 text-xs text-text-muted">
              {t("landing.pricing.premium.tagline")}
            </p>
          </div>
          <ul className="relative flex-1 space-y-2">
            {premiumFeatures.map((f, i) => (
              <FeatureRow key={i} text={f} />
            ))}
          </ul>
        </div>
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-text-muted">
        {t("landing.pricing.footnote")}
      </p>
    </section>
  );
}

function FeatureRow({ text }: { text: string }) {
  return (
    <li className="flex items-start gap-2">
      <Check size={16} className="mt-0.5 shrink-0 text-accent" />
      <span className="text-sm text-text-secondary">{text}</span>
    </li>
  );
}
