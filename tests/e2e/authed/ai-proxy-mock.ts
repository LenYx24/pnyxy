import type { Page } from "@playwright/test";

// In-page mock of the `ai-chat-proxy` Supabase edge function.
//
// The Pnyxy provider parses an Anthropic-style SSE stream
// (`data: {"type":"content_block_delta","delta":{"type":"text_delta",
// "text":...}}`). page.route can only fulfil a whole body at once, which
// makes "stop mid-stream" untestable, so this overrides window.fetch and
// emits one SSE event every CHUNK_MS while honouring the AbortSignal,
// exactly what ai-client expects.
//
// The chat also calls the proxy for helper prompts (conversation title,
// follow-up suggestions). Those get a one-word reply so the sidebar title
// can never collide with the streamed reply text the assertions look for.

export const CHUNK_MS = 150;
export const FIRST_WORDS = "Mocked assistant reply";
export const LAST_WORD = "OMEGAEND";

export interface ProxyCall {
  url: string;
  body: string;
}

declare global {
  interface Window {
    __aiProxyCalls?: ProxyCall[];
  }
}

export const HELPER_PROMPT_RE = /conversation title|follow-up questions/i;

/** Proxy calls made by real chat turns (helper prompts filtered out). */
export async function chatTurnCalls(page: Page): Promise<ProxyCall[]> {
  const calls = await page.evaluate(() => window.__aiProxyCalls ?? []);
  return calls.filter((c) => !/conversation title|follow-up questions/i.test(c.body));
}

export async function installProxyMock(page: Page) {
  await page.addInitScript(
    ({ chunkMs, firstWords, lastWord }) => {
      const words = [
        ...firstWords.split(" ").map((w) => w + " "),
        ...Array.from({ length: 24 }, (_, i) => `token${i} `),
        lastWord,
      ];
      const origFetch = window.fetch.bind(window);
      window.__aiProxyCalls = [];
      window.fetch = async (input, init) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (!url.includes("/functions/v1/ai-chat-proxy")) {
          return origFetch(input, init);
        }
        window.__aiProxyCalls!.push({
          url,
          body: typeof init?.body === "string" ? init.body : "",
        });
        const body = typeof init?.body === "string" ? init.body : "";
        const isHelperPrompt =
          /conversation title|follow-up questions/i.test(body);
        const signal = init?.signal;
        const enc = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            if (isHelperPrompt) {
              const evt = {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: "Helper" },
              };
              controller.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));
              controller.close();
              return;
            }
            let i = 0;
            const push = () => {
              if (signal?.aborted) {
                try {
                  controller.error(new DOMException("aborted", "AbortError"));
                } catch {
                  /* already closed */
                }
                return;
              }
              if (i >= words.length) {
                controller.enqueue(enc.encode("data: [DONE]\n\n"));
                controller.close();
                return;
              }
              const evt = {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: words[i++] },
              };
              controller.enqueue(enc.encode(`data: ${JSON.stringify(evt)}\n\n`));
              setTimeout(push, chunkMs);
            };
            setTimeout(push, chunkMs);
          },
        });
        return new Response(stream, {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      };
    },
    { chunkMs: CHUNK_MS, firstWords: FIRST_WORDS, lastWord: LAST_WORD },
  );
}

