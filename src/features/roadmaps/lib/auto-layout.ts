import dagre from "dagre";
import type { RoadmapEdge, RoadmapNode } from "@/types/roadmap";

const NODE_WIDTH = 240;
const NODE_HEIGHT = 96;

/**
 * Top-down auto-layout via dagre. Returns nodes with `position` filled in.
 * Nodes that already have a manually-set position are kept where they are;
 * dagre is only consulted for the unpositioned ones (so manual overrides win).
 */
export function autoLayout(
  nodes: RoadmapNode[],
  edges: RoadmapEdge[],
): Array<RoadmapNode & { position: { x: number; y: number } }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    if (node.position) {
      return { ...node, position: node.position };
    }
    const laidOut = g.node(node.id);
    if (!laidOut) {
      return { ...node, position: { x: 0, y: 0 } };
    }
    // dagre returns the centre point; xyflow expects top-left.
    return {
      ...node,
      position: {
        x: laidOut.x - NODE_WIDTH / 2,
        y: laidOut.y - NODE_HEIGHT / 2,
      },
    };
  });
}

/** Nodes with no outgoing edges — these are the "goal" nodes. */
export function findGoalNodeIds(
  nodes: RoadmapNode[],
  edges: RoadmapEdge[],
): Set<string> {
  const hasOutgoing = new Set<string>();
  for (const e of edges) hasOutgoing.add(e.source);
  return new Set(nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id));
}

/**
 * Topological sort. Used by the scheduler so we walk nodes in dependency
 * order. Falls back to insertion order for cycles (shouldn't happen in a
 * DAG, but we don't enforce DAG-ness in the editor — yet).
 */
export function topologicalOrder(
  nodes: RoadmapNode[],
  edges: RoadmapEdge[],
): RoadmapNode[] {
  const indegree = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const n of nodes) {
    indegree.set(n.id, 0);
    adj.set(n.id, []);
  }
  for (const e of edges) {
    if (!indegree.has(e.target) || !adj.has(e.source)) continue;
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
    adj.get(e.source)!.push(e.target);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue: string[] = [];
  // Preserve original insertion order for ties.
  for (const n of nodes) {
    if ((indegree.get(n.id) ?? 0) === 0) queue.push(n.id);
  }
  const out: RoadmapNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = byId.get(id);
    if (node) out.push(node);
    for (const next of adj.get(id) ?? []) {
      const nd = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nd);
      if (nd === 0) queue.push(next);
    }
  }
  // If there's a cycle some nodes won't appear — append them in order to
  // keep the scheduler robust.
  if (out.length < nodes.length) {
    const seen = new Set(out.map((n) => n.id));
    for (const n of nodes) if (!seen.has(n.id)) out.push(n);
  }
  return out;
}
