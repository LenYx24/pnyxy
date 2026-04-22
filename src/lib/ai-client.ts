import { pdfjs } from "react-pdf";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { supabase } from "@/lib/supabase";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

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

function buildSystemPrompt(documentTitle: string, pageContext: string) {
  return `You are an AI assistant helping the user understand a PDF document titled "${documentTitle}".

Here is the text from the pages the user is currently viewing:

---
${pageContext}
---

Answer questions about this document. Be concise and helpful. Reference specific page numbers when relevant. If the answer is not in the provided text, say so.`;
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
}

export async function* streamChatResponse(
  messages: ChatMessage[],
  documentTitle: string,
  pageContext: string,
  options: StreamOptions = {},
): AsyncGenerator<{ delta: string; provider: AiProvider }, void, unknown> {
  const candidates = getConfiguredProviders();

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

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        messages,
        documentTitle,
        pageContext,
        systemPromptOverride: options.systemPromptOverride,
        maxOutputTokens: options.maxOutputTokens,
      }),
    });
  } catch (err) {
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

  const stream = client.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: options.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    system:
      options.systemPromptOverride ??
      buildSystemPrompt(documentTitle, pageContext),
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });

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
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
  } catch (err) {
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
