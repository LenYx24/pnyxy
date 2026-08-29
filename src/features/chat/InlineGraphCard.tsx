/**
 * Editable graph widget for ```graph blocks in AI replies (admin-only
 * pilot feature, flag `graphWidget`). React Flow + dagre auto-layout;
 * the student can add / rename / delete nodes, draw edges by dragging
 * between handles, toggle directed, and send the edited graph back to
 * the AI as a ```graph block in a new user turn.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { ArrowRightLeft, Pencil, Plus, RotateCcw, Send, Trash2 } from "lucide-react";
import { Button, PromptModal } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  graphToFence,
  type InlineGraph,
  type InlineGraphEdge,
  type InlineGraphNode,
} from "@/lib/ai/extract-graph";
import { useChatStore } from "@/stores/chat-store";

const NODE_W = 120;
const NODE_H = 40;

type GNode = Node<{ label: string }, "gnode">;

function layout(nodes: InlineGraphNode[], edges: InlineGraphEdge[]): GNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return {
      id: n.id,
      type: "gnode",
      data: { label: n.label },
      position: { x: (p?.x ?? 0) - NODE_W / 2, y: (p?.y ?? 0) - NODE_H / 2 },
    };
  });
}

function toFlowEdges(edges: InlineGraphEdge[], directed: boolean): Edge[] {
  return edges.map((e, i) => ({
    id: `e${i}-${e.from}-${e.to}`,
    source: e.from,
    target: e.to,
    label: e.label ?? undefined,
    ...(directed ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
    style: { strokeWidth: 1.5 },
  }));
}

function GraphNode({ data, selected }: NodeProps<GNode>) {
  return (
    <div
      className={cn(
        "flex min-w-[80px] max-w-[160px] items-center justify-center rounded-full border bg-bg-tertiary px-3 py-1.5 text-xs font-medium text-text-primary shadow-page",
        selected ? "border-accent" : "border-glass-border",
      )}
    >
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !bg-text-muted" />
      <span className="truncate">{data.label}</span>
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !bg-text-muted" />
    </div>
  );
}
const NODE_TYPES = { gnode: GraphNode };

export function InlineGraphCard({ graph }: { graph: InlineGraph }) {
  return (
    <ReactFlowProvider>
      <InlineGraphCardInner graph={graph} />
    </ReactFlowProvider>
  );
}

function InlineGraphCardInner({ graph }: { graph: InlineGraph }) {
  const { t } = useTranslation();
  const sendMessage = useChatStore((s) => s.sendMessage);
  const streaming = useChatStore((s) => s.streamingMessageId !== null);
  const [directed, setDirected] = useState(graph.directed);
  const [nodes, setNodes] = useState<GNode[]>(() => layout(graph.nodes, graph.edges));
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(graph.edges, graph.directed));
  const [renameId, setRenameId] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const selected = useMemo(() => nodes.find((n) => n.selected) ?? null, [nodes]);

  const onNodesChange = useCallback((changes: NodeChange<GNode>[]) => {
    setNodes((ns) => applyNodeChanges(changes, ns));
    if (changes.some((c) => c.type !== "select" && c.type !== "dimensions")) setDirty(true);
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((es) => applyEdgeChanges(changes, es));
    if (changes.some((c) => c.type !== "select")) setDirty(true);
  }, []);
  const onConnect = useCallback(
    (c: Connection) => {
      setEdges((es) =>
        addEdge(
          {
            ...c,
            ...(directed ? { markerEnd: { type: MarkerType.ArrowClosed } } : {}),
            style: { strokeWidth: 1.5 },
          },
          es,
        ),
      );
      setDirty(true);
    },
    [directed],
  );

  const toggleDirected = () => {
    const next = !directed;
    setDirected(next);
    setEdges((es) =>
      es.map((e) => ({
        ...e,
        markerEnd: next ? { type: MarkerType.ArrowClosed } : undefined,
      })),
    );
    setDirty(true);
  };

  const addNode = () => {
    let i = nodes.length + 1;
    while (nodes.some((n) => n.id === `n${i}`)) i++;
    const id = `n${i}`;
    setNodes((ns) => [
      ...ns.map((n) => ({ ...n, selected: false })),
      {
        id,
        type: "gnode",
        data: { label: id.toUpperCase() },
        position: { x: 20 + (ns.length % 5) * 40, y: 20 + ns.length * 8 },
        selected: true,
      },
    ]);
    setDirty(true);
    setRenameId(id);
  };

  const deleteSelected = () => {
    if (!selected) return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
    setDirty(true);
  };

  const relayout = () => {
    const current = currentGraph();
    setNodes(layout(current.nodes, current.edges));
  };

  const currentGraph = useCallback(
    (): InlineGraph => ({
      title: graph.title ?? null,
      directed,
      nodes: nodes.map((n) => ({ id: n.id, label: n.data.label })),
      edges: edges.map((e) => ({
        from: e.source,
        to: e.target,
        label: typeof e.label === "string" ? e.label : null,
      })),
    }),
    [graph.title, directed, nodes, edges],
  );

  const handleAsk = async (question: string) => {
    setAskOpen(false);
    const q = question.trim();
    if (!q) return;
    await sendMessage(`${q}\n\n${graphToFence(currentGraph())}`);
  };

  return (
    <div className="overflow-hidden rounded-panel border border-glass-border bg-bg-secondary">
      <div className="flex items-center gap-1 border-b border-glass-border px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate px-1 text-xs font-medium text-text-primary">
          {graph.title || t("chat.inlineGraph.title")}
          {dirty && <span className="ml-1 text-text-muted">· {t("chat.inlineGraph.edited")}</span>}
        </span>
        <IconBtn label={t("chat.inlineGraph.addNode")} onClick={addNode}><Plus size={14} /></IconBtn>
        <IconBtn label={t("chat.inlineGraph.rename")} onClick={() => selected && setRenameId(selected.id)} disabled={!selected}><Pencil size={14} /></IconBtn>
        <IconBtn label={t("chat.inlineGraph.delete")} onClick={deleteSelected} disabled={!selected}><Trash2 size={14} /></IconBtn>
        <IconBtn label={directed ? t("chat.inlineGraph.makeUndirected") : t("chat.inlineGraph.makeDirected")} onClick={toggleDirected} active={directed}><ArrowRightLeft size={14} /></IconBtn>
        <IconBtn label={t("chat.inlineGraph.relayout")} onClick={relayout}><RotateCcw size={14} /></IconBtn>
      </div>
      <div className="h-[280px] w-full sm:h-[320px]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDoubleClick={(_, n) => setRenameId(n.id)}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode={["Backspace", "Delete"]}
          className="bg-bg-secondary"
        >
          <Background gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-glass-border px-2 py-1.5">
        <p className="min-w-0 truncate text-2xs text-text-muted">{t("chat.inlineGraph.hint")}</p>
        <Button size="sm" variant="secondary" className="gap-1.5 text-xs" onClick={() => setAskOpen(true)} disabled={streaming}>
          <Send size={13} strokeWidth={1.5} />
          {t("chat.inlineGraph.askAi")}
        </Button>
      </div>

      <PromptModal
        open={renameId !== null}
        title={t("chat.inlineGraph.renameTitle")}
        defaultValue={nodes.find((n) => n.id === renameId)?.data.label ?? ""}
        onClose={() => setRenameId(null)}
        onSubmit={(value) => {
          const label = value.trim().slice(0, 80);
          if (label && renameId) {
            setNodes((ns) => ns.map((n) => (n.id === renameId ? { ...n, data: { label } } : n)));
            setDirty(true);
          }
          setRenameId(null);
        }}
      />
      <PromptModal
        open={askOpen}
        title={t("chat.inlineGraph.askTitle")}
        placeholder={t("chat.inlineGraph.askPlaceholder")}
        onClose={() => setAskOpen(false)}
        onSubmit={(v) => void handleAsk(v)}
      />
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
        active && "bg-surface-3 text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
