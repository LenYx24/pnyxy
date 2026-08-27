// Pnyxy feedback relay: accepts a subject + body from the browser and
// sends it to the feedback inbox via Resend. Attaches the signed-in
// user's email + id when a session is present; anonymous is allowed
// but rate limited more tightly since it can't be tied to an account.
// Env: RESEND_API_KEY, FEEDBACK_FROM, FEEDBACK_TO, IP_HASH_SALT (only
// needed for anonymous senders). See ../README.md.

import "../_shared/deno-shim.ts";
import {
  corsFor,
  handleOptions,
  json,
  jsonError as jsonErrorWith,
  jsonErrorPublic as jsonErrorPublicWith,
  sanitizeErrorForClient,
} from "../_shared/http.ts";
import { requireUser, serviceClient } from "../_shared/auth.ts";
import { getClientIp, hashIp, ipHashSalt } from "../_shared/tokens.ts";

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;
const AUTHED_DAILY_LIMIT = 10;
const ANON_DAILY_LIMIT = 2;
// No derivable client IP: fall into one shared bucket instead of
// skipping the rate limit outright.
const NO_IP_SENTINEL = "no-ip";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);
  const jsonError = (status: number, code: string, message: string): Response =>
    jsonErrorWith(status, code, message, corsHeaders);
  const jsonErrorPublic = (status: number, code: string): Response =>
    jsonErrorPublicWith(status, code, corsHeaders);

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST only");
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return jsonError(500, "misconfigured", "RESEND_API_KEY not set");
  }
  const from = Deno.env.get("FEEDBACK_FROM") ??
    "Pnyxy Feedback <onboarding@resend.dev>";
  const to = Deno.env.get("FEEDBACK_TO") ?? "feedback@pnyxy.com";

  let body: { subject?: unknown; body?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const message = typeof body.body === "string" ? body.body.trim() : "";
  if (!subject || !message) {
    return jsonError(400, "bad_request", "subject and body are required");
  }
  if (subject.length > MAX_SUBJECT) {
    return jsonError(400, "subject_too_long", `Subject exceeds ${MAX_SUBJECT} chars`);
  }
  if (message.length > MAX_BODY) {
    return jsonError(400, "body_too_long", `Body exceeds ${MAX_BODY} chars`);
  }

  // Try to attribute to signed-in user so we can reply. Anonymous is OK.
  let userEmail: string | null = null;
  let userId: string | null = null;
  const auth = await requireUser(req, {
    onError: () => new Response(null, { status: 401 }),
  });
  if (auth.ok) {
    userEmail = auth.user.email ?? null;
    userId = auth.user.id;
  }

  // ── Rate limit: 10/day for a signed-in user, 2/day for anonymous
  // senders keyed by a salted hash of their IP. Anonymous feedback
  // needs IP_HASH_SALT set to be rate limited safely; without it
  // there's no way to bucket anonymous senders, so they're rejected
  // rather than left unlimited. ──
  const admin = serviceClient();
  if (!admin) {
    console.error("send-feedback: service client unavailable, missing SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY");
    return jsonErrorPublic(500, "misconfigured");
  }

  let rateKey: string;
  let rateLimit: number;
  if (userId) {
    rateKey = `feedback:${userId}`;
    rateLimit = AUTHED_DAILY_LIMIT;
  } else {
    let salt: string;
    try {
      salt = ipHashSalt();
    } catch {
      return jsonError(403, "sign_in_required", "Sign in to send feedback.");
    }
    const ip = getClientIp(req) ?? NO_IP_SENTINEL;
    rateKey = `feedback:${await hashIp(ip, salt)}`;
    rateLimit = ANON_DAILY_LIMIT;
  }

  const { data: withinLimit, error: rateLimitErr } = await admin.rpc("bump_rate_limit", {
    p_key: rateKey,
    p_limit: rateLimit,
  });
  if (rateLimitErr) {
    console.error("send-feedback: bump_rate_limit rpc failed", rateLimitErr);
    return jsonErrorPublic(500, sanitizeErrorForClient(rateLimitErr));
  }
  if (!withinLimit) {
    return jsonError(429, "rate_limited", "You've hit today's feedback limit, try again tomorrow.");
  }

  const attribution = userEmail
    ? `From: ${userEmail} (${userId})`
    : "From: anonymous (not signed in)";

  const textBody = `${attribution}\n\n${message}`;
  const htmlBody = `
    <p style="color:#666;font-size:12px;margin:0 0 16px">${escapeHtml(attribution)}</p>
    <div style="white-space:pre-wrap;font-family:system-ui,sans-serif;font-size:14px;line-height:1.6">${escapeHtml(message)}</div>
  `;

  const resendPayload: Record<string, unknown> = {
    from,
    to: [to],
    subject: `[Pnyxy Feedback] ${subject}`,
    text: textBody,
    html: htmlBody,
  };
  if (userEmail) {
    resendPayload.reply_to = userEmail;
  }

  let upstream: Response;
  try {
    upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendPayload),
    });
  } catch (err) {
    // Never echo the raw error to the client (it can carry network /
    // internal details); log it server-side instead.
    console.error("send-feedback: resend request failed", err);
    return jsonErrorPublic(502, sanitizeErrorForClient(err));
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(`Resend returned ${upstream.status}: ${text}`);
    return jsonError(502, "upstream_error", `Resend error (${upstream.status})`);
  }

  return json(200, { ok: true }, corsHeaders);
});
