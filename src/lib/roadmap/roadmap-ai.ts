import { streamChatResponse } from "@/lib/ai/ai-client";
import type { RoadmapNode, RoadmapEdge, ResourceRef } from "@/types/roadmap";
import { lookupResources } from "@/lib/roadmap/roadmap-resource-lookup";

export const MIN_ROADMAP_NODES = 3;
export const MAX_ROADMAP_NODES = 20;
export const DEFAULT_ROADMAP_NODES = 8;

/** Nodes + edges with real UUIDs, ready for upsertNode/upsertEdge. */
export interface GeneratedRoadmap {
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
}

export type RoadmapGenerationErrorKind =
  | "empty_topic"
  | "count_out_of_range"
  | "no_response"
  | "parse_failed"
  | "shape_invalid"
  | "provider_error";

export class RoadmapGenerationError extends Error {
  readonly kind: RoadmapGenerationErrorKind;
  readonly cause?: unknown;
  constructor(message: string, kind: RoadmapGenerationErrorKind, cause?: unknown) {
    super(message);
    this.name = "RoadmapGenerationError";
    this.kind = kind;
    this.cause = cause;
  }
}

function buildRoadmapSystemPrompt(maxNodes: number): string {
  return `You are designing a learning roadmap, a directed acyclic graph of
learning units that the user works through. Output ONLY valid JSON,
no preamble, no markdown fence, no commentary.

Shape:
{
  "title": string,                 // a short title for the roadmap
  "description": string,           // 1–2 sentences, plain text
  "nodes": [
    {
      "id": "n1" | "n2" | ...,     // internal label, just for edges
      "title": string,             // a topic to learn (5–60 chars)
      "description": string,       // 1–3 sentences explaining what to learn
      "estimatedMinutes": number,  // realistic minutes for an average learner
      "references": [              // OPTIONAL, see Rules below
        {
          "kind": "book",          // "book", "url", or "youtube"
          "title": string,
          "author": string,        // optional, omit if unknown
          "pageRange": { "from": number, "to": number },  // optional
          "section": string,       // optional, e.g. "Chapter 3.2 - Linear maps"
          "url": string            // required for kind="url" / "youtube"
        }
      ]
    },
    ...
  ],
  "edges": [
    { "source": "n1", "target": "n2" },   // n1 is a prerequisite of n2
    ...
  ]
}

Rules:
- Produce 3 to ${maxNodes} nodes, enough to cover the topic without bloat.
- Sequence the topics from foundational to advanced; the edges encode
  prerequisites (source must be learned before target).
- The graph MUST be a DAG. No cycles. No self-loops. No duplicate edges.
- estimatedMinutes: pick realistic numbers (typically 30–240); don't lump
  every node at the same value.
- Titles are short and concrete ("Linear maps and matrix representations"),
  not vague ("Section 3").
- references: cite 1–3 well-known authoritative sources per node when
  applicable. For STEM / textbook topics this means real, named books
  ("Cormen et al. - Introduction to Algorithms, chapter 22"). Use
  pageRange when you have specific page numbers; otherwise use section
  with the chapter/section name. Use url/youtube only when a free
  online resource is the obvious primary source. Empty array (or
  omitted field) is fine if no sources come to mind, do NOT invent
  fake books just to fill the slot.
- Do not nest objects beyond what's shown. Do not include any field
  other than the ones above.`;
}

function buildRoadmapUserPrompt(topic: string): string {
  return `Topic: ${topic.trim()}`;
}

interface RawNode {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  estimatedMinutes?: unknown;
  references?: unknown;
}

interface RawReference {
  kind?: unknown;
  title?: unknown;
  author?: unknown;
  pageRange?: unknown;
  section?: unknown;
  url?: unknown;
}

interface RawEdge {
  source?: unknown;
  target?: unknown;
}

interface RawRoadmap {
  title?: unknown;
  description?: unknown;
  nodes?: unknown;
  edges?: unknown;
}

function stripCodeFences(text: string): string {
  let out = text.trim();
  if (out.startsWith("```")) {
    out = out.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  }
  // slice from first { to last } in case the model wraps the JSON in prose
  const first = out.indexOf("{");
  const last = out.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1);
  }
  return out.trim();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

