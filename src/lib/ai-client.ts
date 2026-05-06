import { pdfjs } from "react-pdf";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { supabase } from "@/lib/supabase";
import type { ToolDef } from "@/lib/roadmap-tools";
import type { ChatMessageAttachment } from "@/types/chat";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Multimodal attachments (images today). Provider-side
   *  conversion lives in this file: Anthropic gets a `{type:"image",
   *  source:base64}` block per attachment, OpenAI gets
   *  `{type:"image_url", image_url:{url:dataUri}}`, and the Pnyxy
   *  proxy strips them (text-only until the edge function learns
   *  how to forward multimodal content). */
  attachments?: ChatMessageAttachment[];
}

// ── Tool-use types ───────────────────────────────────────────

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
};
export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ToolMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ToolStopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "other";

export type ToolStreamEvent =
  | { kind: "text_delta"; text: string; provider: AiProvider }
  | {
      kind: "tool_call";
      id: string;
      name: string;
      input: unknown;
      provider: AiProvider;
    }
  | { kind: "stop"; reason: ToolStopReason; provider: AiProvider };

export type AiErrorCode = "quota" | "auth" | "network" | "config" | "other";

/**
 * Error thrown by a single provider attempt. The fallback runner uses
 * `code` to decide whether to swap to the next provider.
 */
export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly provider: AiProvider;
  readonly status?: number;

  constructor(
    message: string,
    code: AiErrorCode,
    provider: AiProvider,
    status?: number,
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.provider = provider;
    this.status = status;
  }
}

// ── Provider configuration helpers ───────────────────────────

export function isProviderConfigured(provider: AiProvider): boolean {
  const settings = useSettingsStore.getState();
  switch (provider) {
    case "pnyxy":
      // Always available — anonymous users get a small per-IP quota.
      return true;
    case "anthropic":
      return !!settings.anthropicApiKey.trim();
    case "openai":
      return !!settings.openaiApiKey.trim();
  }
}

export function getConfiguredProviders(): AiProvider[] {
  return useSettingsStore
    .getState()
    .enabledProviders.filter(isProviderConfigured);
}

export function hasAnyConfiguredProvider(): boolean {
  return getConfiguredProviders().length > 0;
}

// ── PDF text extraction ──────────────────────────────────────

/**
 * Extract text from a range of pages in a PDF.
 */
export async function extractPdfText(
  fileUrl: string,
  startPage: number,
  endPage: number,
): Promise<string> {
  const pdf = await pdfjs.getDocument(fileUrl).promise;
  const pages: string[] = [];

  const from = Math.max(1, startPage);
  const to = Math.min(pdf.numPages, endPage);

  for (let i = from; i <= to; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    if (text.trim()) {
      pages.push(`[Page ${i}]\n${text}`);
    }
  }

  return pages.join("\n\n");
}

// ── Multimodal converters ───────────────────────────────────
//
// A `ChatMessage` may carry image attachments. Anthropic and OpenAI
// each have their own multimodal content shape; these helpers turn
// our internal { content, attachments } into the right wire format.
// When a message has no attachments we emit a plain string so the
// older text-only request shape stays untouched.

type AnthropicImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

const ANTHROPIC_IMAGE_TYPES = new Set<AnthropicImageMediaType>([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function toAnthropicChatContent(message: ChatMessage) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return message.content;
  // Anthropic accepts heterogeneous content blocks. Image blocks
  // first so the model sees the visual context before the prompt
  // (matches Anthropic's own example ordering).
  const blocks: Array<
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: AnthropicImageMediaType;
          data: string;
        };
      }
    | { type: "text"; text: string }
  > = [];
  for (const att of attachments) {
    if (att.kind !== "image") continue;
    if (!ANTHROPIC_IMAGE_TYPES.has(att.media_type as AnthropicImageMediaType)) {
      continue;
    }
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: att.media_type as AnthropicImageMediaType,
        data: att.data,
      },
    });
  }
  if (message.content) blocks.push({ type: "text", text: message.content });
  return blocks;
}

