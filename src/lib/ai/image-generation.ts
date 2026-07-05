import { useSettingsStore } from "@/stores/settings-store";

/**
 * Image generation via OpenAI's Images API. OpenAI-only: Claude and the
 * proxy are text-only, and local models don't expose an image endpoint.
 *
 * We request b64 output and store the bytes on the attachment row rather
 * than mirroring OpenAI's short-lived hosted URLs. ~1.5 MB per 1024² PNG.
 *
 * Billed through the user's own openaiApiKey.
 */

const ENDPOINT = "https://api.openai.com/v1/images/generations";

// dall-e-3 is the fallback for accounts without gpt-image-1 access.
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
  /** Raw base64, no `data:` prefix. Matches ChatMessageAttachment.data. */
  data: string;
  media_type: string;
  prompt: string;
  /** Model that produced the bytes; may be the fallback. */
  model: string;
}

export interface ImageGenOptions {
  signal?: AbortSignal;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
}

/** Generate one image from a text prompt. Throws on config/network failure. */
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
      // 404/400 usually means the account can't use gpt-image-1. dall-e-3
      // defaults to URLs, so force b64_json.
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
