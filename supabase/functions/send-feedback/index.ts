// Pnyxy feedback relay.
//
// Accepts a subject + body from the browser and sends it to the
// feedback inbox via Resend. Optionally attaches the signed-in user's
// email + id to the message so we can reply.
//
// Env vars (set via `supabase secrets set`):
//   RESEND_API_KEY    - required; from https://resend.com/api-keys
//   FEEDBACK_FROM     - "Name <sender@verified-domain>" (default:
//                       "Pnyxy Feedback <onboarding@resend.dev>", the
//                       Resend sandbox; swap for your verified domain)
//   FEEDBACK_TO       - destination inbox (default: feedback@pnyxy.com)

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

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
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
  const authHeader = req.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ") && authHeader.length > "Bearer ".length) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const client = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data } = await client.auth.getUser();
    if (data?.user) {
      userEmail = data.user.email ?? null;
      userId = data.user.id;
    }
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

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
