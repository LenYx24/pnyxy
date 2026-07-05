import { useTranslation } from "react-i18next";
import { Sparkles, Check, ExternalLink } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { cn } from "@/lib/cn";

/**
 * Plan / billing tab.
 *
 * Shows the user's current tier and, for free users, an "Upgrade"
 * button that opens the Lemon Squeezy hosted checkout. We attach the
 * user's id as `checkout[custom][user_id]` so the webhook
 * (supabase/functions/lemonsqueezy-webhook) can map the resulting
 * subscription back to this account, and prefill their email.
 *
 * The checkout base URL comes from VITE_LEMONSQUEEZY_CHECKOUT_URL,
 * e.g. https://pnyxy.lemonsqueezy.com/buy/<variant-uuid>
 * If it's unset (e.g. before the LS account exists) the button shows a
 * "coming soon" state instead of a dead link.
 */
function buildCheckoutUrl(userId: string, email: string | null): string | null {
  const base = import.meta.env.VITE_LEMONSQUEEZY_CHECKOUT_URL as
    | string
    | undefined;
  if (!base) return null;
  const url = new URL(base);
  url.searchParams.set("checkout[custom][user_id]", userId);
  if (email) url.searchParams.set("checkout[email]", email);
  return url.toString();
}

const PREMIUM_FEATURE_KEYS = [
  "largerQuota",
  "moreStorage",
  "betterModels",
  "prioritySupport",
] as const;

export function PlanTab() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);

  const tier = profile?.storage_tier ?? "free";
  const isPremium = tier === "premium";

  const checkoutUrl = user ? buildCheckoutUrl(user.id, user.email ?? null) : null;

  return (
    <div className="space-y-6">
      <section className="space-y-4 sm:rounded-xl sm:border sm:border-glass-border sm:bg-glass-bg/50 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
            <Sparkles size={20} className="text-accent" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-text-primary">
              {t("settings.plan_section.heading")}
            </h2>
            <p className="text-xs text-text-muted">
              {isPremium
                ? t("settings.plan_section.currentPremium")
                : t("settings.plan_section.currentFree")}
            </p>
          </div>
          <span
            className={cn(
              "ml-auto rounded-full px-3 py-1 text-xs font-semibold",
              isPremium
                ? "bg-accent/15 text-accent"
                : "bg-glass-bg text-text-secondary",
            )}
          >
            {isPremium ? t("settings.plan_section.premiumBadge") : t("settings.plan_section.freeBadge")}
          </span>
        </div>

        {isPremium ? (
          <div className="rounded-lg border border-glass-border bg-glass-bg/50 p-4">
            <p className="text-sm text-text-secondary">
              {t("settings.plan_section.manageHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <ul className="space-y-2">
              {PREMIUM_FEATURE_KEYS.map((key) => (
                <li
                  key={key}
                  className="flex items-start gap-2 text-sm text-text-secondary"
                >
                  <Check size={16} className="mt-0.5 shrink-0 text-accent" />
                  {t(`settings.plan_section.features.${key}`)}
                </li>
              ))}
            </ul>

            {checkoutUrl ? (
              <a
                href={checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
              >
                <Sparkles size={15} />
                {t("settings.plan_section.upgradeButton")}
                <ExternalLink size={14} className="opacity-70" />
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-4 py-2.5 text-sm font-semibold text-text-muted"
              >
                {t("settings.plan_section.comingSoon")}
              </button>
            )}
            <p className="text-xs text-text-muted">
              {t("settings.plan_section.securedBy")}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
