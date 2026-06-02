// Pnyxy — Lemon Squeezy subscription webhook.
//
// Lemon Squeezy is our Merchant of Record: it sells to the end
// customer, collects + remits VAT/sales tax worldwide, and notifies
// us here when a subscription changes. We translate those events into
// the only thing the app cares about: `profiles.storage_tier`
// ('free' | 'premium') plus a few billing bookkeeping columns.
//
// Flow:
//   1. Verify the request really came from Lemon Squeezy (HMAC-SHA256
//      of the RAW body against LEMONSQUEEZY_WEBHOOK_SECRET).
//   2. Read meta.event_name + data.attributes.status.
//   3. Resolve which of OUR users this is via meta.custom_data.user_id
//      (we attach it on the checkout URL — see PlanTab.tsx).
//   4. Upsert the tier + status with the SERVICE ROLE, which bypasses
//      RLS and the `protect_billing_columns` trigger (migration 00043).
//
// Env vars (set via `supabase secrets set`):
//   LEMONSQUEEZY_WEBHOOK_SECRET — the signing secret you typed when
//                                 creating the webhook in LS settings.
//   SUPABASE_URL                — provided by the platform.
//   SUPABASE_SERVICE_ROLE_KEY   — provided by the platform; service key
//                                 so we may write the protected columns.
//
// Configure `verify_jwt = false` for this function (config.toml): the
// caller is Lemon Squeezy, not a signed-in user, so there is no JWT.

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

// Lemon Squeezy subscription statuses that should grant premium.
// `cancelled` keeps access until the period ends — LS sends a separate
// `expired` event when it actually lapses, which flips us back to free.
const PREMIUM_STATUSES = new Set([
  "active",
  "on_trial",
  "past_due", // grace period — keep access while LS retries payment
  "cancelled", // still valid until current_period_end
]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Constant-time hex string comparison so we don't leak signature
// bytes via early-exit timing.
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

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const secret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET");
  if (!secret) {
    return json(500, { error: "misconfigured", detail: "secret not set" });
  }

  // The signature is computed over the RAW body, so read text (not
  // req.json()) and parse manually afterwards.
  const raw = await req.text();
  const signature = req.headers.get("X-Signature") ?? "";
  const expected = await hmacSha256Hex(secret, raw);
  if (!signature || !timingSafeEqualHex(signature, expected)) {
    return json(401, { error: "invalid_signature" });
  }

  let payload: {
    meta?: { event_name?: string; custom_data?: { user_id?: string } };
    data?: {
      id?: string;
      attributes?: {
        status?: string;
        customer_id?: number | string;
        renews_at?: string | null;
        ends_at?: string | null;
      };
    };
  };
  try {
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "bad_json" });
  }

  const eventName = payload.meta?.event_name ?? "";
  // We only act on subscription_* events; acknowledge the rest with 200
  // so Lemon Squeezy doesn't retry them.
  if (!eventName.startsWith("subscription_")) {
    return json(200, { ok: true, ignored: eventName });
  }

  const userId = payload.meta?.custom_data?.user_id;
  if (!userId) {
    // Without our user_id we can't map the subscription. Log loudly;
    // 200 so LS stops retrying (retrying won't add the missing id).
    console.error(
      `lemonsqueezy-webhook: ${eventName} missing custom_data.user_id`,
    );
    return json(200, { ok: false, reason: "no_user_id" });
  }

  const attrs = payload.data?.attributes ?? {};
  const status = attrs.status ?? "";
  const tier = PREMIUM_STATUSES.has(status) ? "premium" : "free";
  // `renews_at` for active subs; `ends_at` once cancelled/expired.
  const periodEnd = attrs.renews_at ?? attrs.ends_at ?? null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { error } = await admin
    .from("profiles")
    .update({
      storage_tier: tier,
      subscription_provider: "lemonsqueezy",
      ls_customer_id: attrs.customer_id != null ? String(attrs.customer_id) : null,
      ls_subscription_id: payload.data?.id ?? null,
      subscription_status: status,
      current_period_end: periodEnd,
    })
    .eq("id", userId);

  if (error) {
    console.error(`lemonsqueezy-webhook: db update failed: ${error.message}`);
    // 500 so LS retries — the update is idempotent, safe to repeat.
    return json(500, { error: "db_update_failed" });
  }

  console.log(
    `lemonsqueezy-webhook: ${eventName} -> user ${userId} tier=${tier} status=${status}`,
  );
  return json(200, { ok: true, tier });
});
