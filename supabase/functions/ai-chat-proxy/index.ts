// Pnyxy AI chat proxy: streams LLM responses to the browser as
// Anthropic-style SSE while enforcing per-user (or per-IP) daily quotas
// in Postgres. OpenAI-compatible upstreams (Gemini, OpenAI) are tried in
// priority order, Anthropic is the last fallback and the only tool-use
// path. Env: GEMINI/OPENAI/ANTHROPIC_API_KEY, IP_HASH_SALT. See ../README.md.

import "../_shared/deno-shim.ts";
import {
  corsFor,
  handleOptions,
  jsonError as jsonErrorWith,
  jsonErrorPublic,
} from "../_shared/http.ts";
import {
  GROUNDED_REQUEST_SURCHARGE_TOKENS,
  estimateTokens,
  getClientIp,
  hashIp,
  ipHashSalt,
} from "../_shared/tokens.ts";
import { TEACHER_GUARDRAIL, teacherBlock } from "../_shared/teacher-mode.ts";
// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OPENAI_MODEL = "gpt-4o-mini";
const ANTHROPIC_MODEL = "claude-haiku-4-5";
// Google retired the 2.x ids for new API users (404: "no longer
// available to new users") -> current stable ids as of 2026-08.
// These double as quota-bucket keys; migration 00063 maps them.
const GEMINI_FLASH_LITE_MODEL = "gemini-3.5-flash-lite";
const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_3_FLASH_MODEL = "gemini-3.7-flash";
// Gemini 3.x thinks by default and its thinking tokens count against
// max_tokens, so the ceiling needs headroom or answers cut mid-sentence
// (finish_reason "length"). Pre-billed worst-case, unused part refunded
// after the stream.
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
// Native video input. Gemini bills ~300 tokens per second of video at
// default resolution and ~100/s at MEDIA_RESOLUTION_LOW, which is what
// we request (lecture slides + speech survive it fine). The clip length
// the user picked (or the whole video) is pre-billed at this rate, with
// a ceiling so one 3-hour lecture can't be charged past a day's quota.
const VIDEO_TOKENS_PER_SECOND = 100;
const VIDEO_MAX_BILLED_SECONDS = 3600;
// Only YouTube URLs can be passed to Gemini by reference.
const VIDEO_URL_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * OpenAI-compatible upstreams, tried in priority order; Anthropic is the
 * last resort. `envKey` is read inside the request handler so it always
 * reflects the current secret value.
 */
