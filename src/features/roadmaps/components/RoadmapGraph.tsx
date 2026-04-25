import { useCallback, useMemo } from "react";
import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type NodeChange,
  type NodeTypes,
  type EdgeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { Enrollment, Roadmap } from "@/types/roadmap";
import { autoLayout, findGoalNodeIds } from "../lib/auto-layout";
import {
  computeSchedule,
  lockedNodeIds,
} from "../lib/scheduler";
import {
  RoadmapNodeCard,
  type RoadmapNodeData,
  type RoadmapXyNode,
} from "./RoadmapNodeCard";

const NODE_TYPES: NodeTypes = { roadmap: RoadmapNodeCard as NodeTypes[string] };

interface RoadmapGraphProps {
  roadmap: Roadmap;
  enrollment?: Enrollment;
  mode: "view" | "edit";
  selectedNodeId?: string | null;
  onSelectNode?: (id: string | null) => void;
  onNodeClick?: (id: string) => void;
  onConnect?: (source: string, target: string) => void;
  onEdgesDelete?: (edgeIds: string[]) => void;
  onNodesDelete?: (nodeIds: string[]) => void;
  onNodeDrag?: (id: string, position: { x: number; y: number }) => void;
}

export function RoadmapGraph(props: RoadmapGraphProps) {
  return (
    <ReactFlowProvider>
      <RoadmapGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function RoadmapGraphInner({
  roadmap,
  enrollment,
  mode,
  selectedNodeId,
  onSelectNode,
  onNodeClick,
  onConnect,
  onEdgesDelete,
  onNodesDelete,
  onNodeDrag,
}: RoadmapGraphProps) {
  const goalIds = useMemo(
    () => findGoalNodeIds(roadmap.nodes, roadmap.edges),
    [roadmap.nodes, roadmap.edges],
  );

  const completedSet = useMemo(
    () => enrollment?.completedNodeIds ?? {},
    [enrollment?.completedNodeIds],
  );
  const lockedSet = useMemo(
    () => lockedNodeIds(roadmap, completedSet),
    [roadmap, completedSet],
  );
  const schedule = useMemo(
    () => (enrollment ? computeSchedule(roadmap, enrollment) : null),
    [roadmap, enrollment],
  );

  const positionedNodes = useMemo(
    () => autoLayout(roadmap.nodes, roadmap.edges),
    [roadmap.nodes, roadmap.edges],
  );

  const flowNodes: RoadmapXyNode[] = useMemo(
    () =>
      positionedNodes.map((n) => {
        const sched = schedule?.get(n.id);
        const data: RoadmapNodeData = {
          title: n.title,
          description: n.description,
          estimatedMinutes: n.estimatedMinutes,
          completed: !!completedSet[n.id],
          locked: lockedSet.has(n.id) && !completedSet[n.id],
          isGoal: goalIds.has(n.id),
          dueDate: sched?.dueDate,
          manualDate: sched?.manual,
          editMode: mode === "edit",
        };
        return {
          id: n.id,
          type: "roadmap",
          position: n.position,
          data,
          selected: n.id === selectedNodeId,
          draggable: mode === "edit",
        };
      }),
    [positionedNodes, completedSet, lockedSet, goalIds, schedule, mode, selectedNodeId],
  );

  const flowEdges: Edge[] = useMemo(
    () =>
      roadmap.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        // Highlight edges leading into the next-actionable nodes (not locked,
        // not completed) — small affordance that suggests where to go next.
        style: {
          stroke:
            !completedSet[e.source] && lockedSet.has(e.target)
              ? "rgb(var(--color-text-muted-rgb,120 120 120))"
              : completedSet[e.source]
                ? "rgb(16 185 129 / 0.6)"
                : undefined,
          strokeWidth: 1.5,
        },
      })),
    [roadmap.edges, completedSet, lockedSet],
  );

  const handleConnect = useCallback(
    (c: Connection) => {
      if (mode !== "edit") return;
      if (!c.source || !c.target) return;
      onConnect?.(c.source, c.target);
    },
    [mode, onConnect],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (mode !== "edit") return;
      const removed = changes
        .filter((c): c is EdgeChange & { type: "remove" } => c.type === "remove")
        .map((c) => c.id);
      if (removed.length > 0) onEdgesDelete?.(removed);
    },
    [mode, onEdgesDelete],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (mode !== "edit") return;
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === "remove") removed.push(c.id);
        if (c.type === "position" && c.dragging === false && c.position) {
          onNodeDrag?.(c.id, c.position);
        }
      }
      if (removed.length > 0) onNodesDelete?.(removed);
    },
    [mode, onNodesDelete, onNodeDrag],
  );

  return (
    <ReactFlow
      nodes={flowNodes}
      edges={flowEdges}
      nodeTypes={NODE_TYPES}
      onNodesChange={handleNodesChange}
      onEdgesChange={handleEdgesChange}
      onConnect={handleConnect}
      onNodeClick={(_, n) => {
        onSelectNode?.(n.id);
        onNodeClick?.(n.id);
      }}
      onPaneClick={() => onSelectNode?.(null)}
      nodesConnectable={mode === "edit"}
      nodesDraggable={mode === "edit"}
      elementsSelectable={true}
      // Obsidian-style: drag empty pane = rectangle select, pan via
      // middle (1) or right (2) mouse button. Edit mode only — in view
      // mode left-drag still pans so reading feels natural.
      selectionOnDrag={mode === "edit"}
      panOnDrag={mode === "edit" ? [1, 2] : true}
      selectNodesOnDrag={false}
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      deleteKeyCode={["Delete", "Backspace"]}
      edgesFocusable={true}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
