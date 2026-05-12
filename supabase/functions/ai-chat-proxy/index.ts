// Pnyxy AI chat proxy.
//
// Streams an LLM response back to the browser via SSE while
// enforcing per-user (or per-IP) daily quotas tracked in Postgres.
//
// Provider strategy: every configured OpenAI-compatible upstream is
// tried in priority order (Gemini cheapest → OpenAI), and Anthropic
// is the last fallback. Tool-use mode is Anthropic-only because
// that's the only branch wired through Anthropic's structured tool
// SSE events today. All upstreams are normalized to Anthropic-style
// SSE events on the way out, so the browser parses one shape.
//
// Env vars (set via `supabase secrets set`):
//   GEMINI_API_KEY          — Google AI Studio key. OpenAI-compatible
//                             endpoint, cheapest option. Tried first.
//   OPENAI_API_KEY          — OpenAI key. Second OpenAI-compat fallback.
//   ANTHROPIC_API_KEY       — Anthropic key. Final fallback for plain
//                             chat; required for tool-use mode.
//   SUPABASE_URL            — auto-populated
//   SUPABASE_ANON_KEY       — auto-populated
//   SUPABASE_SERVICE_ROLE_KEY — auto-populated
//
// At least one of GEMINI_API_KEY / OPENAI_API_KEY / ANTHROPIC_API_KEY
// must be set.

// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Minimal Deno globals shim for editor type-checking. The actual
// runtime is Deno; tsc never compiles this file (it lives outside
// the Vite/tsconfig project root).
declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
const GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/**
 * OpenAI-compatible upstreams the proxy can call. Listed in priority
 * order — the handler tries each whose env key is set, falls through
 * on failure, and only hits Anthropic as the last resort. New
 * providers (Mistral, OpenRouter, …) drop in here as one more row
 * without touching the request-handling logic.
 *
 * `envKey` is read with Deno.env.get inside the request handler so
 * we always pick up current secret values, not whatever was set at
 * cold-start.
 */
const OPENAI_COMPATIBLE_PROVIDERS: ReadonlyArray<{
  name: string;
  envKey: string;
  url: string;
  model: string;
}> = [
  {
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: GEMINI_MODEL,
  },
  {
    name: "openai",
    envKey: "OPENAI_API_KEY",
    url: "https://api.openai.com/v1/chat/completions",
    model: OPENAI_MODEL,
  },
];
// Hard ceiling for any single request. Quiz generation needs room for
// ~10 MCQ questions with explanations (~3k tokens). Clients that ask for
// more are clamped to this.
const HARD_MAX_OUTPUT_TOKENS = 4096;

// ── helpers ──────────────────────────────────────────────────

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

/** Cheap token estimate: ~4 chars per token. Good enough for
 * pre-flight quota checks. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Both OpenAI and Anthropic bill an attached image as roughly
 *  this many tokens for a typical viewport-sized image (1024×1024
 *  ≈ 1500–1700 tokens depending on detail level). Slight over-
 *  estimate on purpose — better to bill conservatively than let a
 *  multi-image message slip past the quota check. */
const IMAGE_TOKEN_COST = 1600;

function estimateMessageTokens(content: string | ContentBlock[]): number {
  if (typeof content === "string") return estimateTokens(content);
  let total = 0;
  for (const block of content) {
    if (block.type === "text") {
      total += estimateTokens(block.text ?? "");
    } else if (block.type === "image") {
      total += IMAGE_TOKEN_COST;
    }
  }
  return total;
}

/** Convert an Anthropic-shape content block to OpenAI's chat-
 *  completions multimodal shape. Strings pass through unchanged. */
function toOpenAiContent(
  content: string | ContentBlock[],
): string | Array<Record<string, unknown>> {
  if (typeof content === "string") return content;
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    // Anthropic { type:"image", source:{ type:"base64", media_type, data }}
    // → OpenAI  { type:"image_url", image_url:{ url:"data:..." }}
    const dataUri = `data:${block.source.media_type};base64,${block.source.data}`;
    return { type: "image_url", image_url: { url: dataUri } };
  });
}