const OPENAI_COMPATIBLE_PROVIDERS: ReadonlyArray<{
  name: string;
  envKey: string;
  url: string;
  model: string;
}> = [
  {
    // Quality-first default: auto route starts on the newest Flash and
    // falls down the chain as buckets run dry. Background calls (title,
    // suggestions) pin Flash-Lite client-side.
    name: "gemini-3",
    envKey: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: GEMINI_3_FLASH_MODEL,
  },
  {
    // Step-down tier when the 3.7 bucket is exhausted.
    name: "gemini",
    envKey: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: GEMINI_MODEL,
  },
  {
    // Cheap reserve; also the pinned model for aux/background calls.
    name: "gemini-lite",
    envKey: "GEMINI_API_KEY",
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    model: GEMINI_FLASH_LITE_MODEL,
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
const HARD_MAX_OUTPUT_TOKENS = 8192;

// ── helpers ──────────────────────────────────────────────────

const SSE_BASE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

/** Bucket key for anonymous callers whose IP could not be determined.
 *  They all share one (smallest) bucket instead of being rejected. */
const NO_IP_SENTINEL = "no-ip";

/** Both OpenAI and Anthropic bill an attached image as roughly
 *  this many tokens for a typical viewport-sized image (1024×1024
 *  ≈ 1500–1700 tokens depending on detail level). Slight over-
 *  estimate on purpose, better to bill conservatively than let a
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

interface QuotaResult {
  allowed: boolean;
  reason: string | null;
  tokens_used: number;
  request_count: number;
  tokens_limit: number;
  request_limit: number;
}

/**
 * Multimodal content block. Anthropic-shape on the wire, the
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
  /** Pin the response to a single Pnyxy model. When set, the proxy
   *  skips the auto-routing chain and only tries this model, the
   *  user's pick from the chat composer's ModelPicker. Unknown
   *  values fall back to the full chain. Null/undefined = auto. */
  preferredModel?: string | null;
  /** Thinking mode: forwarded as `reasoning_effort` to Gemini upstreams
   *  (mapped to thinking_level/thinking_budget server-side by Google).
   *  Non-Gemini upstreams ignore it (gpt-4o-mini would reject the
   *  field, so it is only attached on Gemini providers). Thinking
   *  tokens bill as output tokens, hence the raised output floor. */
  reasoning?: boolean;
  /** Explicit web-search request from the composer toggle: forces
   *  Google Search grounding on the Gemini-3 tier regardless of
   *  document context or model pin (the auto rule below only grounds
   *  standalone chats). */
  webSearch?: boolean;
  /**
   * Direct-video mode (YouTube resource side-chat, "Gemini watches the
   * video" option). The proxy forces a Gemini upstream and hands the
   * video URL to the model natively (`file_data` part) instead of
   * through the OpenAI-compat endpoint, which has no video input.
   * Optional start/end (seconds) clip the watched range; `durationSec`
   * (when the client knows it) sizes the quota pre-bill.
   */
  videoContext?: {
    url: string;
    startSec?: number | null;
    endSec?: number | null;
    durationSec?: number | null;
  };
  /**
   * Tool-use mode. When `tools` is non-empty we pass the structured
   * (Anthropic-shaped) `toolMessages` instead of `messages`. The
   * OpenAI-compat chain (Gemini, OpenAI) is tried first with function
   * calling, its stream converted to Anthropic-style tool events;
   * Anthropic is the fallback (its SSE is forwarded verbatim). The
   * browser collects tool_use blocks and runs the agentic loop.
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

// keep in sync with src/lib/ai/extract-quiz.ts INLINE_QUIZ_SPEC
const INLINE_QUIZ_SPEC = `When the user asks to be quizzed, or a quick knowledge check would clearly help, emit the quiz as a fenced code block tagged \`quiz\` containing ONLY JSON in this exact shape:
\`\`\`quiz
{"title": "…", "questions": [{"q": "…", "options": ["…", "…", "…", "…"], "correct": 1, "explanation": "…"}]}
\`\`\`
3-8 questions, 2-4 options each, "correct" is the zero-based index of the right option. Write the quiz in the user's language; when you have document context, cite pages in the explanations ([p.N]). Put no other text inside the block, and never reveal the answers in the prose around it.`;

function buildSystemPrompt(
  documentTitle: string,
  pageContext: string,
  hasImages: boolean,
  canSearchWeb = false,
): string {
  // No source document → standalone /chat page brief. Mirror of the
  // expanded prompt in `src/lib/ai-client.ts`; both branches must
  // stay in sync so BYOK and Pnyxy-proxy users see the same
  // conversational behavior.
  if (!documentTitle.trim()) {
    return `You are Pnyxy's AI chat assistant. Pnyxy is a study- and reading-focused learning app; the user is typically a student or researcher. Be helpful, conversational, and honest, talk to them like a smart, friendly tutor, not a search engine.

Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise, and switch fluidly if they mix. Never apologize for the language choice or comment on it.

When the user attaches images, describe or reason about them directly, don't claim you can't see them.

Formatting:
- Use markdown so answers are easy to scan: **bold** the key terms, bullet or numbered lists for enumerations and steps, \`##\` / \`###\` headers when an answer has multiple genuine sections, tables for structured data, fenced \`\`\`code blocks with a language tag for code.
- Separate paragraphs with blank lines and keep them short (2-4 sentences).
- Don't over-structure trivial replies: a one-sentence answer stays one sentence.

When you don't know something or have ambiguous context, say so and ask a clarifying question instead of guessing. If a question has multiple reasonable interpretations, name them briefly before answering. Concise > exhaustive; the user can always ask for more.
${
  canSearchWeb
    ? `\nYou have Google Search available and can look things up on the web. When the user asks about current events, recent releases, prices, dates, or anything you're unsure about or that may have changed since your training, search and base your answer on the results. Never claim you can't access the internet, you can.\n`
    : ""
}
When you write mathematical expressions, wrap inline math in single-dollar delimiters ($x^2$) and display equations in double-dollar delimiters ($$\\sum_{i=1}^n i$$). The chat UI renders these as proper formulas via KaTeX.

${INLINE_QUIZ_SPEC}${
      pageContext.trim()
        ? `\n\nContext the user attached to this chat (their profile preset and any material); follow it:\n${pageContext.trim()}`
        : ""
    }`;
  }

  // Every document prompt needs this too, or the (English) teacher-mode
  // block tips replies into English for Hungarian users.
  const langRule =
    "Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise, and switch fluidly if they mix.";

  const hasText = pageContext.trim().length > 0;

  // Image PDF (or user forced image mode): page content arrives as
  // image blocks on the user message, not as text in the prompt.
  // Frame this case explicitly so the model knows to look at the images.
  if (!hasText && hasImages) {
    return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

The user has attached the relevant pages of the document as images. Read those images carefully and answer questions about their content. Reference specific page numbers (visible in the image labels) when relevant.

${langRule}`;
  }

  // Plain text-extracted context: the original path.
  if (hasText) {
    return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

Here is the text from the pages the user is currently viewing:

---
${pageContext}
---

Answer questions about this document. Be concise and helpful. Reference specific page numbers when relevant. If the answer is not in the provided text, say so.

${langRule}

${INLINE_QUIZ_SPEC}`;
  }

  // Doc set but nothing selected and nothing attached: generic doc
  // helper, no empty "Here is the text:\n---\n---" frame.
  return `You are an AI assistant helping the user with a PDF document titled "${documentTitle}". The user hasn't selected any pages or attached images yet; answer general questions about the document or ask the user to point you at a specific section.

${langRule}`;
}

// ── Anthropic prompt caching ─────────────────────────────────
//
// Gemini and the OpenAI upstreams cache matching/long prompts
// automatically; only Anthropic needs an explicit breakpoint here.

/** Wrap the system prompt with an ephemeral cache breakpoint so a
 *  byte-identical prefix (e.g. repeat reader Q&A turns) is served
 *  from Anthropic's cache instead of rebilled at full price. */
function cachedSystem(
  systemPrompt: string,
): Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }> {
  return [
    { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
  ];
}

/** Mark the last tool with a cache breakpoint. In Anthropic's cache
 *  ordering (tools → system → messages) a breakpoint on the final
 *  tool caches the entire tools block, the roadmap/quiz schemas are
 *  large and identical across the agentic loop's round-trips, so this
 *  is the second-biggest stable prefix after the system prompt. */
function withToolCache<T extends Record<string, unknown>>(tools: T[]): T[] {
  if (tools.length === 0) return tools;
  return tools.map((t, i) =>
    i === tools.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } }
      : t,
  );
}

