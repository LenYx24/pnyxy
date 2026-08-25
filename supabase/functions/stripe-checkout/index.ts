// Pnyxy: create a Stripe Checkout Session (subscription mode) for the
// signed-in user, reusing their Stripe customer when known and tagging
// session + subscription metadata with user_id so webhooks map back.
// Returns { url }. Env: STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SITE_URL.
// See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);
  const jsonError = (status: number, message: string): Response =>
    json(status, { error: message }, corsHeaders);

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed");
  }

  // ── Auth: require a signed-in user ─────────────────────────
  const auth = await requireUser(req, {
    persistSession: false,
    onError: (reason) =>
      reason === "misconfigured"
        ? jsonError(500, "server_misconfigured")
        : jsonError(401, "not_authenticated"),
  });
  if (!auth.ok) return auth.response;
  const { user, client: userClient } = auth;

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

  return json(200, { url: data.url }, corsHeaders);
});
