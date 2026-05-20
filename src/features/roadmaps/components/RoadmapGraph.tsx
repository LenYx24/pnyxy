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
  /** Per-node auto-detected progress (0–100). Composited with the
   *  enrollment's manual progress; the higher of the two drives the
   *  visual state. Optional — pass when the parent has fetched
   *  `book_resume_state` for the matched book references. */
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

  // Source-of-truth nodes derived from the roadmap + enrollment props.
  // We DON'T feed this directly into ReactFlow — it would clobber the
  // live drag position on every render, so the node visually snapped
  // back to the original spot mid-drag instead of following the cursor.
  // Instead, we mirror it into local state below and apply xyflow's
  // change events ourselves; the parent only hears about position
  // changes once the drag ends.
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

  // Local mirror that ReactFlow controls. `applyNodeChanges` updates
  // it from xyflow's drag/select/etc. events, so the node visually
  // tracks the cursor without waiting for the parent to round-trip
  // a position update.
  const [nodes, setNodes] = useState<RoadmapXyNode[]>(sourceNodes);

  // Re-seed when the upstream source changes (new node added,
  // enrollment progress changed, switched view↔edit mode, …).
  // Deliberately not deduping by deep-equality — `sourceNodes` is
  // already memoised on its real inputs, so identity changes only
  // when something we actually want to reflect changed. During a
  // drag, none of those inputs change, so this effect doesn't fire
  // and the live drag state survives.
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
        // Highlight edges leading into the next-actionable nodes (not locked,
        // not completed) — small affordance that suggests where to go next.
        style: {
          // Edge colour cues "where to go next": grey when locked
          // and source not yet complete, green once source is fully
          // complete (>= 100), default otherwise.
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
      // Even in view mode we let xyflow apply *non-position* changes
      // (selection, dimensions) so the graph stays internally
      // consistent — but we drop position changes since the node
      // isn't draggable there.
      const filtered =
        mode === "edit"
          ? changes
          : changes.filter((c) => c.type !== "position" && c.type !== "remove");
      // Apply EVERY change to local state — including in-flight
      // position changes (`dragging: true`). That's the bit that
      // makes the node track the cursor; without it the prop stayed
      // pinned to the source position and the node visually snapped.
      setNodes((prev) => applyNodeChanges(filtered, prev) as RoadmapXyNode[]);

      if (mode !== "edit") return;
      const removed: string[] = [];
      for (const c of changes) {
        if (c.type === "remove") removed.push(c.id);
        // Only commit to the parent (and through it, to the DB) on
        // drag end. Live mid-drag positions stay in local state to
        // avoid spamming `setNodePosition` 60× per second.
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
