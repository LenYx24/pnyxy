// Pnyxy: create a Stripe Billing Customer Portal session for the
// signed-in premium user (cancel / switch plan / update card / invoices,
// all hosted by Stripe). Returns { url }. Requires the portal to be
// configured once in the Stripe dashboard. Env: STRIPE_SECRET_KEY,
// SITE_URL. See ../README.md.

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

  return json(200, { url: data.url }, corsHeaders);
});