async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getClientIp(req: Request): string | null {
  // Supabase Edge Runtime forwards the original IP via these headers.
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

/**
 * Multimodal content block. Anthropic-shape on the wire — the
 * frontend's toAnthropicChatContent already produces this layout,
 * so it's natural to receive. We convert to OpenAI's image_url
 * shape inside `tryOpenAiCompatible` when any OpenAI-compat upstream
 * (OpenAI, Gemini, future Mistral/OpenRouter) is hit.
 */
type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

interface ChatRequestBody {
  messages: Array<{
    role: "user" | "assistant";
    content: string | ContentBlock[];
  }>;
  documentTitle: string;
  pageContext: string;
  /** Overrides the default PDF-Q&A system prompt (quiz generation etc.). */
  systemPromptOverride?: string;
  /** Clamped to HARD_MAX_OUTPUT_TOKENS server-side; billed worst-case. */
  maxOutputTokens?: number;
  /**
   * Tool-use mode. When `tools` is non-empty we route exclusively to
   * Anthropic (the only upstream we wire tool-use through), pass the
   * structured `toolMessages` instead of `messages`, and forward every
   * Anthropic SSE event type — not just text_delta — so the browser
   * can collect tool_use blocks and run the agentic loop.
   */
  tools?: Array<{
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
  toolMessages?: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
}

function buildSystemPrompt(
  documentTitle: string,
  pageContext: string,
  hasImages: boolean,
): string {
  // No source document → generic chat assistant. Mirrors the
  // frontend's ai-client.ts fix: the old PDF-Q&A framing was
  // making the model refuse anything outside the (empty) document
  // context, including image attachments.
  if (!documentTitle.trim()) {
    return `You are Pnyxy's helpful AI assistant. Answer questions clearly and concisely. When the user attaches images, describe or reason about them directly — don't claim you can't see them. Use markdown for code blocks, lists, and tables when it helps readability.`;
  }

  const hasText = pageContext.trim().length > 0;

  // Image PDF (or user forced image mode): page content arrives as
  // image blocks on the user message, not as text in the prompt.
  // Telling the model to "read the text" when there isn't any was
  // the old failure mode that left scanned-PDF users with empty
  // replies. Frame this case explicitly so the model knows to look
  // at the images.
  if (!hasText && hasImages) {
    return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

The user has attached the relevant pages of the document as images. Read those images carefully and answer questions about their content. Reference specific page numbers (visible in the image labels) when relevant.`;
  }

  // Plain text-extracted context: the original path.
  if (hasText) {
    return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

Here is the text from the pages the user is currently viewing:

---
${pageContext}
---

Answer questions about this document. Be concise and helpful. Reference specific page numbers when relevant. If the answer is not in the provided text, say so.`;
  }

  // Doc set but nothing selected and nothing attached — generic doc
  // helper. Avoids the previous "Here is the text:\n---\n---" frame
  // that made the model think it had context it didn't.
  return `You are an AI assistant helping the user with a PDF document titled "${documentTitle}". The user hasn't selected any pages or attached images yet; answer general questions about the document or ask the user to point you at a specific section.`;
}

// ── handler ──────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonError(405, "method_not_allowed", "POST only");
  }

  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  // Snapshot the OpenAI-compat keys once per request so the priority
  // chain reads consistent values even if a secret were rotated mid-
  // request. `?.trim()` filters out the empty-string case (Supabase
  // sometimes stores blank values when a secret was unset and re-set).
  const openAiCompatChain = OPENAI_COMPATIBLE_PROVIDERS.map((p) => ({
    ...p,
    apiKey: Deno.env.get(p.envKey)?.trim() ?? "",
  })).filter((p) => p.apiKey.length > 0);

  if (openAiCompatChain.length === 0 && !anthropicKey) {
    return jsonError(
      500,
      "misconfigured",
      "No upstream AI provider key configured",
    );
  }

  let body: ChatRequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "bad_request", "Invalid JSON body");
  }

  const toolMode =
    Array.isArray(body.tools) &&
    body.tools.length > 0 &&
    Array.isArray(body.toolMessages) &&
    body.toolMessages.length > 0;

  if (!toolMode && (!Array.isArray(body.messages) || body.messages.length === 0)) {
    return jsonError(400, "bad_request", "messages required");
  }

  const maxOutputTokens = Math.min(
    Math.max(body.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS, 1),
    HARD_MAX_OUTPUT_TOKENS,
  );

  // Estimate tokens up-front for the quota check. We bill the
  // worst case (input + max output) so a quota-exceeded response
  // can never be racy.
  const inputTokens = toolMode
    ? estimateTokens(body.systemPromptOverride ?? "") +
      estimateTokens(JSON.stringify(body.tools ?? [])) +
      estimateTokens(JSON.stringify(body.toolMessages ?? []))
    : estimateTokens(body.pageContext ?? "") +
      estimateTokens(body.systemPromptOverride ?? "") +
      // estimateMessageTokens handles both legacy string content
      // (length/4 like before) and multimodal arrays (~1600 per
      // image). Without this, an image-bearing message would skip
      // most of its cost in the quota pre-check and let users
      // burn through the daily cap on big payloads.
      body.messages.reduce(
        (sum, m) => sum + estimateMessageTokens(m.content),
        0,
      ) +
      estimateTokens(body.documentTitle ?? "");
  const estimatedTotal = inputTokens + maxOutputTokens;

  // ── Per-model quota helper ────────────────────────────────
  //
  // The RPC charges the estimated worst-case token cost against the
  // bucket for the specific model the proxy is about to call. If the
  // RPC reports `allowed = false` we return the QuotaResult so the
  // caller can decide whether to fall through to a cheaper model or
  // bounce 429 to the client.
  //
  // Captured-once Supabase context. We deliberately build clients
  // outside the per-call helper so each provider attempt reuses the
  // same client instance (cheap, but no point recreating it).
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  const isAuthed =
    authHeader.startsWith("Bearer ") &&
    authHeader.length > "Bearer ".length;
  const userClient = isAuthed
    ? createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
    : null;
  let anonIpHash: string | null = null;
  if (!isAuthed) {
    const ip = getClientIp(req);
    if (!ip) {
      return jsonError(400, "no_ip", "Could not determine client IP");
    }
    anonIpHash = await hashIp(ip, serviceKey);
  }
  const adminClient = !isAuthed ? createClient(supabaseUrl, serviceKey) : null;

  /** Attempt to bill `estimatedTotal` tokens against `model`'s daily
   *  bucket. Returns the QuotaResult on success / quota_exceeded, or
   *  `null` if the RPC itself errored (caller should 500). */
  async function checkAndRecord(
    model: string,
  ): Promise<{ ok: true; quota: QuotaResult } | { ok: false; rpcError: string } | { ok: false; quota: QuotaResult }> {
    if (isAuthed && userClient) {
      const { data, error } = await userClient.rpc(
        "check_and_record_ai_usage_user",
        { p_tokens: estimatedTotal, p_model: model },
      );
      if (error) return { ok: false, rpcError: error.message };
      const quota = data?.[0] as QuotaResult;
      return quota?.allowed
        ? { ok: true, quota }
        : { ok: false, quota };
    }
    if (adminClient && anonIpHash) {
      const { data, error } = await adminClient.rpc(
        "check_and_record_ai_usage_anon",
        { p_ip_hash: anonIpHash, p_tokens: estimatedTotal, p_model: model },
      );
      if (error) return { ok: false, rpcError: error.message };
      const quota = data?.[0] as QuotaResult;
      return quota?.allowed
        ? { ok: true, quota }
        : { ok: false, quota };
    }
    // Should never reach here — we've already returned 400 above
    // if no IP was derivable on the anon path.
    return { ok: false, rpcError: "no_quota_path" };
  }

  // Scan the user-side messages for image blocks so the system
  // prompt can adapt to the "pages were sent as images" path.
  const hasImages =
    !toolMode &&
    body.messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((block) => block.type === "image"),
    );
  const systemPrompt =
    body.systemPromptOverride ??
    buildSystemPrompt(body.documentTitle, body.pageContext, hasImages);

  // ── Tool mode: Anthropic only (passes through all SSE events) ──
  if (toolMode) {
    if (!anthropicKey) {
      return jsonError(
        501,
        "tool_mode_unavailable",
        "Tool-use requires an Anthropic upstream key.",
      );
    }
    const billed = await checkAndRecord(ANTHROPIC_MODEL);
    if ("rpcError" in billed && billed.rpcError) {
      return jsonError(500, "quota_check_failed", billed.rpcError);
    }
    if (!billed.ok) {
      const q = billed.quota;
      return jsonError(
        429,
        q?.reason ?? "quota_exceeded",
        `Daily AI quota reached for ${ANTHROPIC_MODEL} (${q?.tokens_used}/${q?.tokens_limit} tokens, ${q?.request_count}/${q?.request_limit} requests).`,
      );
    }
    const stream = await tryAnthropicWithTools(
      anthropicKey,
      systemPrompt,
      body.toolMessages!,
      body.tools!,
      maxOutputTokens,
    );
    if (stream) {
      return new Response(stream, { headers: sseHeaders });
    }
    return jsonError(502, "upstream_error", "Anthropic upstream failed");
  }

  // ── Plain text mode: walk the OpenAI-compat chain in priority
  //    order, billing each provider's own bucket before its upstream
  //    attempt. A quota-exceeded model is skipped to the next one;
  //    an upstream failure also falls through (the failed bucket
  //    keeps its charge — acceptable as resilience-deterrent vs the
  //    complexity of a refund path). If everything in the compat
  //    chain failed for either reason, try Anthropic as the final
  //    fallback before giving up. ──
  let lastQuotaFailure: QuotaResult | null = null;
  for (const provider of openAiCompatChain) {
    const billed = await checkAndRecord(provider.model);
    if ("rpcError" in billed && billed.rpcError) {
      return jsonError(500, "quota_check_failed", billed.rpcError);
    }
    if (!billed.ok) {
      // Out of quota for this specific model — try the next cheaper
      // / fallback provider. Track the latest reason so we can
      // surface something useful if the whole chain runs dry.
      lastQuotaFailure = billed.quota;
      continue;
    }
    const stream = await tryOpenAiCompatible(
      provider.url,
      provider.apiKey,
      provider.model,
      systemPrompt,
      body.messages,
      maxOutputTokens,
      provider.name,
    );
    if (stream) {
      return new Response(stream, { headers: sseHeaders });
    }
    // Upstream failed (after quota was billed) — fall through to next.
  }

  if (anthropicKey) {
    const billed = await checkAndRecord(ANTHROPIC_MODEL);
    if ("rpcError" in billed && billed.rpcError) {
      return jsonError(500, "quota_check_failed", billed.rpcError);
    }
    if (billed.ok) {
      const stream = await tryAnthropic(
        anthropicKey,
        systemPrompt,
        body.messages,
        maxOutputTokens,
      );
      if (stream) {
        return new Response(stream, { headers: sseHeaders });
      }
    } else {
      lastQuotaFailure = billed.quota;
    }
  }

  // If we got here only because every model hit its quota, surface
  // the most-recent quota result so the client renders a useful
  // banner. Otherwise it's a genuine upstream outage.
  if (lastQuotaFailure) {
    return jsonError(
      429,
      lastQuotaFailure.reason ?? "quota_exceeded",
      `Daily AI quota reached on every available model (${lastQuotaFailure.tokens_used}/${lastQuotaFailure.tokens_limit} tokens, ${lastQuotaFailure.request_count}/${lastQuotaFailure.request_limit} requests on last model).`,
    );
  }
  return jsonError(502, "upstream_error", "All upstream providers failed");
});

