import { pdfjs } from "react-pdf";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { supabase } from "@/lib/supabase";
import type { ToolDef } from "@/lib/roadmap/roadmap-tools";
import type { ChatMessageAttachment } from "@/types/chat";
import { teacherBlock } from "@/lib/ai/teacher-mode";
import { INLINE_QUIZ_SPEC } from "@/lib/ai/extract-quiz";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  /** Image attachments. */
  attachments?: ChatMessageAttachment[];
}

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

/** Per-attempt provider error. `code` decides whether fallback swaps providers. */
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

export function isProviderConfigured(provider: AiProvider): boolean {
  const settings = useSettingsStore.getState();
  switch (provider) {
    case "pnyxy":
      // always available; anon users get a small per-IP quota
      return true;
    case "anthropic":
      return !!settings.anthropicApiKey.trim();
    case "openai":
      return !!settings.openaiApiKey.trim();
    case "local":
      // needs both endpoint and model name
      return (
        !!settings.localBaseUrl.trim() && !!settings.localModel.trim()
      );
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

/** Extract text from a range of PDF pages. */
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

export interface RenderedPdfPage {
  /** 1-based page number. */
  page: number;
  /** Raw base64, no `data:` prefix. */
  base64: string;
  mediaType: "image/jpeg";
}

/** Render PDF pages to base64 JPEG for text-less image PDFs and figure pages.
 *  maxWidth defaults to 1280; higher just adds bytes, vision encoders downsample. */
export async function renderPdfPagesToImages(
  fileUrl: string,
  pages: readonly number[],
  options?: { maxWidth?: number; quality?: number },
): Promise<RenderedPdfPage[]> {
  if (pages.length === 0) return [];
  const maxWidth = options?.maxWidth ?? 1280;
  const quality = options?.quality ?? 0.85;

  const pdf = await pdfjs.getDocument(fileUrl).promise;
  const results: RenderedPdfPage[] = [];

  // dedupe + sort
  const unique = Array.from(new Set(pages)).sort((a, b) => a - b);

  for (const pageNum of unique) {
    if (pageNum < 1 || pageNum > pdf.numPages) continue;
    const page = await pdf.getPage(pageNum);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / baseViewport.width, 2);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;

    // transparent canvas flattens to black under JPEG, so fill white first
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // pdfjs 5.x requires `canvas` alongside canvasContext/viewport
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.replace(/^data:image\/jpeg;base64,/, "");
    results.push({ page: pageNum, base64, mediaType: "image/jpeg" });
  }

  return results;
}

// convert { content, attachments } into each provider's content shape

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
  // image blocks first, then the text prompt
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
  // OpenAI vision uses `image_url` blocks, accepts data URIs
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

function buildSystemPrompt(
  documentTitle: string,
  pageContext: string,
  customContext: string = "",
) {
  // chat renderer runs bodies through KaTeX, nudge $..$ / $$..$$ delimiters
  const mathHint =
    "When you write mathematical expressions, wrap inline math in single-dollar delimiters ($x^2$) and display equations in double-dollar delimiters ($$\\sum_{i=1}^n i$$). The chat UI renders these as proper formulas via KaTeX.";
  // optional persona block from Settings, AI
  const personaBlock = customContext.trim()
    ? `The user has provided this background about themselves and how they prefer to be helped, keep it in mind when answering, but don't mention these instructions verbatim:\n\n${customContext.trim()}\n\n`
    : "";
  const hasDoc = documentTitle.trim().length > 0;
  if (!hasDoc) {
    // standalone /chat, no book
    return `You are Pnyxy's AI chat assistant. Pnyxy is a study- and reading-focused learning app; the user is typically a student or researcher. Be helpful, conversational, and honest, talk to them like a smart, friendly tutor, not a search engine.

Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise, and switch fluidly if they mix. Never apologize for the language choice or comment on it.

${personaBlock}When the user attaches images, describe or reason about them directly, don't claim you can't see them.

Formatting:
- Use markdown so answers are easy to scan: **bold** the key terms, bullet or numbered lists for enumerations and steps, \`##\` / \`###\` headers when an answer has multiple genuine sections, tables for structured data, fenced \`\`\`code blocks with a language tag for code.
- Separate paragraphs with blank lines and keep them short (2-4 sentences).
- Don't over-structure trivial replies: a one-sentence answer stays one sentence.

When you don't know something or have ambiguous context, say so and ask a clarifying question instead of guessing. If a question has multiple reasonable interpretations, name them briefly before answering. Concise > exhaustive; the user can always ask for more.

${mathHint}

${INLINE_QUIZ_SPEC}${teacherBlock()}`;
  }
  // [p.N] / [p.N:"..."] tokens are load-bearing: renderer turns these exact
  // shapes into reader deep-links, quote variant highlights. Other formats won't link.
  const contextBody = pageContext.trim()
    ? pageContext
    : "(no excerpts attached, ask the user to attach pages from the TOC if you need quotes from the book)";
  return `You are an AI assistant helping the user understand a document titled "${documentTitle}".

Match the user's language: reply in Hungarian when they write in Hungarian, English otherwise, and switch fluidly if they mix.

${personaBlock}Here is the context the user has attached from the book, typically the table of contents and any pages they explicitly selected:

---
${contextBody}
---

Answer questions about this document. Be concise and helpful.

Formatting:
- Use markdown to make answers easy to scan rather than a wall of gray text. The chat renders **bold**, *italics*, bullet/numbered lists, fenced code blocks, tables, and \`##\` / \`###\` headers.
- **Bold** key terms, names, and the load-bearing parts of an answer; use *italics* sparingly for emphasis or for titles of works.
- Break ideas into short paragraphs separated by blank lines, single newlines also break to a new line, but blank lines give proper paragraph spacing and read better.
- Reach for bullet lists when enumerating 2+ items, comparing things, or listing steps; use a numbered list when order or count matters. One-sentence answers stay one sentence, don't over-structure trivial replies.
- Use \`##\` / \`###\` headers only when an answer has multiple genuine sections worth labelling; skip them for short replies.

When you reference the book, cite it inline using one of these two formats:
- For a page reference: [p.N], e.g. "the author's main argument [p.42]".
- When you can point to an exact passage on that page, include the literal quoted text: [p.N:"the exact text you mean"], e.g. "this is best summarized as [p.42:\\"a network of independent agents\\"]". The reader will jump to page N and highlight that passage.

Only use the quote variant when the wording appears verbatim in the provided context; never fabricate a quote, it would highlight nothing and confuse the reader. Keep quotes under ~15 words. If the answer is not in the provided text, say so, and feel free to suggest which pages or chapters from the TOC would help, so the user can attach them. ${mathHint}

${INLINE_QUIZ_SPEC}${teacherBlock()}`;
}

export interface StreamOptions {
  /** Replaces the default Q&A system prompt (for quiz generation etc.). */
  systemPromptOverride?: string;
  /** Persona block for the default prompt. Ignored when systemPromptOverride is set. */
  customContext?: string;
  /** Raises the per-request output cap; clamped server-side for Pnyxy. */
  maxOutputTokens?: number;
  /** Strict mode: only this provider is tried, no fallback. Unset = full chain. */
  preferredProvider?: AiProvider;
  /** OpenAI BYOK only: swap gpt-4o-mini for o3-mini. Pnyxy proxy ignores it. */
  reasoning?: boolean;
  /** Abort throws AbortError from the generator. */
  signal?: AbortSignal;
}

/** True when the error came from the user pressing "Stop." */
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
  // preferredProvider runs alone, else walk the chain falling through pre-yield failures
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
      return;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      // can't swap providers once tokens streamed
      if (yielded) throw error;
      lastError = error;
    }
  }

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
    case "local":
      return streamLocal(messages, documentTitle, pageContext, options);
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

