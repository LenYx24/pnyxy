/**
 * Pure parser for the AI's `pnyxy-open-doc` block: a pointer to a file that
 * already exists in the user's library, rendered as a clickable "open" card.
 * The library list (id + title) is injected into the chat context (see
 * chat-stream.ts), and OPEN_DOC_SPEC below teaches the model to emit at most
 * one block, as the last thing, using only a listed id. Lives in a `.ts` so it
 * can be imported without dragging the React renderer along.
 */
export interface OpenDocRef {
  docId: string;
  title: string;
}

interface ExtractResult {
  /** Prose with the open-doc fence stripped. */
  cleaned: string;
  doc?: OpenDocRef;
  /** A fence opened mid-stream but hasn't closed yet. */
  pending?: boolean;
}

const CLOSED = /```pnyxy-open-doc\s*([\s\S]*?)```/i;
const OPEN = /```pnyxy-open-doc\s*([\s\S]*)$/i;

export function extractOpenDoc(content: string): ExtractResult {
  const closed = content.match(CLOSED);
  if (closed) {
    const cleaned = content.replace(closed[0], "").trim();
    try {
      const parsed = JSON.parse(closed[1].trim());
      const docId =
        typeof parsed?.docId === "string" ? parsed.docId.trim() : "";
      const title =
        typeof parsed?.title === "string" ? parsed.title.trim() : "";
      if (docId) return { cleaned, doc: { docId, title } };
    } catch {
      // malformed JSON: drop the fence, keep the prose
    }
    return { cleaned };
  }
  // mid-stream: an open fence with no close yet -> strip it, mark pending so
  // half-written JSON never renders in the prose.
  const open = content.match(OPEN);
  if (open) return { cleaned: content.replace(open[0], "").trim(), pending: true };
  return { cleaned: content };
}

export const OPEN_DOC_SPEC = `When you point the user to a document that already exists in their library (the files are listed in the context under "[Library files]", each with its id), you MAY append ONE fenced code block tagged \`pnyxy-open-doc\` as the very last thing in your reply, containing ONLY this JSON:
\`\`\`pnyxy-open-doc
{"docId": "<the id copied verbatim from the [Library files] list>", "title": "<the file's title>"}
\`\`\`
Rules: use ONLY a docId that appears verbatim in the provided [Library files] list; never invent one. At most one block per reply. Do not mention the block in your prose. Omit it entirely when no library file is relevant.`;
