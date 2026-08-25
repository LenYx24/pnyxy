// Pnyxy feedback relay: accepts a subject + body from the browser and
// sends it to the feedback inbox via Resend. Attaches the signed-in
// user's email + id when a session is present; anonymous is allowed.
// Env: RESEND_API_KEY, FEEDBACK_FROM, FEEDBACK_TO. See ../README.md.

import "../_shared/deno-shim.ts";
import { corsFor, handleOptions, json, jsonError as jsonErrorWith } from "../_shared/http.ts";
import { requireUser } from "../_shared/auth.ts";

const MAX_SUBJECT = 200;
const MAX_BODY = 10_000;

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
    return jsonError(
      502,
      "upstream_error",
      err instanceof Error ? err.message : "Resend request failed",
    );
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    console.error(`Resend returned ${upstream.status}: ${text}`);
    return jsonError(502, "upstream_error", `Resend error (${upstream.status})`);
  }

  return json(200, { ok: true }, corsHeaders);
});
