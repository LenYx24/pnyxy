/**
 * Interactive simulations in AI replies: the model writes one self-contained
 * HTML document in a ```pnyxy-sim fence (contract: SIM_SPEC in the shared
 * chat-prompts module), InlineSimCard runs it in an isolated frame. Same
 * shape as the other fence parsers, including stripping an unterminated
 * fence while the reply still streams so raw code never flashes.
 */

export interface InlineSim {
  title: string;
  html: string;
}

interface ExtractSimResult {
  cleaned: string;
  sim?: InlineSim;
  pending?: boolean;
}

const FENCE = /```pnyxy-sim\s*([\s\S]*?)```/i;
const OPEN_FENCE = /```pnyxy-sim\s*[\s\S]*$/i;

export { SIM_SPEC } from "./chat-prompts";

export function extractInlineSim(content: string): ExtractSimResult {
  const match = content.match(FENCE);
  if (match) {
    const cleaned = content.replace(FENCE, "").trim();
    const html = match[1].trim();
    if (!/<(script|canvas|svg|body|html)\b/i.test(html)) return { cleaned };
    return { cleaned, sim: { title: titleOf(html), html } };
  }
  const open = content.match(OPEN_FENCE);
  if (open) {
    return { cleaned: content.replace(OPEN_FENCE, "").trim(), pending: true };
  }
  return { cleaned: content };
}

function titleOf(html: string): string {
  const m = html.match(/<title>([^<]{1,80})<\/title>/i);
  return m ? m[1].trim() : "";
}
