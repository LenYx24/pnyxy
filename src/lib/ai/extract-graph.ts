/**
 * Parser for AI-emitted inline graph blocks (```graph fenced JSON): a
 * small node/edge description the chat renders as an editable React Flow
 * widget (InlineGraphCard). Same contract as extract-quiz.ts: strips the
 * fence from the prose, reports an unterminated fence as `pending` so
 * streaming never shows raw JSON.
 *
 * Admin-only pilot feature: the spec is only added to the system prompt
 * (chat-stream.ts) and the card only rendered (MessageBubble) when the
 * `graphWidget` feature flag is on.
 */

export interface InlineGraphNode {
  id: string;
  label: string;
}

export interface InlineGraphEdge {
  from: string;
  to: string;
  label?: string | null;
}

export interface InlineGraph {
  title?: string | null;
  /** Arrows on every edge; undirected graphs draw plain lines. */
  directed: boolean;
  nodes: InlineGraphNode[];
  edges: InlineGraphEdge[];
}

interface ExtractGraphResult {
  cleaned: string;
  graph?: InlineGraph;
  pending?: boolean;
}

const GRAPH_FENCE = /```graph\s*([\s\S]*?)```/i;
const OPEN_GRAPH_FENCE = /```graph\s*[\s\S]*$/i;

export const MAX_GRAPH_NODES = 60;

/** Prompt-side contract (only injected when the feature flag is on). */
export const INLINE_GRAPH_SPEC = `When a graph would explain something better than prose (graph theory, trees, state machines, dependencies, concept maps, automata), draw it as a fenced code block tagged \`graph\` containing ONLY JSON in this exact shape:
\`\`\`graph
{"title": "…", "directed": true, "nodes": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}], "edges": [{"from": "a", "to": "b", "label": "3"}]}
\`\`\`
Rules: ids are short unique strings, labels are what the student sees, "directed": false for undirected graphs, edge "label" is optional (weights, transitions). Up to ~${MAX_GRAPH_NODES} nodes. The block renders as an interactive, editable diagram, so refer to it in the prose ("in the graph above…") and don't repeat the edge list as text. When the user sends you a \`graph\` block back, that is the diagram as they edited it: reason about that version.`;

export function extractInlineGraph(content: string): ExtractGraphResult {
  const match = content.match(GRAPH_FENCE);
  if (match) {
    const cleaned = content.replace(GRAPH_FENCE, "").trim();
    try {
      const graph = coerceGraph(JSON.parse(match[1].trim()));
      return graph ? { cleaned, graph } : { cleaned };
    } catch {
      return { cleaned };
    }
  }
  const open = content.match(OPEN_GRAPH_FENCE);
  if (open) {
    return { cleaned: content.replace(OPEN_GRAPH_FENCE, "").trim(), pending: true };
  }
  return { cleaned: content };
}

export function coerceGraph(raw: unknown): InlineGraph | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.nodes)) return null;
  const nodes: InlineGraphNode[] = [];
  const seen = new Set<string>();
  for (const n of r.nodes) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    nodes.push({ id, label: String(o.label ?? id).slice(0, 80) });
    if (nodes.length >= MAX_GRAPH_NODES) break;
  }
  if (nodes.length === 0) return null;
  const edges: InlineGraphEdge[] = [];
  if (Array.isArray(r.edges)) {
    for (const e of r.edges) {
      if (!e || typeof e !== "object") continue;
      const o = e as Record<string, unknown>;
      const from = String(o.from ?? o.source ?? "").trim();
      const to = String(o.to ?? o.target ?? "").trim();
      if (!seen.has(from) || !seen.has(to)) continue;
      const label = o.label == null ? null : String(o.label).slice(0, 40);
      edges.push({ from, to, label });
    }
  }
  return {
    title: typeof r.title === "string" ? r.title.slice(0, 120) : null,
    directed: r.directed !== false,
    nodes,
    edges,
  };
}

/** Serialize back into the fence so the user can send the edited graph. */
export function graphToFence(graph: InlineGraph): string {
  return "```graph\n" + JSON.stringify(graph) + "\n```";
}