function toOpenAiChatContent(message: ChatMessage) {
  const attachments = message.attachments ?? [];
  if (attachments.length === 0) return message.content;
  // OpenAI's chat completions vision input is `image_url` blocks
  // (also accepts data URIs). A single text block carries the
  // prompt; image blocks come first so the prompt naturally reads
  // as "given these images, …".
  const blocks: Array<
    | { type: "image_url"; image_url: { url: string } }
    | { type: "text"; text: string }
  > = [];
  for (const att of attachments) {
    if (att.kind !== "image") continue;
    blocks.push({
      type: "image_url",
      image_url: {
        url: `data:${att.media_type};base64,${att.data}`,
      },
    });
  }
  if (message.content) blocks.push({ type: "text", text: message.content });
  return blocks;
}

function buildSystemPrompt(documentTitle: string, pageContext: string) {
  // No source document attached → generic chat assistant. The old
  // "you are helping with a PDF" framing was leaking into the
  // free-form /chat surface and steering the model to refuse
  // anything outside the (empty) document context — including
  // perfectly visible image attachments. Treat the empty-context
  // case as plain conversation.
  // Math hint shared by both prompt variants: Pnyxy's chat renderer
  // pipes message bodies through KaTeX, so $inline$ / $$display$$
  // formulas render natively. Without this nudge models tend to fall
  // back to plain-text math like "x^2" or unicode "x²" that loses the
  // typographic clarity their textbook audience needs.
  const mathHint =
    "When you write mathematical expressions, wrap inline math in single-dollar delimiters ($x^2$) and display equations in double-dollar delimiters ($$\\sum_{i=1}^n i$$). The chat UI renders these as proper formulas via KaTeX.";
  const hasDoc = documentTitle.trim().length > 0;
  if (!hasDoc) {
    return `You are Pnyxy's helpful AI assistant. Answer questions clearly and concisely. When the user attaches images, describe or reason about them directly — don't claim you can't see them. Use markdown for code blocks, lists, and tables when it helps readability. ${mathHint}`;
  }
  // The "[p.N]" hint is intentional — Pnyxy's chat renderer
  // post-processes that exact token into a clickable link back to
  // the reader at /reader/<docId>?page=N. Other formats (page 42,
  // P. 42, page-42) won't be linked, so we tell the model the
  // canonical shape.
  return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

Here is the text from the pages the user is currently viewing:

---
${pageContext}
---

Answer questions about this document. Be concise and helpful. When you reference a specific page, cite it inline using the format [p.N] where N is the page number (e.g. "the author's main argument [p.42]"). If the answer is not in the provided text, say so. ${mathHint}`;
}

// ── Top-level streaming with provider fallback ──────────────

/**
 * Stream a chat response, trying each enabled provider in priority
 * order. If a provider fails *before* yielding any tokens (typically
 * a quota / rate-limit / auth error), the next configured provider is
 * tried. Once a provider has started streaming, its errors are
 * surfaced — we cannot cleanly swap mid-response.
 *
 * Yields text deltas. The currently-active provider is exposed via
 * the second tuple value so callers can display it if they want.
 */
export interface StreamOptions {
  /** Replaces the default Q&A system prompt (for quiz generation etc.). */
  systemPromptOverride?: string;
  /** Raises the per-request output cap; clamped server-side for Pnyxy. */
  maxOutputTokens?: number;
  /** Strict mode: when set, ONLY this provider is tried. If it fails
   *  (quota, auth, network), the error surfaces — no fallback to
   *  other configured providers. The chat composer sets this when
   *  the user explicitly picks a model from the dropdown.
   *  When unset / null, the full configured chain is used in order
   *  (the "Default" option in the model picker). */
  preferredProvider?: AiProvider;
  /** When set and aborted, the underlying fetch / SDK call is
   *  cancelled and the async generator throws an AbortError that the
   *  caller is expected to swallow as "user stopped generation."
   *  Threaded down to fetch / Anthropic SDK / OpenAI SSE alike. */
  signal?: AbortSignal;
}

/** True when a thrown error came from the user pressing "Stop." Used
 *  by the chat-store to silently keep partial output instead of
 *  treating it as a failed turn. */
export function isAbortError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "AbortError"
  ) {
    return true;
  }
  return false;
}

export async function* streamChatResponse(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions = {},
): AsyncGenerator<{ delta: string; provider: AiProvider }, void, unknown> {
  const configured = getConfiguredProviders();
  // Strict mode: an explicit preferredProvider runs alone with no
  // fallback. Without one, we run the full configured chain and
  // fall through quota/auth/network failures to the next entry —
  // that's the "Default" UX where the user just wants a working
  // reply and doesn't care which provider produced it.
  const candidates =
    options.preferredProvider && configured.includes(options.preferredProvider)
      ? [options.preferredProvider]
      : configured;

  if (candidates.length === 0) {
    throw new AiProviderError(
      "No AI providers configured. Enable Pnyxy or add an API key in Settings.",
      "config",
      "pnyxy",
    );
  }

  let lastError: Error | null = null;

  for (const provider of candidates) {
    let yielded = false;
    try {
      for await (const delta of streamForProvider(
        provider,
        messages,
        documentTitle,
        pageContext,
        options,
      )) {
        yielded = true;
        yield { delta, provider };
      }
      return; // success — done.
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // If we already streamed some tokens, surface the error — we
      // can't cleanly start over with another provider.
      if (yielded) throw error;
      lastError = error;
      // Otherwise try the next provider in the chain.
    }
  }

  // All providers failed before yielding anything.
  throw lastError ??
    new AiProviderError("All providers failed.", "other", candidates[0]);
}

function streamForProvider(
  provider: AiProvider,
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  switch (provider) {
    case "pnyxy":
      return streamPnyxy(messages, documentTitle, pageContext, options);
    case "anthropic":
      return streamAnthropic(messages, documentTitle, pageContext, options);
    case "openai":
      return streamOpenAi(messages, documentTitle, pageContext, options);
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

// ── Pnyxy provider (proxied via Supabase edge function) ──────

async function* streamPnyxy(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-proxy`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  // Convert each message to its multimodal shape before posting so
  // image attachments survive the trip through the proxy. Messages
  // without attachments still serialize as plain strings (the
  // converter returns m.content unchanged in that case), so the
  // wire format stays backwards-compatible with older proxy
  // deployments that haven't picked up multimodal support yet.
  const proxyMessages = messages.map((m) => ({
    role: m.role,
    content: toAnthropicChatContent(m),
  }));

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        messages: proxyMessages,
        documentTitle,
        pageContext,
        systemPromptOverride: options.systemPromptOverride,
        maxOutputTokens: options.maxOutputTokens,
      }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AiProviderError(
      err instanceof Error ? err.message : "Network error",
      "network",
      "pnyxy",
    );
  }

  if (!response.ok) {
    let errMsg = `AI proxy error (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      // ignore
    }
    throw new AiProviderError(
      errMsg,
      classifyStatus(response.status),
      "pnyxy",
      response.status,
    );
  }

  if (!response.body) {
    throw new AiProviderError(
      "AI proxy returned an empty response",
      "other",
      "pnyxy",
    );
  }

  yield* parseAnthropicSse(response.body);
}

// ── Anthropic provider (user-supplied key, browser-direct) ───

async function* streamAnthropic(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) {
    throw new AiProviderError(
      "Anthropic API key not set.",
      "config",
      "anthropic",
    );
  }

  // Lazily import the SDK so it only loads when this provider is used.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const stream = client.messages.stream(
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      system:
        options.systemPromptOverride ??
        buildSystemPrompt(documentTitle, pageContext),
      messages: messages.map((m) => ({
        role: m.role,
        content: toAnthropicChatContent(m),
      })),
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  try {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield event.delta.text;
      }
    }
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw normalizeSdkError(err, "anthropic");
  }
}

// ── OpenAI provider (user-supplied key, browser-direct) ──────

async function* streamOpenAi(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const apiKey = useSettingsStore.getState().openaiApiKey;
  if (!apiKey) {
    throw new AiProviderError(
      "OpenAI API key not set.",
      "config",
      "openai",
    );
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              options.systemPromptOverride ??
              buildSystemPrompt(documentTitle, pageContext),
          },
          ...messages.map((m) => ({
            role: m.role,
            content: toOpenAiChatContent(m),
          })),
        ],
      }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AiProviderError(
      err instanceof Error ? err.message : "Network error",
      "network",
      "openai",
    );
  }

  if (!response.ok) {
    let errMsg = `OpenAI error (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) errMsg = `OpenAI error (${response.status}): ${text}`;
    }
    throw new AiProviderError(
      errMsg,
      classifyStatus(response.status),
      "openai",
      response.status,
    );
  }

  if (!response.body) {
    throw new AiProviderError(
      "OpenAI returned an empty response",
      "other",
      "openai",
    );
  }

  yield* parseOpenAiSse(response.body);
}

