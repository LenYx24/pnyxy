import type { Roadmap, RoadmapEdge, RoadmapNode } from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmap-store";

// Tool schemas

export interface ToolDef {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ROADMAP_TOOLS: ToolDef[] = [
  {
    name: "add_node",
    description:
      "Add a new learning unit to the roadmap. Returns the short label (e.g. 'n5') you should use to reference this node in subsequent add_edge / update_node / remove_node calls in the same turn.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title (5–60 chars)." },
        description: {
          type: "string",
          description: "1–3 sentences explaining what to learn.",
        },
        estimatedMinutes: {
          type: "number",
          description:
            "Realistic minutes for an average learner (typically 30–240).",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "update_node",
    description:
      "Edit an existing node's title, description, or estimated time. Pass only the fields you want to change.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The short label of the node (e.g. 'n3').",
        },
        title: { type: "string" },
        description: { type: "string" },
        estimatedMinutes: { type: "number" },
      },
      required: ["id"],
    },
  },
  {
    name: "remove_node",
    description:
      "Delete a node and any edges that touch it. Cannot be undone in the same turn.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The short label of the node to remove (e.g. 'n3').",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "add_edge",
    description:
      "Add a prerequisite edge: source must be learned before target. The graph is enforced acyclic, edges that would close a cycle are rejected.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Short label of the prerequisite node." },
        target: { type: "string", description: "Short label of the dependent node." },
      },
      required: ["source", "target"],
    },
  },
  {
    name: "remove_edge",
    description: "Remove a prerequisite edge between two nodes.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string" },
        target: { type: "string" },
      },
      required: ["source", "target"],
    },
  },
  {
    name: "update_roadmap_meta",
    description: "Edit the roadmap's title or description.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
      },
    },
  },
];

// Model sees short labels (n1, n2, ...) instead of UUIDs. Seeded from
// node order at turn start, extended as add_node runs.
export class LabelMap {
  private labelToId = new Map<string, string>();
  private idToLabel = new Map<string, string>();
  private nextIdx: number;

  constructor(nodes: RoadmapNode[]) {
    nodes.forEach((n, i) => {
      const label = `n${i + 1}`;
      this.labelToId.set(label, n.id);
      this.idToLabel.set(n.id, label);
    });
    this.nextIdx = nodes.length + 1;
  }

  resolve(label: string): string | null {
    return this.labelToId.get(label) ?? null;
  }

  labelFor(id: string): string | null {
    return this.idToLabel.get(id) ?? null;
  }

  register(id: string): string {
    const label = `n${this.nextIdx++}`;
    this.labelToId.set(label, id);
    this.idToLabel.set(id, label);
    return label;
  }

  forget(id: string): void {
    const label = this.idToLabel.get(id);
    if (label) {
      this.labelToId.delete(label);
      this.idToLabel.delete(id);
    }
  }
}

