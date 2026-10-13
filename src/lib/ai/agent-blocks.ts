/**
 * The agent's visible output lives in the assistant message as fenced
 * blocks, so the activity log and cards survive a reload like any other
 * chat widget:
 *   - `pnyxy-step`: one tool step of the activity log (the "munkanapló")
 *   - `pnyxy-folder`: an embedded mini library of one folder
 *   - `pnyxy-offer`: an action card that creates something on Enter
 *   - `pnyxy-agent`: the plain chat model handing the turn to the agent
 * Pure parsing/serialising, no React.
 */
import { HANDOFF_FENCE } from "@/lib/ai/chat-prompts";

export { HANDOFF_FENCE };

export type AgentRefKind =
  | "folder"
  | "book"
  | "chat"
  | "note"
  | "resource"
  | "whiteboard"
  | "url";

/** A clickable path chip: an item in the library or a web source. */
export interface AgentRef {
  k: AgentRefKind;
  /** Item id, or the URL for `url`. */
  id: string;
  label: string;
}

/** How to reverse a step from the log's undo link. */
export type AgentUndo =
  | { op: "move"; kind: string; id: string; to: string | null }
  | { op: "delete_folder"; id: string };

export interface AgentStep {
  /** Tool name; the renderer turns it into a localized sentence. */
  op: string;
  ok: boolean;
  /** True while the tool is still running. */
  run?: boolean;
  refs?: AgentRef[];
  /** Free text detail (search query, error message). */
  q?: string;
  ms?: number;
  undo?: AgentUndo;
  undone?: boolean;
}

export type AgentOfferKind = "whiteboard" | "note";

export interface AgentOffer {
  kind: AgentOfferKind;
  title: string;
  folderId: string | null;
  /** Set once the user created it from the card. */
  createdId?: string;
}

export const STEP_FENCE = "pnyxy-step";
export const FOLDER_FENCE = "pnyxy-folder";
export const OFFER_FENCE = "pnyxy-offer";

function fence(tag: string, value: unknown): string {
  return "```" + tag + "\n" + JSON.stringify(value) + "\n```";
}

export const serializeStep = (s: AgentStep) => fence(STEP_FENCE, s);
export const serializeFolder = (folderId: string) =>
  fence(FOLDER_FENCE, { id: folderId });
export const serializeOffer = (o: AgentOffer) => fence(OFFER_FENCE, o);

const BLOCK_RE = /```(pnyxy-step|pnyxy-folder|pnyxy-offer)\s*([\s\S]*?)```/g;

export interface AgentBlocks {
  cleaned: string;
  steps: AgentStep[];
  folderIds: string[];
  offers: AgentOffer[];
  hasAgentBlocks: boolean;
}

function parseJson(raw: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw.trim());
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function extractAgentBlocks(content: string): AgentBlocks {
  const steps: AgentStep[] = [];
  const folderIds: string[] = [];
  const offers: AgentOffer[] = [];
  let found = false;
  const cleaned = content.replace(BLOCK_RE, (_m, tag: string, body: string) => {
    found = true;
    const v = parseJson(body);
    if (!v) return "";
    if (tag === STEP_FENCE && typeof v.op === "string") {
      steps.push(v as unknown as AgentStep);
    } else if (tag === FOLDER_FENCE && typeof v.id === "string") {
      if (!folderIds.includes(v.id)) folderIds.push(v.id);
    } else if (tag === OFFER_FENCE && typeof v.kind === "string") {
      offers.push(v as unknown as AgentOffer);
    }
    return "";
  });
  return {
    cleaned: found ? cleaned.replace(/\n{3,}/g, "\n\n").trim() : content,
    steps,
    folderIds,
    offers,
    hasAgentBlocks: found,
  };
}

/** Rewrites the n-th offer block (e.g. to record the created id). */
export function replaceOffer(
  content: string,
  index: number,
  next: AgentOffer,
): string {
  let i = -1;
  return content.replace(
    /```pnyxy-offer\s*[\s\S]*?```/g,
    (m) => (++i === index ? serializeOffer(next) : m),
  );
}

/** Marks the n-th step as undone. */
export function markStepUndone(content: string, index: number): string {
  let i = -1;
  return content.replace(/```pnyxy-step\s*([\s\S]*?)```/g, (m, body: string) => {
    if (++i !== index) return m;
    const v = parseJson(body);
    return v ? serializeStep({ ...(v as unknown as AgentStep), undone: true }) : m;
  });
}

/** True when the reply so far is (the start of) the hand-off block, so the
 *  plain stream can stop and hide it before the agent takes over. */
export function isHandoffPrefix(text: string): boolean {
  const t = text.trimStart();
  const tag = "```" + HANDOFF_FENCE;
  return t.length > 0 && (tag.startsWith(t) || t.startsWith(tag));
}

export function isHandoff(text: string): boolean {
  return text.trimStart().startsWith("```" + HANDOFF_FENCE);
}