// ── Error classification helpers ─────────────────────────────

function classifyStatus(status: number): AiErrorCode {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "network";
  return "other";
}

function normalizeSdkError(err: unknown, provider: AiProvider): AiProviderError {
  if (err instanceof AiProviderError) return err;
  // Anthropic SDK errors expose a `status` property.
  const anyErr = err as { status?: number; message?: string } | null;
  const status = anyErr?.status;
  const message =
    anyErr?.message ?? (err instanceof Error ? err.message : String(err));
  if (typeof status === "number") {
    return new AiProviderError(message, classifyStatus(status), provider, status);
  }
  return new AiProviderError(message, "other", provider);
}

// ── SSE parsers ──────────────────────────────────────────────

async function* readSseLines(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx;
      while ((nlIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nlIdx).replace(/\r$/, "");
        buffer = buffer.slice(nlIdx + 1);
        if (line.startsWith("data:")) {
          yield line.slice(5).trim();
        }
      }
    }
    if (buffer.startsWith("data:")) {
      yield buffer.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

async function* parseAnthropicSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  for await (const data of readSseLines(body)) {
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      if (
        event?.type === "content_block_delta" &&
        event?.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        yield event.delta.text;
      }
    } catch {
      // skip malformed events
    }
  }
}

async function* parseOpenAiSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, unknown> {
  for await (const data of readSseLines(body)) {
    if (!data || data === "[DONE]") continue;
    try {
      const event = JSON.parse(data);
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta === "string") {
        yield delta;
      }
    } catch {
      // skip malformed events
    }
  }
}

