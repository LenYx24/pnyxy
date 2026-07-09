// Pnyxy — create a Stripe Checkout Session (subscription mode).
//
// The PlanTab "Upgrade" button calls this for the signed-in user. We:
//   1. Verify the caller is signed in and read their user id + email.
//   2. Reuse their existing Stripe customer if we already have one
//      (so repeat upgrades don't create duplicate customers).
//   3. Create a subscription Checkout Session via the Stripe REST API,
//      attaching our user_id as metadata on BOTH the session and the
//      resulting subscription (subscription_data[metadata]) so every
//      later webhook event can map back to this account.
//   4. Return { url } for the browser to redirect to Stripe's hosted,
//      PCI-compliant checkout page. We never touch card data.
//
// Env vars (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY — the `sk_...` secret key (test or live).
//   STRIPE_PRICE_ID   — the recurring Price id for Premium (`price_...`).
//   SITE_URL          — optional fallback origin for success/cancel URLs
//                       when the request doesn't carry a usable origin.
//   SUPABASE_URL / SUPABASE_ANON_KEY — provided by the platform.
//
// Left with the default `verify_jwt = true`; the Supabase gateway
// validates the caller's JWT and we re-read it to get the user id.

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed");
  }

  // ── Auth: require a signed-in user ─────────────────────────
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonError(401, "not_authenticated");
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError(500, "server_misconfigured");
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonError(401, "not_authenticated");
  }
  const user = userData.user;

  // ── Config ─────────────────────────────────────────────────
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  const priceId = Deno.env.get("STRIPE_PRICE_ID");
  if (!secretKey || !priceId) {
    return jsonError(500, "billing_not_configured");
  }

  // ── Resolve success/cancel origin ──────────────────────────
  let body: { origin?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine; we fall back to SITE_URL
  }
  const originCandidate =
    typeof body.origin === "string" && /^https?:\/\/\S+$/.test(body.origin)
      ? body.origin
      : Deno.env.get("SITE_URL") ?? "";
  const base = originCandidate.replace(/\/$/, "");
  if (!base) {
    return jsonError(500, "no_return_url");
  }
  const successUrl = `${base}/profile?checkout=success`;
  const cancelUrl = `${base}/profile?checkout=cancelled`;

  // Reuse an existing Stripe customer for this user if we have one, so
  // repeat checkouts don't spawn duplicate customers. RLS lets a user
  // read their own profile row.
  const { data: profile } = await userClient
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const existingCustomer = profile?.stripe_customer_id ?? null;

  // ── Create the Checkout Session (form-encoded REST call) ───
  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("client_reference_id", user.id);
  form.set("metadata[user_id]", user.id);
  // Propagate the id onto the subscription so every subscription.*
  // webhook event carries it without a customer lookup.
  form.set("subscription_data[metadata][user_id]", user.id);
  form.set("allow_promotion_codes", "true");
  if (existingCustomer) {
    form.set("customer", existingCustomer);
  } else if (user.email) {
    form.set("customer_email", user.email);
  }

  let stripeRes: Response;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    console.error("stripe-checkout: network error", err);
    return jsonError(502, "stripe_unreachable");
  }

  const data = await stripeRes.json();
  if (!stripeRes.ok || !data?.url) {
    console.error("stripe-checkout: stripe error", JSON.stringify(data));
    return jsonError(502, "stripe_error");
  }

  return new Response(JSON.stringify({ url: data.url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