// ── handler ──────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return handleOptions(req);
  }
  const corsHeaders = corsFor(req);
  const sseHeaders = { ...corsHeaders, ...SSE_BASE_HEADERS };
  const jsonError = (status: number, code: string, message: string): Response =>
    jsonErrorWith(status, code, message, corsHeaders);

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
  // Only user/assistant turns may come from the client; a "system"
  // (or any other) role would let the caller inject instructions past
  // the server-owned system prompt.
  const clientTurns = toolMode ? body.toolMessages ?? [] : body.messages;
  if (
    clientTurns.some(
      (m) => !m || (m.role !== "user" && m.role !== "assistant"),
    )
  ) {
    return jsonError(400, "invalid_role", "message roles must be user or assistant");
  }

  // Thinking turns need headroom: the thinking tokens count against
  // max_tokens, so the default 1024 would leave nothing for the answer.
  const reasoning = body.reasoning === true;
  const maxOutputTokens = Math.min(
    Math.max(
      body.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      reasoning ? 6144 : 1,
    ),
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
      // estimateMessageTokens covers both plain string content
      // (length/4) and multimodal arrays (~1600 per image), so an
      // image-bearing message is billed at its real cost in the
      // quota pre-check.
      body.messages.reduce(
        (sum, m) => sum + estimateMessageTokens(m.content),
        0,
      ) +
      estimateTokens(body.documentTitle ?? "");
  // grounded turns add a fixed surcharge below (search calls are billed per query upstream)
  let estimatedTotal = inputTokens + maxOutputTokens;

  // ── Direct-video mode: validate the clip and pre-bill its length ──
  const videoCtx = !toolMode && body.videoContext ? body.videoContext : null;
  let videoClip: {
    url: string;
    startSec: number | null;
    endSec: number | null;
  } | null = null;
  if (videoCtx) {
    let vUrl: URL;
    try {
      vUrl = new URL(String(videoCtx.url ?? ""));
    } catch {
      return jsonError(400, "bad_request", "videoContext.url must be a URL");
    }
    if (
      (vUrl.protocol !== "https:" && vUrl.protocol !== "http:") ||
      !VIDEO_URL_HOSTS.has(vUrl.hostname.toLowerCase())
    ) {
      return jsonError(400, "bad_request", "videoContext.url must be a YouTube URL");
    }
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
    const startSec = num(videoCtx.startSec);
    let endSec = num(videoCtx.endSec);
    if (startSec !== null && endSec !== null && endSec <= startSec) endSec = null;
    const durationSec = num(videoCtx.durationSec);
    const clipSeconds =
      endSec !== null
        ? endSec - (startSec ?? 0)
        : durationSec !== null
          ? Math.max(0, durationSec - (startSec ?? 0))
          : VIDEO_MAX_BILLED_SECONDS;
    estimatedTotal +=
      Math.min(clipSeconds, VIDEO_MAX_BILLED_SECONDS) * VIDEO_TOKENS_PER_SECOND;
    videoClip = { url: vUrl.toString(), startSec, endSec };
  }

  // ── Per-model quota helper ────────────────────────────────
  //
  // checkAndRecord charges the estimated worst-case token cost against
  // the bucket for the model about to be called; `allowed = false`
  // lets the caller fall through to a cheaper model or bounce 429.
  //
  // Supabase clients are built once here and reused by every provider attempt.
  // `userClient` exists ONLY to verify the caller's JWT; every quota RPC
  // goes through the service-role client with the verified user id
  // (the RPCs are service-role-only since migration 00072, so a client
  // can no longer call check/refund with arbitrary token counts).
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";
  let isAuthed =
    authHeader.startsWith("Bearer ") &&
    authHeader.length > "Bearer ".length;
  let userId: string | null = null;
  // A non-empty Bearer header is not proof of identity, verify it
  // actually resolves to a user before trusting isAuthed downstream
  // (quota billing, and the anon-chat gate right below).
  if (isAuthed) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    if (userError || !userData?.user) {
      isAuthed = false;
    } else {
      userId = userData.user.id;
    }
  }

  // Anonymous chat used to bill a per-IP quota derived from the
  // client-controlled x-forwarded-for hop, which is spoofable, so a
  // signed-out caller could burn the owner's API keys. Off by default;
  // set ALLOW_ANON_CHAT=true to re-enable the per-IP anon path below.
  const allowAnonChat = Deno.env.get("ALLOW_ANON_CHAT") === "true";
  if (!isAuthed && !allowAnonChat) {
    return jsonError(401, "sign_in_required", "Sign in to use the AI chat.");
  }

  let anonIpHash: string | null = null;
  if (!isAuthed) {
    // No derivable IP: fall into a single shared bucket rather than
    // rejecting, so the anon path still works behind odd proxies but
    // cannot be widened by header spoofing.
    const ip = getClientIp(req) ?? NO_IP_SENTINEL;
    anonIpHash = await hashIp(ip, ipHashSalt());
  }
  // One service-role client for every quota RPC (authed and anon path).
  const adminClient = createClient(supabaseUrl, serviceKey);

  /** Attempt to bill `estimatedTotal` tokens against `model`'s daily
   *  bucket. Returns the QuotaResult on success / quota_exceeded, or
   *  `null` if the RPC itself errored (caller should 500). */
  async function checkAndRecord(
    model: string,
  ): Promise<{ ok: true; quota: QuotaResult } | { ok: false; rpcError: string } | { ok: false; quota: QuotaResult }> {
    if (isAuthed && userId) {
      const { data, error } = await adminClient.rpc(
        "check_and_record_ai_usage_user",
        { p_user_id: userId, p_tokens: estimatedTotal, p_model: model },
      );
      if (error) return { ok: false, rpcError: error.message };
      const quota = data?.[0] as QuotaResult;
      return quota?.allowed
        ? { ok: true, quota }
        : { ok: false, quota };
    }
    if (anonIpHash) {
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
    // Should never reach here: the anon path always has an ip hash.
    return { ok: false, rpcError: "no_quota_path" };
  }

  /** Give the pre-billed tokens back after an upstream failure so a
   *  broken provider in the chain doesn't drain buckets it never
   *  served from. Best-effort: refund errors are logged and ignored. */
  async function refundUsage(
    model: string,
    tokens: number = estimatedTotal,
  ): Promise<void> {
    if (tokens <= 0) return;
    try {
      if (isAuthed && userId) {
        const { error } = await adminClient.rpc("refund_ai_usage_user", {
          p_user_id: userId,
          p_tokens: tokens,
          p_model: model,
        });
        if (error) console.error("refund_ai_usage_user failed:", error.message);
      } else if (anonIpHash) {
        const { error } = await adminClient.rpc("refund_ai_usage_anon", {
          p_ip_hash: anonIpHash,
          p_tokens: tokens,
          p_model: model,
        });
        if (error) console.error("refund_ai_usage_anon failed:", error.message);
      }
    } catch (err) {
      console.error("refund failed:", err);
    }
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
  // ── Web-search grounding (standalone /chat only) ───────────────
  //
  // Google Search grounding is only available on Gemini 3+ via the
  // OpenAI-compat endpoint, so enabling it forces the request onto the
  // (pricier) Gemini-3 model. We scope it to the standalone chat,
  // detected by an empty documentTitle, i.e. the /chat page rather than
  // reader Q&A, so high-volume, already-context-grounded reader
  // questions stay on the cheap Flash-Lite tier. Respect an explicit
  // model pin: only auto-route (no pin) or an explicit Gemini-3 pin opt
  // into grounding; a user who pinned a cheaper model keeps it.
  const preferredModel = body.preferredModel ?? null;
  const groundingModelAvailable = openAiCompatChain.some(
    (p) => p.model === GEMINI_3_FLASH_MODEL,
  );
  const autoGrounding =
    !(body.documentTitle ?? "").trim() &&
    (preferredModel === null || preferredModel === GEMINI_3_FLASH_MODEL);
  const useGrounding =
    !toolMode &&
    groundingModelAvailable &&
    (body.webSearch === true || autoGrounding);
  if (useGrounding) estimatedTotal += GROUNDED_REQUEST_SURCHARGE_TOKENS;

  // Teacher mode is enforced server-side. Rule:
  //   - default prompts (no override): always append teacherBlock().
  //   - override that is a CHAT prompt, recognised by the INLINE_QUIZ_SPEC
  //     marker the client-side chat prompts carry (src/lib/ai/ai-client.ts):
  //     append teacherBlock() unless the override already contains the
  //     guardrail, so a tampered client cannot strip it.
  //   - functional overrides (quiz generation, OCR, roadmap agent,
  //     answer evaluation, explain panel) carry no marker, and tool mode
  //     is the roadmap agent: those get no tutoring block, it would
  //     break their structured output.
  const override = body.systemPromptOverride;
  const overrideIsChatPrompt =
    typeof override === "string" &&
    !toolMode &&
    override.includes(INLINE_QUIZ_SPEC);
  const systemPrompt =
    override === undefined || override === null
      ? buildSystemPrompt(
          body.documentTitle,
          body.pageContext,
          hasImages,
          useGrounding,
        ) + teacherBlock()
      : overrideIsChatPrompt && !override.includes(TEACHER_GUARDRAIL)
        ? override + teacherBlock()
        : override;

  // ── Tool mode: OpenAI-compat chain with function calling, Anthropic
  //    as fallback. Same billing/refund dance as plain mode; a pinned
  //    model narrows the attempts like it does there. ──
  if (toolMode) {
    const toolPin = body.preferredModel ?? null;
    const knownCompat = new Set(OPENAI_COMPATIBLE_PROVIDERS.map((p) => p.model));
    const pinnedCompat = !!toolPin && knownCompat.has(toolPin);
    const toolCompatChain = pinnedCompat
      ? openAiCompatChain.filter((p) => p.model === toolPin)
      : toolPin === ANTHROPIC_MODEL
        ? []
        : openAiCompatChain;
    // a compat pin that is actually available skips the Anthropic fallback
    const tryAnthropicTools =
      !!anthropicKey && !(pinnedCompat && toolCompatChain.length > 0);
    if (toolCompatChain.length === 0 && !anthropicKey) {
      return jsonError(
        501,
        "tool_mode_unavailable",
        "Tool-use needs a Gemini, OpenAI or Anthropic upstream key.",
      );
    }
    let toolQuotaFailure: QuotaResult | null = null;
    for (const provider of toolCompatChain) {
      const billed = await checkAndRecord(provider.model);
      if ("rpcError" in billed) {
        console.error("quota rpc failed:", billed.rpcError);
        return jsonErrorPublic(500, "quota_check_failed", corsHeaders);
      }
      if (!billed.ok) {
        toolQuotaFailure = billed.quota;
        continue;
      }
      const model = provider.model;
      const stream = await tryOpenAiCompatibleTools(
        provider.url,
        provider.apiKey,
        model,
        systemPrompt,
        body.toolMessages!,
        body.tools!,
        maxOutputTokens,
        provider.name,
        (usedOutputTokens) => {
          const unused = maxOutputTokens - usedOutputTokens;
          if (unused > 0) waitUntil(refundUsage(model, unused));
        },
      );
      if (stream) {
        return new Response(stream, {
          headers: { ...sseHeaders, "x-pnyxy-model": model },
        });
      }
      await refundUsage(model);
    }
    if (tryAnthropicTools) {
      const billed = await checkAndRecord(ANTHROPIC_MODEL);
      if ("rpcError" in billed) {
        console.error("quota rpc failed:", billed.rpcError);
        return jsonErrorPublic(500, "quota_check_failed", corsHeaders);
      }
      if (billed.ok) {
        const stream = await tryAnthropic(
          anthropicKey!,
          systemPrompt,
          body.toolMessages!,
          maxOutputTokens,
          body.tools!,
        );
        if (stream) {
          return new Response(stream, {
            headers: { ...sseHeaders, "x-pnyxy-model": ANTHROPIC_MODEL },
          });
        }
        await refundUsage(ANTHROPIC_MODEL);
      } else {
        toolQuotaFailure = billed.quota;
      }
    }
    if (toolQuotaFailure) {
      return jsonError(
        429,
        toolQuotaFailure.reason ?? "quota_exceeded",
        `Daily AI quota reached on every available model (${toolQuotaFailure.tokens_used}/${toolQuotaFailure.tokens_limit} tokens, ${toolQuotaFailure.request_count}/${toolQuotaFailure.request_limit} requests on last model).`,
      );
    }
    return jsonError(502, "upstream_error", "All upstream providers failed (tool mode)");
  }

  // ── Direct-video mode: Gemini only, native API ────────────────
  //
  // The OpenAI-compat endpoint can't take a video by reference, so this
  // path calls generateContent directly with a `file_data` part. Walks
  // the Gemini tiers in the usual order (an explicit Gemini pin narrows
  // to that model); a non-Gemini pin is ignored since it can't serve
  // this request. No Anthropic/OpenAI fallback: they'd silently answer
  // without having seen the video.
  if (videoClip) {
    const geminiChain = openAiCompatChain.filter((p) =>
      p.name.startsWith("gemini"),
    );
    if (geminiChain.length === 0) {
      return jsonError(
        501,
        "video_mode_unavailable",
        "Direct video input needs a Gemini upstream key.",
      );
    }
    const pinned =
      body.preferredModel &&
      geminiChain.some((p) => p.model === body.preferredModel)
        ? geminiChain.filter((p) => p.model === body.preferredModel)
        : geminiChain;
    let videoQuotaFailure: QuotaResult | null = null;
    for (const provider of pinned) {
      const billed = await checkAndRecord(provider.model);
      if ("rpcError" in billed) {
        console.error("quota rpc failed:", billed.rpcError);
        return jsonErrorPublic(500, "quota_check_failed", corsHeaders);
      }
      if (!billed.ok) {
        videoQuotaFailure = billed.quota;
        continue;
      }
      const model = provider.model;
      const stream = await tryGeminiNativeVideo(
        provider.apiKey,
        model,
        systemPrompt,
        body.messages,
        videoClip,
        maxOutputTokens,
        (usedOutputTokens) => {
          const unused = maxOutputTokens - usedOutputTokens;
          if (unused > 0) waitUntil(refundUsage(model, unused));
        },
      );
      if (stream) {
        return new Response(stream, {
          headers: { ...sseHeaders, "x-pnyxy-model": model },
        });
      }
      await refundUsage(model);
    }
    if (videoQuotaFailure) {
      return jsonError(
        429,
        videoQuotaFailure.reason ?? "quota_exceeded",
        `Daily AI quota reached on every Gemini model (${videoQuotaFailure.tokens_used}/${videoQuotaFailure.tokens_limit} tokens, ${videoQuotaFailure.request_count}/${videoQuotaFailure.request_limit} requests on last model).`,
      );
    }
    return jsonError(502, "upstream_error", "Gemini video request failed");
  }

  // ── Plain text mode: walk the OpenAI-compat chain in priority
  //    order, billing each provider's own bucket before its upstream
  //    attempt. A quota-exceeded model is skipped to the next one;
  //    an upstream failure also falls through after refunding its
  //    pre-billed charge (migration 00062). If everything in the
  //    compat chain failed for either reason, try Anthropic as the
  //    final fallback before giving up. ──
  //
  // `preferredModel` (from the client's ModelPicker) narrows the
  // chain to a single model when the user picked one explicitly.
  // An unknown value falls back to the full chain so a stale client
  // can't break itself by sending a model id the server doesn't
  // recognize yet. (`preferredModel` computed above with the
  // grounding gate.)
  const knownCompatModels = new Set(
    OPENAI_COMPATIBLE_PROVIDERS.map((p) => p.model),
  );
  const filteredCompatChain =
    preferredModel && knownCompatModels.has(preferredModel)
      ? openAiCompatChain.filter((p) => p.model === preferredModel)
      : openAiCompatChain;
  // When the user pinned Claude Haiku 4.5 (the Anthropic model) we
  // skip the OpenAI-compat chain entirely, Anthropic handles it
  // below. For any other preferred model we still try Anthropic as
  // a last-resort fallback so a single quota cap doesn't 502 the
  // user out.
  const skipCompatChain =
    preferredModel === ANTHROPIC_MODEL ||
    (preferredModel !== null && knownCompatModels.has(preferredModel) && filteredCompatChain.length === 0);
  const skipAnthropicFallback =
    preferredModel !== null &&
    preferredModel !== ANTHROPIC_MODEL &&
    knownCompatModels.has(preferredModel);

  // Ordered list of upstream attempts, each tagged with whether to
  // turn on Google Search grounding. When grounding is wanted we put
  // the grounded Gemini-3 attempt first, then the rest of the chain as
  // a no-grounding fallback so an exhausted Gemini-3 bucket still
  // answers (just without web access) instead of bouncing a 429.
  type Attempt = {
    provider: (typeof filteredCompatChain)[number];
    grounding: boolean;
  };
  let attempts: Attempt[];
  if (skipCompatChain) {
    attempts = [];
  } else if (useGrounding) {
    const g3 =
      filteredCompatChain.find((p) => p.model === GEMINI_3_FLASH_MODEL) ??
      openAiCompatChain.find((p) => p.model === GEMINI_3_FLASH_MODEL)!;
    attempts = [
      { provider: g3, grounding: true },
      ...filteredCompatChain
        .filter((p) => p.model !== GEMINI_3_FLASH_MODEL)
        .map((p) => ({ provider: p, grounding: false })),
    ];
  } else {
    attempts = filteredCompatChain.map((p) => ({ provider: p, grounding: false }));
  }

  let lastQuotaFailure: QuotaResult | null = null;
  for (const { provider, grounding } of attempts) {
    const billed = await checkAndRecord(provider.model);
    if ("rpcError" in billed) {
      {
        console.error("quota rpc failed:", billed.rpcError);
        return jsonErrorPublic(500, "quota_check_failed", corsHeaders);
      }
    }
    if (!billed.ok) {
      // Out of quota for this specific model, try the next cheaper
      // / fallback provider. Track the latest reason so we can
      // surface something useful if the whole chain runs dry.
      lastQuotaFailure = billed.quota;
      continue;
    }
    const model = provider.model;
    const stream = await tryOpenAiCompatible(
      provider.url,
      provider.apiKey,
      model,
      systemPrompt,
      body.messages,
      maxOutputTokens,
      provider.name,
      grounding,
      reasoning,
      // Reconcile the worst-case pre-bill with what the model actually
      // produced (thinking included when the provider reports usage).
      (usedOutputTokens) => {
        const unused = maxOutputTokens - usedOutputTokens;
        if (unused > 0) waitUntil(refundUsage(model, unused));
      },
    );
    if (stream) {
      return new Response(stream, {
        headers: { ...sseHeaders, "x-pnyxy-model": model },
      });
    }
    // Upstream failed after quota was billed: refund, fall through to next.
    await refundUsage(provider.model);
  }

  if (anthropicKey && !skipAnthropicFallback) {
    const billed = await checkAndRecord(ANTHROPIC_MODEL);
    if ("rpcError" in billed) {
      {
        console.error("quota rpc failed:", billed.rpcError);
        return jsonErrorPublic(500, "quota_check_failed", corsHeaders);
      }
    }
    if (billed.ok) {
      const stream = await tryAnthropic(
        anthropicKey,
        systemPrompt,
        body.messages,
        maxOutputTokens,
      );
      if (stream) {
        return new Response(stream, {
          headers: { ...sseHeaders, "x-pnyxy-model": ANTHROPIC_MODEL },
        });
      }
      await refundUsage(ANTHROPIC_MODEL);
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

// ── OpenAI-compat tool use (Gemini, OpenAI) ──────────────────

type ToolBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

/** Anthropic-shaped tool turn → OpenAI chat messages: an assistant turn
 *  becomes one message with `tool_calls`, a user turn splits into one
 *  `tool` message per tool_result (mirrors src/lib/ai/ai-client.ts). */
function toOpenAiToolMessages(
  m: NonNullable<ChatRequestBody["toolMessages"]>[number],
): Array<Record<string, unknown>> {
  if (typeof m.content === "string") return [{ role: m.role, content: m.content }];
  const blocks = m.content as unknown as ToolBlock[];
  const textOf = (bs: ToolBlock[]) =>
    bs.filter((b): b is Extract<ToolBlock, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");
  if (m.role === "assistant") {
    const text = textOf(blocks);
    const uses = blocks.filter(
      (b): b is Extract<ToolBlock, { type: "tool_use" }> => b.type === "tool_use",
    );
    const msg: Record<string, unknown> = { role: "assistant" };
    if (text) msg.content = text;
    if (uses.length > 0) {
      msg.tool_calls = uses.map((b) => ({
        id: b.id,
        type: "function",
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
    }
    if (!msg.content && !msg.tool_calls) msg.content = "";
    return [msg];
  }
  const texts = textOf(blocks);
  const results = blocks.filter(
    (b): b is Extract<ToolBlock, { type: "tool_result" }> => b.type === "tool_result",
  );
  const out: Array<Record<string, unknown>> = [];
  if (texts) out.push({ role: "user", content: texts });
  for (const r of results) {
    out.push({ role: "tool", tool_call_id: r.tool_use_id, content: r.content });
  }
  return out;
}

async function tryOpenAiCompatibleTools(
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  toolMessages: NonNullable<ChatRequestBody["toolMessages"]>,
  tools: NonNullable<ChatRequestBody["tools"]>,
  maxOutputTokens: number,
  providerName: string,
  onUsage?: (outputTokens: number) => void,
): Promise<ReadableStream<Uint8Array> | null> {
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxOutputTokens,
        stream: true,
        stream_options: { include_usage: true },
        ...(providerName.startsWith("gemini") ? { reasoning_effort: "low" } : {}),
        tools: tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.input_schema },
        })),
        messages: [
          { role: "system", content: systemPrompt },
          ...toolMessages.flatMap(toOpenAiToolMessages),
        ],
      }),
    });
  } catch (err) {
    console.error(`${providerName} (tools) request failed:`, err);
    return null;
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`${providerName} (tools) returned ${upstream.status}: ${text}`);
    return null;
  }
  return openAiToolsToAnthropicSse(upstream.body, onUsage);
}

