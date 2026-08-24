// Pnyxy: Stripe (Managed Payments) subscription webhook.
//
// Stripe is our Merchant of Record via Managed Payments: it sells to
// the end customer, collects + remits VAT/sales tax worldwide, handles
// disputes, and notifies us here when a subscription changes. We
// translate those events into the only thing the app cares about:
// `profiles.storage_tier` ('free' | 'premium') plus a few billing
// bookkeeping columns.
//
// Flow:
//   1. Verify the request really came from Stripe. Stripe signs the
//      RAW body: the `Stripe-Signature` header carries `t=<unix>` and
//      one or more `v1=<hex>` signatures, where the signed payload is
//      `${t}.${rawBody}` HMAC-SHA256'd with STRIPE_WEBHOOK_SECRET. We
//      also reject stale timestamps (replay protection).
//   2. Read `event.type` + `event.data.object`.
//   3. Resolve which of OUR users this is: prefer `metadata.user_id`
//      (we attach it on the Checkout Session AND propagate it onto the
//      subscription via subscription_data, see stripe-checkout), and
//      fall back to a lookup by stripe_customer_id.
//   4. Upsert the tier + status with the SERVICE ROLE, which bypasses
//      RLS and the `protect_billing_columns` trigger (migration 00049).
//
// Env vars (set via `supabase secrets set`):
//   STRIPE_WEBHOOK_SECRET     - the `whsec_...` signing secret Stripe
//                               shows when you create the webhook
//                               endpoint in the dashboard.
//   SUPABASE_URL              - provided by the platform.
//   SUPABASE_SERVICE_ROLE_KEY - provided by the platform; service key
//                               so we may write the protected columns.
//
// Configure `verify_jwt = false` for this function (config.toml): the
// caller is Stripe, not a signed-in user, so there is no JWT.

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

// Stripe subscription statuses that should keep premium access.
// `active`/`trialing` are obvious; `past_due` is the grace period while
// Stripe retries the card (Smart Retries), we keep access rather than
// yanking premium the instant a renewal fails. Everything else
// (`canceled`, `unpaid`, `incomplete`, `incomplete_expired`) → free.
// A subscription set to cancel at period end stays `active` until it
// actually lapses, at which point `customer.subscription.deleted`
// arrives with status `canceled` and flips us back.
const PREMIUM_STATUSES = new Set(["active", "trialing", "past_due"]);

// How far the signature timestamp may drift from now, in seconds.
// Matches Stripe's own default tolerance.
const TOLERANCE_SECONDS = 5 * 60;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time hex string comparison so we don't leak signature bytes
// via early-exit timing.
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Parse a Stripe-Signature header: "t=1699999999,v1=abc...,v1=def..."
function parseStripeSignature(header: string): { t: string; v1: string[] } {
  const v1: string[] = [];
  let t = "";
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t") t = val;
    else if (key === "v1" && val) v1.push(val);
  }
  return { t, v1 };
}

// Stripe sends ids as bare strings on these events, but can send the
// expanded object; normalise to the id string either way.
function idOf(field: unknown): string | null {
  if (typeof field === "string") return field;
  if (field && typeof field === "object" && "id" in field) {
    const id = (field as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

interface StripeObject {
  id?: string;
  status?: string;
  mode?: string;
  customer?: unknown;
  subscription?: unknown;
  current_period_end?: number;
  client_reference_id?: string;
  metadata?: { user_id?: string };
}

// The Deno esm.sh Supabase import is untyped; this captures just the query
// surface used below, so we stay off `any` (our ESLint config forbids it).
type DbResult = {
  data?: { id?: string } | null;
  error?: { message: string } | null;
};
interface AdminQuery extends PromiseLike<DbResult> {
  select(columns: string): AdminQuery;
  update(values: Record<string, unknown>): AdminQuery;
  eq(column: string, value: string): AdminQuery;
  maybeSingle(): Promise<DbResult>;
}
interface Admin {
  from(table: string): AdminQuery;
}

async function resolveUserId(
  admin: Admin,
  obj: StripeObject,
): Promise<string | null> {
  const fromMeta = obj.metadata?.user_id || obj.client_reference_id;
  if (fromMeta) return fromMeta;
  // Fall back to a lookup by customer, covers subscription events where
  // metadata somehow didn't propagate.
  const customerId = idOf(obj.customer);
  if (customerId) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();
    if (data?.id) return data.id as string;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) {
    return json(500, { error: "misconfigured", detail: "secret not set" });
  }

  // Signature is over the RAW body, so read text (not req.json()).
  const raw = await req.text();
  const sigHeader = req.headers.get("Stripe-Signature") ?? "";
  const { t, v1 } = parseStripeSignature(sigHeader);
  if (!t || v1.length === 0) {
    return json(401, { error: "invalid_signature" });
  }

  // Replay protection: reject timestamps outside the tolerance window.
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(Number(t)) || Math.abs(nowSec - Number(t)) > TOLERANCE_SECONDS) {
    return json(401, { error: "timestamp_out_of_tolerance" });
  }

  const expected = await hmacSha256Hex(secret, `${t}.${raw}`);
  const signatureOk = v1.some((s) => timingSafeEqualHex(s, expected));
  if (!signatureOk) {
    return json(401, { error: "invalid_signature" });
  }

  let event: { type?: string; data?: { object?: StripeObject } };
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_json" });
  }

  const type = event.type ?? "";
  const obj = event.data?.object ?? {};

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  // Build the profile patch for the events we act on. Anything else is
  // acknowledged with 200 so Stripe stops retrying it.
  let patch: Record<string, unknown> | null = null;

  switch (type) {
    case "checkout.session.completed": {
      // Only subscription checkouts matter here.
      if (obj.mode && obj.mode !== "subscription") break;
      patch = {
        storage_tier: "premium",
        subscription_status: "active",
        stripe_customer_id: idOf(obj.customer),
        stripe_subscription_id: idOf(obj.subscription),
      };
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const status = obj.status ?? "";
      const tier = PREMIUM_STATUSES.has(status) ? "premium" : "free";
      patch = {
        storage_tier: tier,
        subscription_status: status,
        stripe_customer_id: idOf(obj.customer),
        stripe_subscription_id: obj.id ?? null,
        current_period_end:
          typeof obj.current_period_end === "number"
            ? new Date(obj.current_period_end * 1000).toISOString()
            : null,
      };
      break;
    }
    default:
      return json(200, { ok: true, ignored: type });
  }

  if (!patch) {
    return json(200, { ok: true, ignored: type });
  }

  const userId = await resolveUserId(admin, obj);
  if (!userId) {
    // Without our user id we can't map the subscription. Log loudly;
    // 200 so Stripe stops retrying (retrying won't add the missing id).
    console.error(`stripe-webhook: ${type} could not resolve user_id`);
    return json(200, { ok: false, reason: "no_user_id" });
  }

  const { error } = await admin
    .from("profiles")
    .update({ subscription_provider: "stripe", ...patch })
    .eq("id", userId);

  if (error) {
    console.error(`stripe-webhook: db update failed: ${error.message}`);
    // 500 so Stripe retries, the update is idempotent, safe to repeat.
    return json(500, { error: "db_update_failed" });
  }

  console.log(
    `stripe-webhook: ${type} -> user ${userId} tier=${patch.storage_tier} status=${patch.subscription_status}`,
  );
  return json(200, { ok: true, tier: patch.storage_tier });
});
