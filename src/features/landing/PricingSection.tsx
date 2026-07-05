import { useTranslation } from "react-i18next";
import { Check, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * Pricing section. Free plan reflects today's reality, core
 * features all free. Premium is a "coming soon" teaser listing the
 * features most likely to ship behind a subscription: AI quota
 * uplift, more storage, OCR, X-Ray, cross-device sync. No price is
 * shown yet because there isn't one. Keeps honest expectations.
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
      className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24"
    >
      <h2 className="mb-4 text-center text-3xl font-bold text-text-primary">
        {t("landing.pricing.title")}
      </h2>
      <p className="mx-auto mb-12 max-w-2xl text-center text-text-secondary">
        {t("landing.pricing.subtitle")}
      </p>

      <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
        <GlassCard className="flex flex-col p-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-text-primary">
              {t("landing.pricing.free.name")}
            </h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-text-primary">
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
        </GlassCard>

        <GlassCard
          className={cn(
            "relative flex flex-col p-6",
            "border-accent/30",
          )}
        >
          <span className="absolute -top-3 right-4 flex items-center gap-1 rounded-full bg-accent/20 px-3 py-1 text-xs font-medium text-accent">
            <Sparkles size={12} />
            {t("landing.pricing.premium.comingSoon")}
          </span>
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-text-primary">
              {t("landing.pricing.premium.name")}
            </h3>
            <div className="mt-2 flex items-baseline gap-1">
              <span className="text-3xl font-bold text-text-secondary">
                {t("landing.pricing.premium.price")}
              </span>
              <span className="text-sm text-text-muted">
                {t("landing.pricing.premium.priceSuffix")}
              </span>
            </div>
            <p className="mt-2 text-xs text-text-muted">
              {t("landing.pricing.premium.tagline")}
            </p>
          </div>
          <ul className="flex-1 space-y-2">
            {premiumFeatures.map((f, i) => (
              <FeatureRow key={i} text={f} muted />
            ))}
          </ul>
        </GlassCard>
      </div>

      <p className="mx-auto mt-6 max-w-2xl text-center text-xs text-text-muted">
        {t("landing.pricing.footnote")}
      </p>
    </section>
  );
}

function FeatureRow({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <Check
        size={16}
        className={cn(
          "mt-0.5 shrink-0",
          muted ? "text-text-muted" : "text-accent",
        )}
      />
      <span
        className={cn(
          "text-sm",
          muted ? "text-text-muted" : "text-text-secondary",
        )}
      >
        {text}
      </span>
    </li>
  );
}