interface ToolCallSlot {
  id: string;
  name: string;
  /** content_block_start already emitted */
  open: boolean;
  /** argument JSON buffered before the name was known */
  args: string;
}

/**
 * OpenAI function-calling SSE → the Anthropic tool events the browser's
 * parseAnthropicSseTools understands: text at block 0, each tool call at
 * block 1+index (content_block_start / input_json_delta / content_block_stop),
 * then message_delta with stop_reason tool_use | end_turn | max_tokens.
 */
function openAiToolsToAnthropicSse(
  upstream: ReadableStream<Uint8Array>,
  onUsage?: (outputTokens: number) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reportedOutputTokens: number | null = null;
  let emittedChars = 0;
  const slots = new Map<number, ToolCallSlot>();
  let finishReason: string | null = null;
  const finish = () => {
    if (!onUsage) return;
    onUsage(reportedOutputTokens ?? Math.ceil(emittedChars / 4));
  };
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const emit = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      const openBlock = (index: number, slot: ToolCallSlot) => {
        if (slot.open || !slot.name) return;
        slot.open = true;
        emit({
          type: "content_block_start",
          index: index + 1,
          content_block: { type: "tool_use", id: slot.id, name: slot.name },
        });
        if (slot.args) {
          emit({
            type: "content_block_delta",
            index: index + 1,
            delta: { type: "input_json_delta", partial_json: slot.args },
          });
          slot.args = "";
        }
      };
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
              if (event?.error) {
                const msg =
                  typeof event.error === "string" ? event.error : event.error?.message ?? "upstream error";
                console.error("upstream (tools) stream error:", msg);
                emit({ type: "error", error: { type: "api_error", message: msg } });
                continue;
              }
              const usage = event?.usage?.completion_tokens;
              if (typeof usage === "number") reportedOutputTokens = usage;
              const choice = event?.choices?.[0];
              const delta = choice?.delta;
              if (typeof delta?.content === "string" && delta.content.length > 0) {
                emittedChars += delta.content.length;
                emit({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: delta.content },
                });
              }
              const tcs: Array<{
                index?: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }> = delta?.tool_calls ?? [];
              for (const tc of tcs) {
                if (typeof tc.index !== "number") continue;
                let slot = slots.get(tc.index);
                if (!slot) {
                  slot = { id: tc.id ?? `call_${tc.index}`, name: "", open: false, args: "" };
                  slots.set(tc.index, slot);
                }
                if (tc.id) slot.id = tc.id;
                if (tc.function?.name) slot.name = tc.function.name;
                const args = tc.function?.arguments;
                if (typeof args === "string" && args.length > 0) {
                  emittedChars += args.length;
                  if (slot.open) {
                    emit({
                      type: "content_block_delta",
                      index: tc.index + 1,
                      delta: { type: "input_json_delta", partial_json: args },
                    });
                  } else {
                    slot.args += args;
                  }
                }
                openBlock(tc.index, slot);
              }
              if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
                finishReason = choice.finish_reason;
              }
            } catch {
              // skip malformed events
            }
          }
        }
        // close every tool block, then report the stop reason
        for (const [index, slot] of slots) {
          openBlock(index, slot);
          if (slot.open) emit({ type: "content_block_stop", index: index + 1 });
        }
        const stop =
          finishReason === "tool_calls" || (finishReason === "stop" && slots.size > 0)
            ? "tool_use"
            : finishReason
              ? mapFinishReason(finishReason)
              : "end_turn";
        emit({ type: "message_delta", delta: { stop_reason: stop } });
        controller.close();
        finish();
      } catch (err) {
        finish();
        console.error("upstream (tools) stream failed:", err);
        try {
          emit({
            type: "error",
            error: { type: "connection_error", message: "The connection to the model dropped mid-answer." },
          });
        } catch {
          // already closed
        }
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

// ── Gemini native branch (direct video input) ────────────────

/** Anthropic-shape content block → Gemini `parts`. */
function toGeminiParts(
  content: string | ContentBlock[],
): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  return content.map((block) =>
    block.type === "text"
      ? { text: block.text }
      : {
          inline_data: {
            mime_type: block.source.media_type,
            data: block.source.data,
          },
        },
  );
}