interface ValidatedDraft {
  title: string;
  description: string;
  nodes: Array<{
    aiId: string;
    title: string;
    description: string;
    estimatedMinutes: number;
    references: ResourceRef[];
  }>;
  edges: Array<{ source: string; target: string }>;
}

/** Drop malformed reference rows. Survivors carry a `pending` match
 *  marker until the post-generation lookup resolves them. */
function parseReferences(raw: unknown): ResourceRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ResourceRef[] = [];
  for (const r of raw as RawReference[]) {
    if (!r || typeof r !== "object") continue;
    if (!isNonEmptyString(r.title)) continue;
    const kindRaw =
      typeof r.kind === "string" ? r.kind.toLowerCase() : "book";
    const kind: ResourceRef["kind"] =
      kindRaw === "url" || kindRaw === "youtube" || kindRaw === "other"
        ? kindRaw
        : "book";

    let pageRange: ResourceRef["pageRange"];
    if (r.pageRange && typeof r.pageRange === "object") {
      const pr = r.pageRange as { from?: unknown; to?: unknown };
      if (
        typeof pr.from === "number" &&
        Number.isFinite(pr.from) &&
        typeof pr.to === "number" &&
        Number.isFinite(pr.to) &&
        pr.from > 0 &&
        pr.to >= pr.from
      ) {
        pageRange = {
          from: Math.round(pr.from),
          to: Math.round(pr.to),
        };
      }
    }

    out.push({
      kind,
      title: r.title.trim(),
      author: isNonEmptyString(r.author) ? r.author.trim() : undefined,
      pageRange,
      section: isNonEmptyString(r.section) ? r.section.trim() : undefined,
      url: isNonEmptyString(r.url) ? r.url.trim() : undefined,
      match: { source: "pending" },
    });
    // cap at 5 cites per node
    if (out.length >= 5) break;
  }
  return out;
}