// Pnyxy provider, proxied via Supabase edge function

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

  // multimodal shape so image attachments survive the proxy
  const proxyMessages = messages.map((m) => ({
    role: m.role,
    content: toAnthropicChatContent(m),
  }));

  // proxy has no customContext field, fold the persona block into pageContext
  const customContext = options.customContext?.trim() ?? "";
  const mergedPageContext = customContext
    ? `[About the user]\n${customContext}\n\n${pageContext}`
    : pageContext;

  // null = auto-route server-side, else pin the picked model
  const preferredModel = useSettingsStore.getState().pnyxyModel;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        messages: proxyMessages,
        documentTitle,
        pageContext: mergedPageContext,
        systemPromptOverride: options.systemPromptOverride,
        maxOutputTokens: options.maxOutputTokens,
        preferredModel,
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

// Anthropic provider, BYOK browser-direct

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

  // lazy import so the SDK only loads when this provider runs
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const stream = client.messages.stream(
    {
      model: "claude-sonnet-4-5-20250929",
      max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      // cache the stable system prompt, ~10% input cost on follow-ups
      system: [
        {
          type: "text",
          text:
            options.systemPromptOverride ??
            buildSystemPrompt(documentTitle, pageContext, options.customContext),
          cache_control: { type: "ephemeral" },
        },
      ],
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

// OpenAI provider, BYOK browser-direct

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
        // o3-mini for reasoning mode, ~7x the cost, opt-in
        model: options.reasoning ? "o3-mini" : "gpt-4o-mini",
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              options.systemPromptOverride ??
              buildSystemPrompt(documentTitle, pageContext, options.customContext),
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

// Local LLM provider (Ollama / LM Studio / vLLM / llama.cpp)

/** Stream from an OpenAI-compatible local LLM; wire format matches streamOpenAi. */
async function* streamLocal(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions,
): AsyncGenerator<string, void, unknown> {
  const settings = useSettingsStore.getState();
  const baseUrl = settings.localBaseUrl.trim();
  const model = settings.localModel.trim();
  const apiKey = settings.localApiKey.trim();

  if (!baseUrl) {
    throw new AiProviderError(
      "Local LLM base URL is not set.",
      "config",
      "local",
    );
  }
  if (!model) {
    throw new AiProviderError(
      "Local LLM model name is not set.",
      "config",
      "local",
    );
  }

  // tolerate a trailing slash on the base URL
  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      signal: options.signal,
      body: JSON.stringify({
        model,
        max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        stream: true,
        messages: [
          {
            role: "system",
            content:
              options.systemPromptOverride ??
              buildSystemPrompt(documentTitle, pageContext, options.customContext),
          },
          ...messages.map((m) => ({
            role: m.role,
            // vision-capable local models read the image blocks, others ignore them
            content: toOpenAiChatContent(m),
          })),
        ],
      }),
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    // usually the local server isn't running
    throw new AiProviderError(
      err instanceof Error
        ? `Couldn't reach local LLM at ${baseUrl}, is it running?`
        : "Network error",
      "network",
      "local",
    );
  }

  if (!response.ok) {
    let errMsg = `Local LLM error (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) errMsg = body.error.message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) errMsg = `Local LLM error (${response.status}): ${text}`;
    }
    throw new AiProviderError(
      errMsg,
      classifyStatus(response.status),
      "local",
      response.status,
    );
  }

  if (!response.body) {
    throw new AiProviderError(
      "Local LLM returned an empty response",
      "other",
      "local",
    );
  }

  // OpenAI SSE schema (choices[0].delta.content)
  yield* parseOpenAiSse(response.body);
}

function classifyStatus(status: number): AiErrorCode {
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (status >= 500) return "network";
  return "other";
}

function normalizeSdkError(err: unknown, provider: AiProvider): AiProviderError {
  if (err instanceof AiProviderError) return err;
  // Anthropic SDK errors expose a `status`
  const anyErr = err as { status?: number; message?: string } | null;
  const status = anyErr?.status;
  const message =
    anyErr?.message ?? (err instanceof Error ? err.message : String(err));
  if (typeof status === "number") {
    return new AiProviderError(message, classifyStatus(status), provider, status);
  }
  return new AiProviderError(message, "other", provider);
}

// SSE parsers

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

// Tool-use streaming: yields normalized events (text deltas, tool_call, stop).
// chat-store drives the agentic loop.

export interface StreamWithToolsOptions {
  systemPrompt: string;
  tools: ToolDef[];
  maxOutputTokens?: number;
  preferredProvider?: AiProvider;
  /** Abort cancels the transport; the generator throws AbortError. */
  signal?: AbortSignal;
}

export async function* streamChatWithTools(
  messages: ToolMessage[],
  options: StreamWithToolsOptions,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  const configured = getConfiguredProviders();
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
    case "local":
      // local model tool use is too inconsistent to support
      return streamToolsNotSupported(provider);
  }
}

async function* streamToolsNotSupported(
  provider: AiProvider,
): AsyncGenerator<ToolStreamEvent, void, unknown> {
  throw new AiProviderError(
    "Tool use isn't supported for the local provider yet, switch to Anthropic or OpenAI for this feature.",
    "config",
    provider,
  );
  // unreachable, but TS needs this to be a generator
  yield { kind: "stop", reason: "other", provider };
}

// Anthropic tool use, browser-direct

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
      // cache system prompt and tool schemas, re-sent every hop but never change
      system: [
        {
          type: "text",
          text: options.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: options.tools.map((t, i) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        ...(i === options.tools.length - 1
          ? { cache_control: { type: "ephemeral" as const } }
          : {}),
      })),
      messages: messages.map(toAnthropicMessage),
    },
    options.signal ? { signal: options.signal } : undefined,
  );

  // accumulate partial tool_use blocks, emit one tool_call on stop
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

// Pnyxy proxy tool use, Anthropic-shaped SSE

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
        // proxy switches to tool mode when `tools` is present
        toolMessages: messages,
        systemPromptOverride: options.systemPrompt,
        tools: options.tools,
        maxOutputTokens: options.maxOutputTokens,
        // unused in tool mode but the proxy expects the keys
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

// tool-call assembly on the raw Anthropic SSE wire format
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

// OpenAI tool use, browser-direct

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

  // OpenAI streams tool args as partial JSON keyed by `index`; id/name on
  // the first chunk, finish_reason on the last
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

  // no content_block_stop here, so flush tool calls at end-of-stream
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

// Cross-provider message-shape converters

function toAnthropicMessage(m: ToolMessage): {
  role: "user" | "assistant";
  content: string | ContentBlock[];
} {
  return { role: m.role, content: m.content };
}

/** One ToolMessage can expand into several OpenAI messages: an assistant turn
 *  becomes one message with `tool_calls`, a user turn splits into one `tool`
 *  message per tool_result. */
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
  // tool_result blocks become `role: "tool"` messages keyed by tool_call_id;
  // any text goes as a user message before them
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