/**
 * Gemini generateContent (SSE) with the YouTube video attached by URL to
 * the latest user turn. Earlier turns go in as plain history: Gemini
 * only needs the video in the request being answered, and attaching it
 * to every turn would multiply the media tokens. Output is converted to
 * the same Anthropic-style events the OpenAI-compat path emits.
 */
async function tryGeminiNativeVideo(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: ChatRequestBody["messages"],
  clip: { url: string; startSec: number | null; endSec: number | null },
  maxOutputTokens: number,
  onUsage?: (outputTokens: number) => void,
): Promise<ReadableStream<Uint8Array> | null> {
  const lastUserIdx = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") return i;
    }
    return -1;
  })();
  const videoPart: Record<string, unknown> = {
    file_data: { file_uri: clip.url },
  };
  if (clip.startSec !== null || clip.endSec !== null) {
    videoPart.video_metadata = {
      ...(clip.startSec !== null ? { start_offset: `${clip.startSec}s` } : {}),
      ...(clip.endSec !== null ? { end_offset: `${clip.endSec}s` } : {}),
    };
  }
  const contents = messages.map((m, i) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts:
      i === lastUserIdx
        ? [videoPart, ...toGeminiParts(m.content)]
        : toGeminiParts(m.content),
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          maxOutputTokens,
          // ~100 tokens/s instead of ~300: matches VIDEO_TOKENS_PER_SECOND
          mediaResolution: "MEDIA_RESOLUTION_LOW",
        },
      }),
    });
  } catch (err) {
    console.error(`gemini-video (${model}) request failed:`, err);
    return null;
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`gemini-video (${model}) returned ${upstream.status}: ${text}`);
    return null;
  }
  return geminiToAnthropicSse(upstream.body, onUsage);
}