// ── OpenAI-compatible branch (OpenAI, Gemini, future Mistral/OR) ─

/**
 * Generic OpenAI chat-completions caller. The wire shape (model,
 * messages, stream, max_tokens) and the SSE event format are
 * identical across OpenAI, Gemini's OpenAI-compatible endpoint,
 * Mistral, and OpenRouter — so adding a new provider is a row in
 * OPENAI_COMPATIBLE_PROVIDERS and nothing here changes.
 *
 * The `providerName` parameter is purely for logs so a 4xx from
 * Gemini doesn't look identical to a 4xx from OpenAI when debugging.
 */
async function tryOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatRequestBody["messages"],
  maxOutputTokens: number,
  providerName: string,
): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        stream: true,
        messages: [
          { role: "system", content: systemPrompt },
          // Convert any image blocks from Anthropic-shape (what
          // the frontend sends) to OpenAI's image_url shape. Plain
          // string contents pass through untouched. All providers
          // in this branch accept the OpenAI multimodal schema.
          ...messages.map((m) => ({
            role: m.role,
            content: toOpenAiContent(m.content),
          })),
        ],
      }),
    });
  } catch (err) {
    console.error(`${providerName} request failed:`, err);
    return null;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`${providerName} returned ${upstream.status}: ${text}`);
    return null;
  }

  return openAiToAnthropicSse(upstream.body);
}

