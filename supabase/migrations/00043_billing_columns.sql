-- ============================================================
-- Migration 00043: billing columns + tier-tampering protection
--
-- Adds the columns the Lemon Squeezy webhook will write when a
-- subscription is created / updated / cancelled, and — critically —
-- closes a privilege-escalation hole.
--
-- The "Users can update own profile" RLS policy (00001) is
-- `for update using (auth.uid() = id)` with no column scoping.
-- Postgres RLS is ROW-level, not column-level, so today a user could
-- run `UPDATE profiles SET storage_tier = 'premium' WHERE id = ...`
-- and grant themselves premium for free. Same risk now applies to
-- the billing columns below. We fix it with a trigger that reverts
-- any change to these columns unless the caller is the service role
-- (i.e. the webhook / admin tooling using the service key).
-- ============================================================

-- ── 1. Billing columns (written only by the webhook) ──────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_provider text,
  ADD COLUMN IF NOT EXISTS ls_customer_id        text,
  ADD COLUMN IF NOT EXISTS ls_subscription_id    text,
  ADD COLUMN IF NOT EXISTS subscription_status   text,
  ADD COLUMN IF NOT EXISTS current_period_end    timestamptz;

COMMENT ON COLUMN public.profiles.subscription_status IS
  'Lemon Squeezy subscription status (active, on_trial, past_due, cancelled, expired). Written by the webhook via the service role only.';

CREATE INDEX IF NOT EXISTS profiles_ls_subscription_idx
  ON public.profiles (ls_subscription_id);

-- ── 2. Protect tier + billing columns from self-service edits ──
--
-- Reverts (rather than rejects) protected-column changes for
-- non-service callers, so ordinary profile updates (display_name,
-- avatar_url, preferences, onboarded) keep working even if the
-- client payload echoes the protected fields back.

CREATE OR REPLACE FUNCTION protect_billing_columns()
RETURNS trigger AS $$
BEGIN
  -- Service role (webhook / admin) may change anything.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  NEW.storage_tier          := OLD.storage_tier;
  NEW.subscription_provider := OLD.subscription_provider;
  NEW.ls_customer_id        := OLD.ls_customer_id;
  NEW.ls_subscription_id    := OLD.ls_subscription_id;
  NEW.subscription_status   := OLD.subscription_status;
  NEW.current_period_end    := OLD.current_period_end;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS protect_billing_columns ON public.profiles;
CREATE TRIGGER protect_billing_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION protect_billing_columns();