// ── Tool-use streaming (single provider round-trip) ──────────
//
// `streamChatWithTools` yields a normalized event stream — text
// deltas, fully-assembled tool_call events, and a stop event with
// the reason. The orchestrator (chat-store) handles the agentic
// loop: collect tool_call events, dispatch them, append a user
// message with tool_result blocks, and call this generator again
// until stop.reason === "end_turn".
//
// Provider fallback applies the same way as text-only streaming:
// if a provider fails before yielding, try the next one.

export interface StreamWithToolsOptions {
  systemPrompt: string;
  tools: ToolDef[];
  maxOutputTokens?: number;
  preferredProvider?: AiProvider;
  /** Same semantics as `StreamOptions.signal` — aborting cancels the
   *  underlying transport and the generator throws AbortError that the
   *  caller swallows as "user stopped generation." */
  signal?: AbortSignal;
}

export async function* streamChatWithTools(
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const configured = getConfiguredProviders();
  // Same strict-mode semantics as streamChatResponse: explicit pick
  // = only that provider, surface errors. No pick = full fallback
  // chain.
  const candidates =
    options.preferredProvider && configured.includes(options.preferredProvider)
      ? [options.preferredProvider]
      : configured;

  if (candidates.length === 0) {
    throw new AiProviderError(
      "No AI providers configured. Enable Pnyxy or add an API key in Settings.",
      "config",
      "pnyxy",
    );
  }

  let lastError: Error | null = null;

  for (const provider of candidates) {
    let yielded = false;
    try {
      for await (const event of streamToolsForProvider(provider, messages, options)) {
        yielded = true;
        yield event;
      }
      return;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (yielded) throw error;
      lastError = error;
    }
  }

  throw lastError ??
    new AiProviderError("All providers failed.", "other", candidates[0]);
}

