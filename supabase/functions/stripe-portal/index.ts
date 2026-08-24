// Pnyxy: create a Stripe Billing Customer Portal session.
//
// The "Manage / cancel subscription" button calls this for a signed-in
// premium user. We:
//   1. Verify the caller is signed in and read their user id.
//   2. Look up their stripe_customer_id (written by the webhook).
//   3. Create a Billing Portal session via the Stripe REST API and
//      return { url } for the browser to redirect to.
//
// The portal lets the user cancel, switch plan, update their card, and
// view invoices, all hosted by Stripe. On cancel, Stripe fires
// customer.subscription.updated / .deleted, which our stripe-webhook
// already translates back into storage_tier='free'. Nothing else to do.
//
// NOTE: the Customer Portal must be enabled/configured once in the
// Stripe dashboard (Settings → Billing → Customer portal), otherwise
// the API returns an error about no configuration.
//
// Env vars (set via `supabase secrets set`):
//   STRIPE_SECRET_KEY - the `sk_...` secret key (test or live).
//   SITE_URL          - optional fallback origin for the return URL.
//   SUPABASE_URL / SUPABASE_ANON_KEY - provided by the platform.

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

  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return jsonError(500, "billing_not_configured");
  }

  // ── Look up the Stripe customer for this user ──────────────
  const { data: profile } = await userClient
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();
  const customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    return jsonError(400, "no_customer");
  }

  // ── Resolve return origin ──────────────────────────────────
  let body: { origin?: string } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine; fall back to SITE_URL
  }
  const originCandidate =
    typeof body.origin === "string" && /^https?:\/\/\S+$/.test(body.origin)
      ? body.origin
      : Deno.env.get("SITE_URL") ?? "";
  const base = originCandidate.replace(/\/$/, "");
  if (!base) {
    return jsonError(500, "no_return_url");
  }

  // ── Create the portal session (form-encoded REST call) ─────
  const form = new URLSearchParams();
  form.set("customer", customerId);
  form.set("return_url", `${base}/profile`);

  let stripeRes: Response;
  try {
    stripeRes = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
  } catch (err) {
    console.error("stripe-portal: network error", err);
    return jsonError(502, "stripe_unreachable");
  }

  const data = await stripeRes.json();
  if (!stripeRes.ok || !data?.url) {
    console.error("stripe-portal: stripe error", JSON.stringify(data));
    return jsonError(502, "stripe_error");
  }

  return new Response(JSON.stringify({ url: data.url }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