function validateDraft(raw: unknown): ValidatedDraft {
  if (!raw || typeof raw !== "object") {
    throw new RoadmapGenerationError(
      "AI response was not an object.",
      "shape_invalid",
    );
  }
  const r = raw as RawRoadmap;
  if (!isNonEmptyString(r.title)) {
    throw new RoadmapGenerationError(
      "AI response is missing the title.",
      "shape_invalid",
    );
  }
  if (!Array.isArray(r.nodes) || r.nodes.length < MIN_ROADMAP_NODES) {
    throw new RoadmapGenerationError(
      "AI response has too few nodes.",
      "shape_invalid",
    );
  }
  if (!Array.isArray(r.edges)) {
    throw new RoadmapGenerationError(
      "AI response is missing the edges list.",
      "shape_invalid",
    );
  }

  const seenIds = new Set<string>();
  const nodes: ValidatedDraft["nodes"] = [];
  for (const raw of r.nodes as RawNode[]) {
    if (!raw || typeof raw !== "object") continue;
    if (
      !isNonEmptyString(raw.id) ||
      !isNonEmptyString(raw.title) ||
      typeof raw.estimatedMinutes !== "number" ||
      !Number.isFinite(raw.estimatedMinutes)
    )
      continue;
    const id = raw.id.trim();
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    nodes.push({
      aiId: id,
      title: raw.title.trim(),
      description: isNonEmptyString(raw.description) ? raw.description.trim() : "",
      // clamp; models sometimes return hours as minutes
      estimatedMinutes: Math.max(
        5,
        Math.min(600, Math.round(raw.estimatedMinutes)),
      ),
      references: parseReferences(raw.references),
    });
  }
  if (nodes.length < MIN_ROADMAP_NODES) {
    throw new RoadmapGenerationError(
      "Not enough valid nodes after filtering.",
      "shape_invalid",
    );
  }

  const validIds = new Set(nodes.map((n) => n.aiId));
  const edgeKeys = new Set<string>();
  const edges: ValidatedDraft["edges"] = [];
  for (const raw of r.edges as RawEdge[]) {
    if (!raw || typeof raw !== "object") continue;
    if (!isNonEmptyString(raw.source) || !isNonEmptyString(raw.target)) continue;
    const source = raw.source.trim();
    const target = raw.target.trim();
    if (source === target) continue;
    if (!validIds.has(source) || !validIds.has(target)) continue;
    const key = `${source}->${target}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    edges.push({ source, target });
  }

  return {
    title: r.title.trim(),
    description: isNonEmptyString(r.description) ? r.description.trim() : "",
    nodes,
    edges,
  };
}

/** Drop edges that would close a cycle. Order-stable: earlier edges win. */
function dropCycles<T extends { source: string; target: string }>(
  edges: T[],
): T[] {
  const liveAdj = new Map<string, string[]>();
  // adding source->target closes a cycle iff target already reaches source
  const reaches = (from: string, target: string): boolean => {
    const visited = new Set<string>();
    const queue = [from];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === target) return true;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const n of liveAdj.get(cur) ?? []) queue.push(n);
    }
    return false;
  };
  const accepted: T[] = [];
  for (const e of edges) {
    if (reaches(e.target, e.source)) continue;
    accepted.push(e);
    if (!liveAdj.has(e.source)) liveAdj.set(e.source, []);
    liveAdj.get(e.source)!.push(e.target);
  }
  return accepted;
}

/** Generate a roadmap draft from a topic. Caller is responsible for saving it. */
export async function generateRoadmap({
  topic,
  maxNodes = DEFAULT_ROADMAP_NODES,
  signal,
}: {
  topic: string;
  maxNodes?: number;
  signal?: AbortSignal;
}): Promise<{
  title: string;
  description: string;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
}> {
  const trimmedTopic = topic.trim();
  if (!trimmedTopic) {
    throw new RoadmapGenerationError(
      "A topic is required.",
      "empty_topic",
    );
  }
  if (
    !Number.isInteger(maxNodes) ||
    maxNodes < MIN_ROADMAP_NODES ||
    maxNodes > MAX_ROADMAP_NODES
  ) {
    throw new RoadmapGenerationError(
      `Node count must be between ${MIN_ROADMAP_NODES} and ${MAX_ROADMAP_NODES}.`,
      "count_out_of_range",
    );
  }

  let buf = "";
  try {
    for await (const chunk of streamChatResponse(
      [{ role: "user", content: buildRoadmapUserPrompt(trimmedTopic) }],
      "",
      "",
      {
        systemPromptOverride: buildRoadmapSystemPrompt(maxNodes),
        // headroom for a 20-node roadmap
        maxOutputTokens: 4000,
      },
    )) {
      if (signal?.aborted) {
        throw new RoadmapGenerationError(
          "Generation cancelled.",
          "provider_error",
        );
      }
      buf += chunk.delta;
    }
  } catch (err) {
    if (err instanceof RoadmapGenerationError) throw err;
    throw new RoadmapGenerationError(
      err instanceof Error ? err.message : "Provider error.",
      "provider_error",
      err,
    );
  }

  if (!buf.trim()) {
    throw new RoadmapGenerationError(
      "AI returned no content.",
      "no_response",
    );
  }

  const cleaned = stripCodeFences(buf);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new RoadmapGenerationError(
      "AI response wasn't valid JSON.",
      "parse_failed",
      err,
    );
  }
  const draft = validateDraft(parsed);

  // map AI ids (n1, n2, ...) to real UUIDs
  const idMap = new Map<string, string>();
  for (const n of draft.nodes) idMap.set(n.aiId, crypto.randomUUID());

  // one lookup across all refs; on failure mark them "none" and carry on
  const allRefs = draft.nodes.flatMap((n) => n.references);
  let matchedRefs: ResourceRef[];
  try {
    matchedRefs = await lookupResources(allRefs);
  } catch {
    matchedRefs = allRefs.map((r) => ({
      ...r,
      match: { source: "none" as const },
    }));
  }
  // slice the flat matched list back out per node, in order
  let cursor = 0;
  const nodes: RoadmapNode[] = draft.nodes.map((n) => {
    const refsForNode = matchedRefs.slice(cursor, cursor + n.references.length);
    cursor += n.references.length;
    return {
      id: idMap.get(n.aiId)!,
      type: "text",
      title: n.title,
      description: n.description,
      estimatedMinutes: n.estimatedMinutes,
      payload: refsForNode.length > 0 ? { references: refsForNode } : undefined,
    };
  });

  const safeEdges = dropCycles(draft.edges).map((e) => ({
    id: crypto.randomUUID(),
    source: idMap.get(e.source)!,
    target: idMap.get(e.target)!,
  }));

  return {
    title: draft.title,
    description: draft.description,
    nodes,
    edges: safeEdges,
  };
}
