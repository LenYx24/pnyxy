import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyNodeChanges,
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
import type { Enrollment, ResourceRef, Roadmap } from "@/types/roadmap";
import { displayProgressPct } from "@/lib/roadmap/roadmap-auto-progress";
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
  /** Per-node auto-detected progress (0-100). Higher of this and manual progress drives the visual state. */
  autoProgress?: Record<string, number>;
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
  autoProgress,
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

  const nodeProgressMap = useMemo(
    () => enrollment?.nodeProgress ?? {},
    [enrollment?.nodeProgress],
  );
  const lockedSet = useMemo(
    () => lockedNodeIds(roadmap, nodeProgressMap),
    [roadmap, nodeProgressMap],
  );
  const schedule = useMemo(
    () => (enrollment ? computeSchedule(roadmap, enrollment) : null),
    [roadmap, enrollment],
  );

  const positionedNodes = useMemo(
    () => autoLayout(roadmap.nodes, roadmap.edges),
    [roadmap.nodes, roadmap.edges],
  );

  // Source-of-truth nodes. Not fed straight to ReactFlow: that would clobber the
  // live drag position each render and snap the node back mid-drag. Mirrored into
  // local state below instead; parent only hears position changes on drag end.
  const sourceNodes: RoadmapXyNode[] = useMemo(
    () =>
      positionedNodes.map((n) => {
        const sched = schedule?.get(n.id);
        const manual = nodeProgressMap[n.id] ?? 0;
        const auto = autoProgress?.[n.id] ?? 0;
        const display = displayProgressPct(manual, auto);
        const refs =
          (n.payload?.references as ResourceRef[] | undefined) ?? [];
        const data: RoadmapNodeData = {
          roadmapId: roadmap.id,
          nodeId: n.id,
          title: n.title,
          description: n.description,
          estimatedMinutes: n.estimatedMinutes,
          progress: display,
          locked: lockedSet.has(n.id) && display < 100,
          isGoal: goalIds.has(n.id),
          primaryReference: refs[0],
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
    [
      positionedNodes,
      nodeProgressMap,
      autoProgress,
      lockedSet,
      goalIds,
      schedule,
      mode,
      selectedNodeId,
    ],
  );

  // Local mirror ReactFlow controls via applyNodeChanges, so nodes track the cursor.
  const [nodes, setNodes] = useState<RoadmapXyNode[]>(sourceNodes);

  // Re-seed on source identity change. sourceNodes is memoised on real inputs, none
  // of which change during a drag, so live drag state survives.
  useEffect(() => {
    setNodes(sourceNodes);
  }, [sourceNodes]);

  const flowNodes = nodes;

  const flowEdges: Edge[] = useMemo(
    () =>
      roadmap.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          // grey when target locked and source incomplete, green when source complete
          stroke:
            (nodeProgressMap[e.source] ?? 0) < 100 && lockedSet.has(e.target)
              ? "rgb(var(--color-text-muted-rgb,120 120 120))"
              : (nodeProgressMap[e.source] ?? 0) >= 100
                ? "rgb(16 185 129 / 0.6)"
                : undefined,
          strokeWidth: 1.5,
        },
      })),
    [roadmap.edges, nodeProgressMap, lockedSet],
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
      // In view mode keep non-position changes (selection, dimensions) but drop
      // position/remove since nodes aren't draggable there.
      const filtered =
        mode === "edit"
          ? changes
          : changes.filter((c) => c.type !== "position" && c.type !== "remove");
      // Apply every change, including in-flight position (dragging: true); that's
      // what makes the node track the cursor.
      setNodes((prev) => applyNodeChanges(filtered, prev) as RoadmapXyNode[]);

      if (mode !== "edit") return;
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === "remove") removed.push(c.id);
        // Only commit to the parent on drag end, to avoid spamming updates mid-drag.
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
      // edit mode: drag empty pane = rectangle select, pan via middle/right button.
      // view mode: left-drag pans.
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
