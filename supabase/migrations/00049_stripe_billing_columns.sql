-- ============================================================
-- Migration 00049: Stripe billing columns
--
-- Migrates the Merchant-of-Record from Lemon Squeezy to Stripe
-- Managed Payments. Adds Stripe identifier columns ALONGSIDE the
-- existing ls_* columns (kept, non-destructive — no live LS subs, but
-- nothing should break for any legacy row) and extends the
-- `protect_billing_columns` trigger from 00043 to guard them too, so a
-- user still can't self-grant premium by echoing these columns back on
-- a profile update. Only the service-role webhook may write them.
-- ============================================================

-- ── 1. Stripe identifier columns (written only by the webhook) ──

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id     text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

COMMENT ON COLUMN public.profiles.subscription_status IS
  'Subscription status from the active provider (Stripe: active, trialing, past_due, canceled, unpaid, incomplete, incomplete_expired). Written by the webhook via the service role only.';

CREATE INDEX IF NOT EXISTS profiles_stripe_customer_idx
  ON public.profiles (stripe_customer_id);
CREATE INDEX IF NOT EXISTS profiles_stripe_subscription_idx
  ON public.profiles (stripe_subscription_id);

-- ── 2. Extend the tamper-protection trigger to the new columns ──
--
-- Same reasoning as 00043: RLS is row-level, so without this a user
-- could UPDATE their own profile and set stripe_* / storage_tier
-- directly. We revert (not reject) protected-column changes for
-- non-service callers so ordinary profile updates keep working.

CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS trigger AS $$
BEGIN
  -- Service role (webhook / admin) may change anything.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.storage_tier           := OLD.storage_tier;
  NEW.subscription_provider  := OLD.subscription_provider;
  NEW.ls_customer_id         := OLD.ls_customer_id;
  NEW.ls_subscription_id     := OLD.ls_subscription_id;
  NEW.stripe_customer_id     := OLD.stripe_customer_id;
  NEW.stripe_subscription_id := OLD.stripe_subscription_id;
  NEW.subscription_status    := OLD.subscription_status;
  NEW.current_period_end     := OLD.current_period_end;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger from 00043 references this function by name, so replacing the
-- function above is enough — no need to recreate the trigger.