/** Gemini streamGenerateContent SSE → Anthropic-style text_delta events. */
function geminiToAnthropicSse(
  upstream: ReadableStream<Uint8Array>,
  onUsage?: (outputTokens: number) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let reportedOutputTokens: number | null = null;
  let emittedChars = 0;
  const finish = () => {
    if (!onUsage) return;
    onUsage(reportedOutputTokens ?? Math.ceil(emittedChars / 4));
  };
  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const emit = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
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
            if (!data) continue;
            try {
              const event = JSON.parse(data);
              if (event?.error) {
                const msg = event.error?.message ?? "upstream error";
                console.error("gemini-video stream error:", msg);
                emit({ type: "error", error: { type: "api_error", message: msg } });
                continue;
              }
              const usage = event?.usageMetadata;
              if (usage && typeof usage.candidatesTokenCount === "number") {
                reportedOutputTokens =
                  usage.candidatesTokenCount +
                  (typeof usage.thoughtsTokenCount === "number"
                    ? usage.thoughtsTokenCount
                    : 0);
              }
              const candidate = event?.candidates?.[0];
              const parts: Array<{ text?: string; thought?: boolean }> =
                candidate?.content?.parts ?? [];
              for (const part of parts) {
                if (part.thought || typeof part.text !== "string" || !part.text) continue;
                emittedChars += part.text.length;
                emit({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: part.text },
                });
              }
              const finishReason = candidate?.finishReason;
              if (typeof finishReason === "string" && finishReason.length > 0) {
                if (finishReason !== "STOP") {
                  console.warn("gemini-video finishReason:", finishReason);
                }
                emit({
                  type: "message_delta",
                  delta: { stop_reason: mapFinishReason(finishReason.toLowerCase()) },
                });
              }
            } catch {
              // skip malformed events
            }
          }
        }
        controller.close();
        finish();
      } catch (err) {
        finish();
        console.error("gemini-video stream failed:", err);
        try {
          emit({
            type: "error",
            error: { type: "connection_error", message: "The connection to the model dropped mid-answer." },
          });
        } catch {
          // controller already closed
        }
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

// ── OpenAI-compatible branch (OpenAI, Gemini, future Mistral/OR) ─

/**
 * Generic OpenAI chat-completions caller. The wire shape (model,
 * messages, stream, max_tokens) and the SSE event format are
 * identical across OpenAI, Gemini's OpenAI-compatible endpoint,
 * Mistral, and OpenRouter, so adding a new provider is a row in
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
  enableGrounding = false,
  reasoning = false,
  onUsage?: (outputTokens: number) => void,
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
        // Thinking mode. Gemini's compat layer maps reasoning_effort to
        // thinking_level/thinking_budget; gpt-4o-mini would reject the
        // field, so it only rides on Gemini providers.
        // Without thinking mode keep Gemini's built-in thinking small:
        // faster, cheaper, and the answer gets the token budget.
        ...(providerName.startsWith("gemini")
          ? { reasoning_effort: reasoning ? "medium" : "low" }
          : {}),
        // the last chunk carries usage so the pre-bill can be reconciled
        stream_options: { include_usage: true },
        // Google Search grounding. On the REST wire the Google extensions
        // must sit under a literal "extra_body" key (a top-level "google"
        // key is a 400); only Gemini 3+ honours it, other upstreams
        // ignore the unknown field. See https://ai.google.dev/gemini-api/docs/openai
        ...(enableGrounding
          ? { extra_body: { google: { tools: [{ google_search: {} }] } } }
          : {}),
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

  return openAiToAnthropicSse(upstream.body, onUsage);
}

/**
 * Convert an OpenAI Chat Completions SSE stream into the subset of
 * Anthropic SSE events the browser parses (`content_block_delta`
 * with `text_delta`).
 */
function openAiToAnthropicSse(
  upstream: ReadableStream<Uint8Array>,
  onUsage?: (outputTokens: number) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  // reported by the provider's final usage chunk; else estimated from text
  let reportedOutputTokens: number | null = null;
  let emittedChars = 0;
  const finish = () => {
    if (!onUsage) return;
    onUsage(reportedOutputTokens ?? Math.ceil(emittedChars / 4));
  };

  return new ReadableStream({
    async start(controller) {
      const reader = upstream.getReader();
      const emit = (event: unknown) =>
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
        );
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
              // Upstream error mid-stream (rate limit, provider outage):
              // surface it as an error event instead of dropping silently.
              if (event?.error) {
                const msg =
                  typeof event.error === "string"
                    ? event.error
                    : event.error?.message ?? "upstream error";
                console.error("upstream stream error:", msg);
                emit({ type: "error", error: { type: "api_error", message: msg } });
                continue;
              }
              const usage = event?.usage?.completion_tokens;
              if (typeof usage === "number") reportedOutputTokens = usage;
              const choice = event?.choices?.[0];
              const delta = choice?.delta?.content;
              if (typeof delta === "string" && delta.length > 0) {
                emittedChars += delta.length;
                emit({
                  type: "content_block_delta",
                  index: 0,
                  delta: { type: "text_delta", text: delta },
                });
              }
              // Non-"stop" finish (length, content_filter, recitation,
              // ...): tell the browser why the text ends here.
              const finish = choice?.finish_reason;
              if (typeof finish === "string" && finish.length > 0) {
                if (finish !== "stop") {
                  console.warn("upstream finish_reason:", finish);
                }
                emit({
                  type: "message_delta",
                  delta: { stop_reason: mapFinishReason(finish) },
                });
              }
            } catch {
              // skip malformed events
            }
          }
        }
        controller.close();
        finish();
      } catch (err) {
        finish();
        // Connection dropped mid-stream: send a visible error event before
        // failing the stream, so the client can keep the partial text and
        // explain the cut instead of silently ending mid-word.
        console.error("upstream stream failed:", err);
        try {
          emit({
            type: "error",
            error: { type: "connection_error", message: "The connection to the model dropped mid-answer." },
          });
        } catch {
          // controller already closed, nothing to do
        }
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
  });
}