/**
 * Convert an OpenAI Chat Completions SSE stream into the subset of
 * Anthropic SSE events the browser parses (`content_block_delta`
 * with `text_delta`).
 */
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

          let nlIdx;
          while ((nlIdx = buffer.indexOf("\n")) !== -1) {
            const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
            buffer = buffer.slice(nlIdx + 1);
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
                  encoder.encode(
                    `data: ${JSON.stringify(anthropicEvent)}\n\n`,
                  ),
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

// ── Anthropic branch ─────────────────────────────────────────

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
        messages,
      }),
    });
  } catch (err) {
    console.error("Anthropic request failed:", err);
    return null;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`Anthropic returned ${upstream.status}: ${text}`);
    return null;
  }

  // Anthropic SSE is what the client already parses — pass through.
  return upstream.body;
}

/**
 * Tool-use variant: forwards `tools` + structured `toolMessages` to
 * Anthropic and pipes every SSE event back unchanged. The browser's
 * Anthropic-shaped tool-use parser handles content_block_start /
 * input_json_delta / content_block_stop / message_delta itself —
 * this proxy is only here to keep the Anthropic key off the client.
 */
async function tryAnthropicWithTools(
  apiKey: string,
  systemPrompt: string,
  toolMessages: NonNullable<ChatRequestBody["toolMessages"]>,
  tools: NonNullable<ChatRequestBody["tools"]>,
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
        tools,
        messages: toolMessages,
      }),
    });
  } catch (err) {
    console.error("Anthropic (tools) request failed:", err);
    return null;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`Anthropic (tools) returned ${upstream.status}: ${text}`);
    return null;
  }

  return upstream.body;
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
}
