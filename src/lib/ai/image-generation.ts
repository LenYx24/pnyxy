import { useSettingsStore } from "@/stores/settings-store";

/**
 * Image generation via OpenAI's Images API.
 *
 * Why OpenAI direct only:
 *   - Anthropic Claude doesn't generate images (text + tool-use only).
 *   - The Pnyxy proxy strips multimodal payloads (text-only for now).
 *   - Local models (Ollama / LM Studio) speak the OpenAI chat
 *     completions API but not the image-generation endpoint.
 *
 * Why base64 (not URL):
 *   - OpenAI returns hosted-image URLs that expire after a short
 *     window (varies by model; treat as "hours, not days"). Chat
 *     history needs to survive forever, so we'd have to mirror to
 *     Supabase Storage immediately. Easier path: ask for b64 in the
 *     response and store the bytes directly in the message's
 *     attachment row. The DB cost is small (~1.5 MB per 1024² PNG
 *     base64-encoded) and the persistence story stays simple — no
 *     storage bucket, no expiring-URL bookkeeping.
 *
 * Cost: gpt-image-1 is ~$0.04–0.19 per image (2026 pricing), billed
 * through the user's own OpenAI key. Same auth path as OCR / chat
 * with `openai` provider — `settings.openaiApiKey` must be set.
 */

const ENDPOINT = "https://api.openai.com/v1/images/generations";

/** Default model. gpt-image-1 is OpenAI's current image leader
 *  (2025-onwards); DALL-E 3 is the legacy fallback if the user's
 *  account doesn't have gpt-image-1 enabled yet. We try the modern
 *  one first and fall back on 404 / unsupported errors. */
const PRIMARY_MODEL = "gpt-image-1";
const FALLBACK_MODEL = "dall-e-3";

export class ImageGenUnavailableError extends Error {
  constructor() {
    super("image-gen-no-openai-key");
    this.name = "ImageGenUnavailableError";
  }
}

export class ImageGenError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "ImageGenError";
    this.status = status;
  }
}

export interface GeneratedImage {
  /** Raw base64 (no `data:` prefix). Matches the
   *  `ChatMessageAttachment.data` shape so it drops straight into
   *  the existing attachment renderer. */
  data: string;
  /** Always "image/png" today — gpt-image-1 and DALL-E 3 both
   *  return PNGs. Future models that emit JPEG/WEBP would set this
   *  appropriately. */
  media_type: string;
  /** The prompt the user actually submitted. Stored so the chat
   *  bubble can show a caption — also useful for "regenerate". */
  prompt: string;
  /** The model that actually produced the bytes. May differ from
   *  the primary if we fell back. */
  model: string;
}

export interface ImageGenOptions {
  signal?: AbortSignal;
  /** Square output is the lowest-cost / fastest default. The chat
   *  UI doesn't expose other sizes yet; this option is here so we
   *  can wire a size picker in later without rewriting the lib. */
  size?: "1024x1024" | "1024x1536" | "1536x1024";
}

/**
 * Generate a single image from a text prompt. Throws on
 * configuration or network failure; the chat-store catches and
 * renders an inline error bubble.
 */
export async function generateImage(
  prompt: string,
  options: ImageGenOptions = {},
): Promise<GeneratedImage> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    throw new ImageGenError("Image prompt is empty.", null);
  }

  const apiKey = useSettingsStore.getState().openaiApiKey.trim();
  if (!apiKey) {
    throw new ImageGenUnavailableError();
  }

  const size = options.size ?? "1024x1024";

  // Try the primary model first; if the response complains that
  // the model is unknown or unsupported on this account, fall back
  // to DALL-E 3 with the response_format hint that legacy model
  // requires for b64 output.
  const attempt = async (
    model: string,
    extraBody: Record<string, unknown> = {},
  ): Promise<Response> => {
    return fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: options.signal,
      body: JSON.stringify({
        model,
        prompt: trimmed,
        n: 1,
        size,
        ...extraBody,
      }),
    });
  };

  let response: Response;
  let model = PRIMARY_MODEL;
  try {
    response = await attempt(PRIMARY_MODEL);
    if (response.status === 404 || response.status === 400) {
      // Best signal we have for "your account can't use this model"
      // — try the legacy DALL-E 3. response_format:"b64_json" forces
      // base64 output (gpt-image-1 returns b64 by default; DALL-E 3
      // defaults to URLs unless you ask).
      model = FALLBACK_MODEL;
      response = await attempt(FALLBACK_MODEL, {
        response_format: "b64_json",
      });
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ImageGenError(
      err instanceof Error ? err.message : "Network error",
      null,
    );
  }

  if (!response.ok) {
    let message = `OpenAI image generation failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.error?.message) message = body.error.message;
    } catch {
      const text = await response.text().catch(() => "");
      if (text) message = `${message}: ${text}`;
    }
    throw new ImageGenError(message, response.status);
  }

  const json = (await response.json()) as {
    data?: Array<{ b64_json?: string; revised_prompt?: string }>;
  };
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    throw new ImageGenError(
      "OpenAI returned an empty image payload.",
      response.status,
    );
  }

  return {
    data: b64,
    media_type: "image/png",
    prompt: trimmed,
    model,
  };
}