function streamToolsForProvider(
  provider: AiProvider,
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  switch (provider) {
    case "pnyxy":
      return streamToolsPnyxy(messages, options);
    case "anthropic":
      return streamToolsAnthropic(messages, options);
    case "openai":
      return streamToolsOpenAi(messages, options);
  }
}

// ── Anthropic tool use (browser-direct) ──────────────────────

async function* streamToolsAnthropic(
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const apiKey = useSettingsStore.getState().anthropicApiKey;
  if (!apiKey) {
    throw new AiProviderError(
      "Anthropic API key not set.",
      "config",
      "anthropic",
    );
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const stream = client.messages.stream(
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      system: options.systemPrompt,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      messages: messages.map(toAnthropicMessage),
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  // Track partial tool_use blocks across content_block_delta events
  // so we can yield a single tool_call event with the parsed input
  // when the block stops.
  const partialTools = new Map<
    number,
    { id: string; name: string; jsonBuf: string }
  >();
  let stopReason: ToolStopReason = "other";

  try {
    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = (event as { content_block: unknown }).content_block as {
          type: string;
          id?: string;
          name?: string;
        };
        if (block.type === "tool_use" && block.id && block.name) {
          partialTools.set(event.index, {
            id: block.id,
            name: block.name,
            jsonBuf: "",
          });
        }
      } else if (event.type === "content_block_delta") {
        const delta = (event as { delta: unknown }).delta as {
          type: string;
          text?: string;
          partial_json?: string;
        };
        if (delta.type === "text_delta" && typeof delta.text === "string") {
          yield { kind: "text_delta", text: delta.text, provider: "anthropic" };
        } else if (
          delta.type === "input_json_delta" &&
          typeof delta.partial_json === "string"
        ) {
          const slot = partialTools.get(event.index);
          if (slot) slot.jsonBuf += delta.partial_json;
        }
      } else if (event.type === "content_block_stop") {
        const slot = partialTools.get(event.index);
        if (slot) {
          let parsed: unknown = {};
          try {
            parsed = slot.jsonBuf ? JSON.parse(slot.jsonBuf) : {};
          } catch {
            parsed = { __parse_error: slot.jsonBuf };
          }
          yield {
            kind: "tool_call",
            id: slot.id,
            name: slot.name,
            input: parsed,
            provider: "anthropic",
          };
          partialTools.delete(event.index);
        }
      } else if (event.type === "message_delta") {
        const reason = (event as { delta?: { stop_reason?: string } }).delta
          ?.stop_reason;
        if (reason === "end_turn") stopReason = "end_turn";
        else if (reason === "tool_use") stopReason = "tool_use";
        else if (reason === "max_tokens") stopReason = "max_tokens";
      }
    }
    yield { kind: "stop", reason: stopReason, provider: "anthropic" };
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw normalizeSdkError(err, "anthropic");
  }
}

// ── Pnyxy proxy tool use (Anthropic-shaped SSE) ──────────────

async function* streamToolsPnyxy(
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat-proxy`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        // The proxy auto-detects tool-mode by the presence of `tools`
        // on the request body and switches to a richer SSE stream.
        toolMessages: messages,
        systemPromptOverride: options.systemPrompt,
        tools: options.tools,
        maxOutputTokens: options.maxOutputTokens,
        // documentTitle/pageContext are unused in tool mode but the
        // proxy still expects the keys for the input-token estimate.
        documentTitle: "",
        pageContext: "",
        messages: [],
      }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AiProviderError(
      err instanceof Error ? err.message : "Network error",
      "network",
      "pnyxy",
    );
  }

  if (!response.ok) {
    let errMsg = `AI proxy error (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      // ignore
    }
    throw new AiProviderError(
      errMsg,
      classifyStatus(response.status),
      "pnyxy",
      response.status,
    );
  }
  if (!response.body) {
    throw new AiProviderError(
      "AI proxy returned an empty response",
      "other",
      "pnyxy",
    );
  }

  yield* parseAnthropicSseTools(response.body, "pnyxy");
}

