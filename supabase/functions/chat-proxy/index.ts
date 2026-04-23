// Pnyxy standalone LLM chat proxy.
//
// Same shape as ai-chat-proxy but without PDF/book context — accepts
// a linear conversation (already flattened from the tree by the
// client) and streams a response via SSE. OpenAI first, Anthropic
// fallback. Quotas + auth match ai-chat-proxy.

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;
const HARD_MAX_OUTPUT_TOKENS = 4096;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const sseHeaders = {
  ...corsHeaders,
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip");
}

interface QuotaResult {
  allowed: boolean;
  reason: string | null;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

interface ChatRequestBody {
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Optional system prompt prepended to the conversation. */
  systemPrompt?: string;
  maxOutputTokens?: number;
}

const DEFAULT_SYSTEM = `You are Pnyxy's standalone chat assistant. You help the user think through topics, write drafts, answer questions, and reason across long-running conversations. Be concise by default; expand when the user asks for detail.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST only");
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!openaiKey && !anthropicKey) {
    return jsonError(500, "misconfigured", "No upstream AI provider key configured");
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return jsonError(400, "bad_request", "messages required");
  }

  const maxOutputTokens = Math.min(
    Math.max(body.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, 1),
    HARD_MAX_OUTPUT_TOKENS,
  );

  const systemPrompt = (body.systemPrompt ?? DEFAULT_SYSTEM).trim();
  const inputTokens =
    estimateTokens(systemPrompt) +
    body.messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  const estimatedTotal = inputTokens + maxOutputTokens;

  // ── Quota ──
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  let quota: QuotaResult;

  if (authHeader.startsWith("Bearer ") && authHeader.length > "Bearer ".length) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data, error } = await userClient.rpc(
      "check_and_record_ai_usage_user",
      { p_tokens: estimatedTotal },
    );
    if (error) return jsonError(500, "quota_check_failed", error.message);
    quota = data?.[0] as QuotaResult;
  } else {
    const ip = getClientIp(req);
    if (!ip) return jsonError(400, "no_ip", "Could not determine client IP");
    const ipHash = await hashIp(ip, serviceKey);
    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data, error } = await adminClient.rpc(
      "check_and_record_ai_usage_anon",
      { p_ip_hash: ipHash, p_tokens: estimatedTotal },
    );
    if (error) return jsonError(500, "quota_check_failed", error.message);
    quota = data?.[0] as QuotaResult;
  }

  if (!quota?.allowed) {
    return jsonError(
      429,
      quota?.reason ?? "quota_exceeded",
      `Daily AI quota reached (${quota?.tokens_used}/${quota?.tokens_limit} tokens, ${quota?.request_count}/${quota?.request_limit} requests).`,
    );
  }

  // ── Provider cascade ──
  if (openaiKey) {
    const stream = await tryOpenAi(openaiKey, systemPrompt, body.messages, maxOutputTokens);
    if (stream) return new Response(stream, { headers: sseHeaders });
  }
  if (anthropicKey) {
    const stream = await tryAnthropic(anthropicKey, systemPrompt, body.messages, maxOutputTokens);
    if (stream) return new Response(stream, { headers: sseHeaders });
  }
  return jsonError(502, "upstream_error", "All upstream providers failed");
});

async function tryOpenAi(
  apiKey: string,
  systemPrompt: string,
  messages: ChatRequestBody["messages"],
  maxOutputTokens: number,
): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        max_tokens: maxOutputTokens,
        stream: true,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    });
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return null;
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`OpenAI returned ${upstream.status}`);
    return null;
  }
  return openAiToAnthropicSse(upstream.body);
}

function openAiToAnthropicSse(
  upstream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nl).replace(/\r$/, "");
            buffer = buffer.slice(nl + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const event = JSON.parse(data);
              const delta = event?.choices?.[0]?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                const anthropicEvent = {
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: delta },
                };
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(anthropicEvent)}\n\n`),
                );
              }
            } catch {
              // skip malformed events
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function tryAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: ChatRequestBody["messages"],
  maxOutputTokens: number,
): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: Response;
  try {
    upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: maxOutputTokens,
        stream: true,
        system: systemPrompt,
        // Anthropic doesn't accept system-role inside messages.
        messages: messages.filter((m) => m.role !== "system"),
      }),
    });
  } catch (err) {
    console.error("Anthropic request failed:", err);
    return null;
  }
  if (!upstream.ok || !upstream.body) {
    console.error(`Anthropic returned ${upstream.status}`);
    return null;
  }
  return upstream.body;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
}