/** Keep a background promise alive after the response is sent (Supabase
 *  edge runtime); plain fire-and-forget elsewhere. */
function waitUntil(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
  else void p;
}

/** OpenAI finish_reason -> Anthropic stop_reason (what the browser parses). */
function mapFinishReason(finish: string): string {
  if (finish === "stop") return "end_turn";
  if (finish === "length") return "max_tokens";
  if (finish === "tool_calls") return "tool_use";
  // content_filter, recitation, other provider-specific values: keep raw
  return finish;
}

// ── Anthropic branch ─────────────────────────────────────────

/**
 * Calls Anthropic messages, plain or tool-use. Pass `tools` to switch to
 * the tool-use shape (structured `messages` + cached tool schemas); the
 * browser's Anthropic-shaped SSE parser handles both the same way, this
 * proxy only exists to keep the Anthropic key off the client.
 */
async function tryAnthropic(
  apiKey: string,
  systemPrompt: string,
  messages: ChatRequestBody["messages"] | NonNullable<ChatRequestBody["toolMessages"]>,
  maxOutputTokens: number,
  tools?: NonNullable<ChatRequestBody["tools"]>,
): Promise<ReadableStream<Uint8Array> | null> {
  const label = tools ? "Anthropic (tools)" : "Anthropic";
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
        system: cachedSystem(systemPrompt),
        ...(tools ? { tools: withToolCache(tools) } : {}),
        messages,
      }),
    });
  } catch (err) {
    console.error(`${label} request failed:`, err);
    return null;
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    console.error(`${label} returned ${upstream.status}: ${text}`);
    return null;
  }

  return upstream.body;
}