// Same shape as the SDK loop above but operating on the raw
// Anthropic SSE wire format that the Pnyxy proxy passes through.
async function* parseAnthropicSseTools(
  body: ReadableStream<Uint8Array>,
  provider: AiProvider,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const partialTools = new Map<
    number,
    { id: string; name: string; jsonBuf: string }
  >();
  let stopReason: ToolStopReason = "other";

  for await (const data of readSseLines(body)) {
    if (!data || data === "[DONE]") continue;
    let event: {
      type?: string;
      index?: number;
      content_block?: { type?: string; id?: string; name?: string };
      delta?: {
        type?: string;
        text?: string;
        partial_json?: string;
        stop_reason?: string;
      };
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    if (event.type === "content_block_start" && typeof event.index === "number") {
      const block = event.content_block;
      if (block?.type === "tool_use" && block.id && block.name) {
        partialTools.set(event.index, {
          id: block.id,
          name: block.name,
          jsonBuf: "",
        });
      }
    } else if (
      event.type === "content_block_delta" &&
      typeof event.index === "number"
    ) {
      if (
        event.delta?.type === "text_delta" &&
        typeof event.delta.text === "string"
      ) {
        yield { kind: "text_delta", text: event.delta.text, provider };
      } else if (
        event.delta?.type === "input_json_delta" &&
        typeof event.delta.partial_json === "string"
      ) {
        const slot = partialTools.get(event.index);
        if (slot) slot.jsonBuf += event.delta.partial_json;
      }
    } else if (
      event.type === "content_block_stop" &&
      typeof event.index === "number"
    ) {
      const slot = partialTools.get(event.index);
      if (slot) {
        let parsed: unknown = {};
        try {
          parsed = slot.jsonBuf ? JSON.parse(slot.jsonBuf) : {};
        } catch {
          parsed = { __parse_error: slot.jsonBuf };
        }
        yield {
          kind: "tool_call",
          id: slot.id,
          name: slot.name,
          input: parsed,
          provider,
        };
        partialTools.delete(event.index);
      }
    } else if (event.type === "message_delta") {
      const reason = event.delta?.stop_reason;
      if (reason === "end_turn") stopReason = "end_turn";
      else if (reason === "tool_use") stopReason = "tool_use";
      else if (reason === "max_tokens") stopReason = "max_tokens";
    }
  }
  yield { kind: "stop", reason: stopReason, provider };
}

// ── OpenAI tool use (browser-direct) ─────────────────────────

async function* streamToolsOpenAi(
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const apiKey = useSettingsStore.getState().openaiApiKey;
  if (!apiKey) {
    throw new AiProviderError("OpenAI API key not set.", "config", "openai");
  }

  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        model: "gpt-4o-mini",
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        tools: options.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.input_schema,
          },
        })),
        messages: [
          { role: "system", content: options.systemPrompt },
          ...messages.flatMap(toOpenAiMessages),
        ],
      }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new AiProviderError(
      err instanceof Error ? err.message : "Network error",
      "network",
      "openai",
    );
  }

  if (!response.ok) {
    let errMsg = `OpenAI error (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) errMsg = `OpenAI error (${response.status}): ${text}`;
    }
    throw new AiProviderError(
      errMsg,
      classifyStatus(response.status),
      "openai",
      response.status,
    );
  }
  if (!response.body) {
    throw new AiProviderError(
      "OpenAI returned an empty response",
      "other",
      "openai",
    );
  }

  // OpenAI streams tool-call arguments as partial JSON keyed by
  // `index`; the id/name show up on the first chunk for that slot
  // and the last chunk carries `finish_reason`.
  const partialTools = new Map<
    number,
    { id: string; name: string; jsonBuf: string }
  >();
  let stopReason: ToolStopReason = "other";

  for await (const data of readSseLines(response.body)) {
    if (!data || data === "[DONE]") continue;
    let event: {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            type?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string;
      }>;
    };
    try {
      event = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = event.choices?.[0];
    if (!choice) continue;
    const textDelta = choice.delta?.content;
    if (typeof textDelta === "string" && textDelta.length > 0) {
      yield { kind: "text_delta", text: textDelta, provider: "openai" };
    }
    const tcDeltas = choice.delta?.tool_calls;
    if (tcDeltas) {
      for (const tc of tcDeltas) {
        if (typeof tc.index !== "number") continue;
        let slot = partialTools.get(tc.index);
        if (!slot) {
          slot = {
            id: tc.id ?? `tc-${tc.index}`,
            name: tc.function?.name ?? "",
            jsonBuf: "",
          };
          partialTools.set(tc.index, slot);
        }
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name = tc.function.name;
        if (typeof tc.function?.arguments === "string") {
          slot.jsonBuf += tc.function.arguments;
        }
      }
    }
    if (choice.finish_reason === "tool_calls") stopReason = "tool_use";
    else if (choice.finish_reason === "stop") stopReason = "end_turn";
    else if (choice.finish_reason === "length") stopReason = "max_tokens";
  }

  // Flush completed tool calls. OpenAI doesn't have an analogue of
  // content_block_stop, so we drain at end-of-stream.
  for (const slot of partialTools.values()) {
    if (!slot.name) continue;
    let parsed: unknown = {};
    try {
      parsed = slot.jsonBuf ? JSON.parse(slot.jsonBuf) : {};
    } catch {
      parsed = { __parse_error: slot.jsonBuf };
    }
    yield {
      kind: "tool_call",
      id: slot.id,
      name: slot.name,
      input: parsed,
      provider: "openai",
    };
  }
  yield { kind: "stop", reason: stopReason, provider: "openai" };
}

// ── Cross-provider message-shape converters ──────────────────

function toAnthropicMessage(m: ToolMessage): {
  role: "user" | "assistant";
  content: string | ContentBlock[];
} {
  return { role: m.role, content: m.content };
}

/**
 * One Anthropic-style ToolMessage may explode into multiple OpenAI
 * messages: an assistant turn with tool_use blocks needs a single
 * `assistant` message carrying `tool_calls`, and a user turn with
 * tool_result blocks splits into one `tool` message per result.
 */
function toOpenAiMessages(m: ToolMessage): Array<Record<string, unknown>> {
  if (typeof m.content === "string") {
    return [{ role: m.role, content: m.content }];
  }
  if (m.role === "assistant") {
    const text = m.content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const toolUses = m.content.filter(
      (b): b is ToolUseBlock => b.type === "tool_use",
    );
    const msg: Record<string, unknown> = { role: "assistant" };
    if (text) msg.content = text;
    if (toolUses.length > 0) {
      msg.tool_calls = toolUses.map((b) => ({
        id: b.id,
        type: "function",
        function: {
          name: b.name,
          arguments: JSON.stringify(b.input ?? {}),
        },
      }));
    }
    if (!msg.content && !msg.tool_calls) msg.content = "";
    return [msg];
  }
  // User turn: text and tool_result blocks. Tool results go into
  // `role: "tool"` messages addressed by tool_call_id; remaining
  // text is sent as a normal user message before them.
  const texts = m.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const toolResults = m.content.filter(
    (b): b is ToolResultBlock => b.type === "tool_result",
  );
  const out: Array<Record<string, unknown>> = [];
  if (texts) out.push({ role: "user", content: texts });
  for (const r of toolResults) {
    out.push({
      role: "tool",
      tool_call_id: r.tool_use_id,
      content: r.content,
    });
  }
  return out;
}
