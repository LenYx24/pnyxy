import {
  streamChatResponse,
  getConfiguredProviders,
  type ChatMessage,
} from "@/lib/ai/ai-client";
import type { AiProvider } from "@/stores/settings-store";

/**
 * Extract text from an image using a vision-capable AI provider.
 *
 * The Pnyxy proxy strips multimodal content for now (free quota is
 * text-only), so OCR routes through the user's own Anthropic /
 * OpenAI key. When neither is configured we surface a clear
 * "needs a vision-capable provider" error instead of silently
 * succeeding with empty output.
 */
// Pnyxy first: the proxy's Gemini / GPT-4o-mini tiers read images fine
// and need no BYOK key.
const VISION_CAPABLE_PROVIDERS: AiProvider[] = ["pnyxy", "anthropic", "openai"];

const OCR_SYSTEM_PROMPT =
  "You are an OCR system. Your job is to transcribe the text from " +
  "the user's image, exactly as it appears. Output only the text, " +
  "no introduction, no commentary, no headings, no markdown fences. " +
  "Preserve line breaks and paragraph breaks where the image has them.";

const OCR_USER_PROMPT =
  "Transcribe the text from this image. Output only the text, no extra commentary.";

export class OcrUnavailableError extends Error {
  constructor() {
    super("ocr-no-vision-provider");
    this.name = "OcrUnavailableError";
  }
}

/** Read a File as raw base64 (no data: prefix). Mirrors the chat
 *  composer helper, duplicated rather than imported to keep OCR
 *  self-contained. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("FileReader returned non-string"));
        return;
      }
      const idx = result.indexOf(",");
      resolve(idx === -1 ? result : result.slice(idx + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export interface OcrOptions {
  /** Optional AbortSignal, wired to the underlying stream so the
   *  user can cancel a slow OCR call. */
  signal?: AbortSignal;
  /** Streaming callback, useful so the UI can render partial text
   *  as the model produces it instead of waiting for the full reply. */
  onDelta?: (delta: string) => void;
}

/** Run OCR on a single image File. Returns the full transcribed text. */
export async function ocrImage(
  file: File,
  options: OcrOptions = {},
): Promise<string> {
  const configured = getConfiguredProviders();
  const visionProvider = VISION_CAPABLE_PROVIDERS.find((p) =>
    configured.includes(p),
  );
  if (!visionProvider) {
    throw new OcrUnavailableError();
  }

  const base64 = await fileToBase64(file);
  const messages: ChatMessage[] = [
    {
      role: "user",
      content: OCR_USER_PROMPT,
      attachments: [
        {
          kind: "image",
          media_type: file.type || "image/jpeg",
          data: base64,
        },
      ],
    },
  ];

  let result = "";
  for await (const chunk of streamChatResponse(messages, "", "", {
    preferredProvider: visionProvider,
    systemPromptOverride: OCR_SYSTEM_PROMPT,
    signal: options.signal,
    // OCR replies can be long for a dense page, let the model spend
    // the tokens it needs instead of truncating mid-sentence.
    maxOutputTokens: 4000,
  })) {
    result += chunk.delta;
    options.onDelta?.(chunk.delta);
  }
  return result.trim();
}
