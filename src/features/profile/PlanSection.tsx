import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Sparkles, Check, Loader2, Settings2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/cn";

/**
 * Plan / billing card, rendered on the Profile page.
 *
 * Free users get an "Upgrade" button that opens a Stripe Checkout
 * Session (via the `stripe-checkout` edge function); premium users get
 * a "Manage subscription" button that opens the Stripe Billing Customer
 * Portal (via `stripe-portal`) where they can cancel, switch plan, or
 * update their card. The `stripe-webhook` flips the tier on both sides.
 *
 * Gated behind VITE_BILLING_ENABLED so the button shows a "coming soon"
 * state until billing is switched on.
 *
 * On return from Stripe (`?checkout=success`) we re-fetch the profile a
 * few times, since the webhook that grants premium may land a moment
 * after the browser redirect.
 */
const BILLING_ENABLED =
  (import.meta.env.VITE_BILLING_ENABLED as string | undefined) === "true";

const PREMIUM_FEATURE_KEYS = [
  "largerQuota",
  "moreStorage",
  "betterModels",
  "prioritySupport",
] as const;

export function PlanSection() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);

  const [starting, setStarting] = useState(false);
  const [managing, setManaging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const justReturned = searchParams.get("checkout") === "success";

  const tier = profile?.storage_tier ?? "free";
  const isPremium = tier === "premium";

  // After a successful checkout, poll the profile a few times so the UI
  // flips to Premium as soon as the webhook lands (usually seconds).
  useEffect(() => {
    if (!justReturned || isPremium) return;
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      tries += 1;
      void fetchProfile();
      if (tries < 6) window.setTimeout(tick, 2500);
    };
    const handle = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [justReturned, isPremium, fetchProfile]);

  // Clear the checkout query param once we've flipped to Premium.
  useEffect(() => {
    if (justReturned && isPremium) {
      searchParams.delete("checkout");
      setSearchParams(searchParams, { replace: true });
    }
  }, [justReturned, isPremium, searchParams, setSearchParams]);

  const handleUpgrade = async () => {
    if (!user || starting) return;
    setError(null);
    setStarting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "stripe-checkout",
        { body: { origin: window.location.origin } },
      );
      if (fnError || !data?.url) {
        throw fnError ?? new Error("no_checkout_url");
      }
      window.location.href = data.url as string;
    } catch (err) {
      logError("PlanSection:checkout", err);
      setError(t("settings.plan_section.checkoutError"));
      setStarting(false);
    }
  };

  const handleManage = async () => {
    if (!user || managing) return;
    setError(null);
    setManaging(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "stripe-portal",
        { body: { origin: window.location.origin } },
      );
      if (fnError || !data?.url) {
        throw fnError ?? new Error("no_portal_url");
      }
      window.location.href = data.url as string;
    } catch (err) {
      logError("PlanSection:portal", err);
      setError(t("settings.plan_section.checkoutError"));
      setManaging(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
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
          {isPremium
            ? t("settings.plan_section.premiumBadge")
            : t("settings.plan_section.freeBadge")}
        </span>
      </div>

      {isPremium ? (
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            {t("settings.plan_section.manageHint")}
          </p>
          {BILLING_ENABLED && (
            <button
              type="button"
              onClick={handleManage}
              disabled={managing}
              className="inline-flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:bg-glass-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {managing ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t("settings.plan_section.openingPortal")}
                </>
              ) : (
                <>
                  <Settings2 size={15} />
                  {t("settings.plan_section.manageButton")}
                </>
              )}
            </button>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
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

          {justReturned && (
            <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-xs text-text-secondary">
              {t("settings.plan_section.processingUpgrade")}
            </p>
          )}

          {BILLING_ENABLED ? (
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={starting || !user}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {starting ? (
                <>
                  <Loader2 size={15} className="animate-spin" />
                  {t("settings.plan_section.startingCheckout")}
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  {t("settings.plan_section.upgradeButton")}
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg border border-glass-border bg-glass-bg px-4 py-2.5 text-sm font-semibold text-text-muted"
            >
              {t("settings.plan_section.comingSoon")}
            </button>
          )}

          {error && <p className="text-xs text-danger">{error}</p>}

          <p className="text-xs text-text-muted">
            {t("settings.plan_section.securedBy")}
          </p>
        </div>
      )}
    </section>
  );
}