export function formatRoadmapSnapshot(
  roadmap: Roadmap,
  labels: LabelMap,
): string {
  const nodeLines = roadmap.nodes.map((n) => {
    const label = labels.labelFor(n.id) ?? "?";
    const minutes = n.estimatedMinutes ? ` (${n.estimatedMinutes}m)` : "";
    const desc = n.description ? ` - ${truncate(n.description, 200)}` : "";
    return `  ${label}: ${n.title}${minutes}${desc}`;
  });
  const edgeLines = roadmap.edges
    .map((e) => {
      const s = labels.labelFor(e.source);
      const t = labels.labelFor(e.target);
      if (!s || !t) return null;
      return `  ${s} -> ${t}`;
    })
    .filter((x): x is string => x !== null);

  return `Current roadmap state:
Title: ${roadmap.title}
Description: ${roadmap.description || "(empty)"}

Nodes:
${nodeLines.length > 0 ? nodeLines.join("\n") : "  (none)"}

Prerequisite edges (source -> target):
${edgeLines.length > 0 ? edgeLines.join("\n") : "  (none)"}`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function buildRoadmapEditSystemPrompt(snapshot: string): string {
  return `You are an AI assistant helping the user edit a learning roadmap (a directed acyclic graph of learning units).

${snapshot}

You can modify the roadmap by calling tools: add_node, update_node, remove_node, add_edge, remove_edge, update_roadmap_meta.

Rules:
- Use the short labels (n1, n2, ...) from the snapshot when referencing nodes. add_node returns a fresh label you can use later in the same turn.
- The graph MUST stay acyclic. add_edge calls that would close a cycle are silently rejected, the tool result will tell you if that happens, so you can adjust.
- After your edits, give a brief 1–2 sentence summary of what changed. Don't repeat the diff in detail; the user sees each tool call rendered inline.
- If the user asks something that doesn't require edits, just answer normally without calling tools.`;
}

/** System prompt for the "generate a roadmap" skill: model builds from an empty roadmap. */
export function buildRoadmapGenerateSystemPrompt(): string {
  return `You are an AI assistant that builds a brand-new learning roadmap (a directed acyclic graph of learning units) from scratch, based on the user's request.

You are starting from an EMPTY roadmap. Build it by calling tools:
- update_roadmap_meta: set a concise title and a 1–2 sentence description matching the requested topic. Call this once, first.
- add_node: add each learning unit, ordered from fundamentals to advanced. Give a clear title and a 1–3 sentence description; set estimatedMinutes realistically. add_node returns a label (n1, n2, …) you reference later in the same turn.
- add_edge: connect prerequisites (source -> target means "learn source before target") into a sensible dependency chain/tree. The graph MUST stay acyclic; edges that would close a cycle are rejected and the tool result tells you so.

Guidelines:
- Aim for roughly 6–14 nodes, a real plan that covers the topic end to end without overwhelming the learner.
- Write in the user's language.
- After the edits, give a brief 1–2 sentence summary of the roadmap you built. Don't list every node; the user sees each tool call inline and can open the roadmap.
- If the request is too vague to build a roadmap, ask one brief clarifying question instead of calling tools.`;
}

// Intent detection: require BOTH a roadmap noun and a build verb before
// escalating a plain-chat message to the tool-use path. Short stems so HU
// conjugations and English forms all match.
const ROADMAP_NOUN_RE =
  /(roadmap|tanul(á|a)si\s*(terv|útiterv|út)|útiterv|tanrend|learning\s*(path|plan|roadmap)|study\s*plan|curriculum)/i;
// Explicit generation verbs only. Weak intents (want/need/give me/plan out and
// HU szeretn/kéne) are deliberately excluded so casual chat isn't hijacked into
// the Anthropic-only tool path; the noun gate above still has to match too.
const BUILD_VERB_RE =
  /(generál|generat|készít|készí|csinál|hozz\s*létre|creat|mak(e|ing)|build|draw\s*up)/i;

/** True when a plain-chat message reads as "generate a roadmap for X". */
export function detectRoadmapIntent(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ROADMAP_NOUN_RE.test(lower) && BUILD_VERB_RE.test(lower);
}

export interface ToolCallResult {
  ok: boolean;
  /** Short, human-readable summary rendered inline in the chat. */
  summary: string;
  /** Detail string returned to the model as the tool_result content. */
  modelOutput: string;
}

export function dispatchRoadmapTool(
  toolName: string,
  input: unknown,
  roadmapId: string,
  labels: LabelMap,
): ToolCallResult {
  const store = useRoadmapStore.getState();
  const roadmap = store.roadmaps.get(roadmapId);
  if (!roadmap) {
    return {
      ok: false,
      summary: "✗ Roadmap not found",
      modelOutput: "Error: roadmap not found.",
    };
  }
  const args = (input ?? {}) as Record<string, unknown>;

  switch (toolName) {
    case "add_node":
      return execAddNode(args, roadmapId, labels);
    case "update_node":
      return execUpdateNode(args, roadmap, labels);
    case "remove_node":
      return execRemoveNode(args, roadmapId, labels);
    case "add_edge":
      return execAddEdge(args, roadmap, labels);
    case "remove_edge":
      return execRemoveEdge(args, roadmap, labels);
    case "update_roadmap_meta":
      return execUpdateMeta(args, roadmapId);
    default:
      return {
        ok: false,
        summary: `✗ Unknown tool: ${toolName}`,
        modelOutput: `Error: unknown tool "${toolName}".`,
      };
  }
}

function execAddNode(
  args: Record<string, unknown>,
  roadmapId: string,
  labels: LabelMap,
): ToolCallResult {
  const title = typeof args.title === "string" ? args.title.trim() : "";
  if (!title) {
    return {
      ok: false,
      summary: "✗ add_node: missing title",
      modelOutput: "Error: title is required.",
    };
  }
  const description =
    typeof args.description === "string" ? args.description.trim() : "";
  const minutesRaw =
    typeof args.estimatedMinutes === "number" ? args.estimatedMinutes : 60;
  const estimatedMinutes = Math.max(5, Math.min(600, Math.round(minutesRaw)));
  const node: RoadmapNode = {
    id: crypto.randomUUID(),
    type: "text",
    title,
    description,
    estimatedMinutes,
  };
  useRoadmapStore.getState().upsertNode(roadmapId, node);
  const label = labels.register(node.id);
  return {
    ok: true,
    summary: `✓ Added node ${label}: ${title}`,
    modelOutput: `Added node with label ${label} (id assigned). Use ${label} to reference it in further tool calls in this turn.`,
  };
}

function execUpdateNode(
  args: Record<string, unknown>,
  roadmap: Roadmap,
  labels: LabelMap,
): ToolCallResult {
  const label = typeof args.id === "string" ? args.id.trim() : "";
  const id = labels.resolve(label);
  if (!id) {
    return {
      ok: false,
      summary: `✗ update_node: unknown label ${label || "(empty)"}`,
      modelOutput: `Error: no node with label "${label}".`,
    };
  }
  const existing = roadmap.nodes.find((n) => n.id === id);
  if (!existing) {
    return {
      ok: false,
      summary: `✗ update_node: ${label} no longer exists`,
      modelOutput: `Error: node ${label} no longer exists.`,
    };
  }
  const next: RoadmapNode = { ...existing };
  let changed = false;
  if (typeof args.title === "string" && args.title.trim()) {
    next.title = args.title.trim();
    changed = true;
  }
  if (typeof args.description === "string") {
    next.description = args.description.trim();
    changed = true;
  }
  if (
    typeof args.estimatedMinutes === "number" &&
    Number.isFinite(args.estimatedMinutes)
  ) {
    next.estimatedMinutes = Math.max(
      5,
      Math.min(600, Math.round(args.estimatedMinutes)),
    );
    changed = true;
  }
  if (!changed) {
    return {
      ok: false,
      summary: `✗ update_node: no fields to update`,
      modelOutput: "Error: provide at least one of title, description, estimatedMinutes.",
    };
  }
  useRoadmapStore.getState().upsertNode(roadmap.id, next);
  return {
    ok: true,
    summary: `✓ Updated node ${label}: ${next.title}`,
    modelOutput: `Updated node ${label}.`,
  };
}

function execRemoveNode(
  args: Record<string, unknown>,
  roadmapId: string,
  labels: LabelMap,
): ToolCallResult {
  const label = typeof args.id === "string" ? args.id.trim() : "";
  const id = labels.resolve(label);
  if (!id) {
    return {
      ok: false,
      summary: `✗ remove_node: unknown label ${label || "(empty)"}`,
      modelOutput: `Error: no node with label "${label}".`,
    };
  }
  useRoadmapStore.getState().removeNode(roadmapId, id);
  labels.forget(id);
  return {
    ok: true,
    summary: `✓ Removed node ${label}`,
    modelOutput: `Removed node ${label} and any edges touching it.`,
  };
}

function execAddEdge(
  args: Record<string, unknown>,
  roadmap: Roadmap,
  labels: LabelMap,
): ToolCallResult {
  const sourceLabel =
    typeof args.source === "string" ? args.source.trim() : "";
  const targetLabel =
    typeof args.target === "string" ? args.target.trim() : "";
  const source = labels.resolve(sourceLabel);
  const target = labels.resolve(targetLabel);
  if (!source || !target) {
    return {
      ok: false,
      summary: `✗ add_edge: unknown label`,
      modelOutput: `Error: ${!source ? `source "${sourceLabel}" unknown` : ""}${
        !source && !target ? "; " : ""
      }${!target ? `target "${targetLabel}" unknown` : ""}.`,
    };
  }
  if (source === target) {
    return {
      ok: false,
      summary: `✗ add_edge: self-loop rejected`,
      modelOutput: "Error: self-loops are not allowed.",
    };
  }
  if (wouldCreateCycle(roadmap.edges, source, target)) {
    return {
      ok: false,
      summary: `✗ add_edge ${sourceLabel} → ${targetLabel}: would create cycle`,
      modelOutput: `Edge ${sourceLabel} -> ${targetLabel} rejected: would create a cycle (${targetLabel} can already reach ${sourceLabel}).`,
    };
  }
  const edge: RoadmapEdge = {
    id: crypto.randomUUID(),
    source,
    target,
  };
  useRoadmapStore.getState().upsertEdge(roadmap.id, edge);
  return {
    ok: true,
    summary: `✓ Added edge ${sourceLabel} → ${targetLabel}`,
    modelOutput: `Added edge ${sourceLabel} -> ${targetLabel}.`,
  };
}

function execRemoveEdge(
  args: Record<string, unknown>,
  roadmap: Roadmap,
  labels: LabelMap,
): ToolCallResult {
  const sourceLabel =
    typeof args.source === "string" ? args.source.trim() : "";
  const targetLabel =
    typeof args.target === "string" ? args.target.trim() : "";
  const source = labels.resolve(sourceLabel);
  const target = labels.resolve(targetLabel);
  if (!source || !target) {
    return {
      ok: false,
      summary: `✗ remove_edge: unknown label`,
      modelOutput: `Error: unknown source or target label.`,
    };
  }
  const edge = roadmap.edges.find(
    (e) => e.source === source && e.target === target,
  );
  if (!edge) {
    return {
      ok: false,
      summary: `✗ remove_edge ${sourceLabel} → ${targetLabel}: no such edge`,
      modelOutput: `Error: no edge from ${sourceLabel} to ${targetLabel}.`,
    };
  }
  useRoadmapStore.getState().removeEdge(roadmap.id, edge.id);
  return {
    ok: true,
    summary: `✓ Removed edge ${sourceLabel} → ${targetLabel}`,
    modelOutput: `Removed edge ${sourceLabel} -> ${targetLabel}.`,
  };
}

function execUpdateMeta(
  args: Record<string, unknown>,
  roadmapId: string,
): ToolCallResult {
  const patch: { title?: string; description?: string } = {};
  if (typeof args.title === "string" && args.title.trim()) {
    patch.title = args.title.trim();
  }
  if (typeof args.description === "string") {
    patch.description = args.description.trim();
  }
  if (Object.keys(patch).length === 0) {
    return {
      ok: false,
      summary: `✗ update_roadmap_meta: nothing to update`,
      modelOutput: "Error: provide title or description.",
    };
  }
  useRoadmapStore.getState().updateRoadmap(roadmapId, patch);
  const parts: string[] = [];
  if (patch.title) parts.push(`title → "${patch.title}"`);
  if (patch.description !== undefined) parts.push(`description updated`);
  return {
    ok: true,
    summary: `✓ Roadmap meta: ${parts.join(", ")}`,
    modelOutput: `Updated roadmap metadata (${parts.join(", ")}).`,
  };
}

// BFS from target through forward edges; reaching source means source -> target closes a cycle.
function wouldCreateCycle(
  edges: RoadmapEdge[],
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e.target);
  }
  const visited = new Set<string>();
  const queue = [target];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (cur === source) return true;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of adj.get(cur) ?? []) queue.push(n);
  }
  return false;
}
