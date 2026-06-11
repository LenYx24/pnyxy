import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Eye, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, NumberInput } from "@/components/ui";
import { useRoadmap, useRoadmapStore } from "@/stores/roadmap-store";
import { useChatStore } from "@/stores/chat-store";
import type { RoadmapNode } from "@/types/roadmap";
import { RoadmapGraph } from "./components/RoadmapGraph";
import { makeBlankNode } from "./lib/scheduler";

export function RoadmapEditorPage() {
  const { t } = useTranslation();
  const { roadmapId } = useParams();
  const navigate = useNavigate();
  const load = useRoadmapStore((s) => s.load);
  const loaded = useRoadmapStore((s) => s.loaded);
  const roadmap = useRoadmap(roadmapId);
  const updateRoadmap = useRoadmapStore((s) => s.updateRoadmap);
  const upsertNode = useRoadmapStore((s) => s.upsertNode);
  const removeNode = useRoadmapStore((s) => s.removeNode);
  const upsertEdge = useRoadmapStore((s) => s.upsertEdge);
  const removeEdge = useRoadmapStore((s) => s.removeEdge);
  const setNodePosition = useRoadmapStore((s) => s.setNodePosition);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        {t("common.loading")}
      </div>
    );
  }
  if (!roadmap || !roadmapId) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center">
        <p className="text-text-secondary">{t("roadmaps.notFound")}</p>
        <Link
          to="/roadmaps"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent"
        >
          <ArrowLeft size={14} />
          {t("roadmaps.backToList")}
        </Link>
      </div>
    );
  }

  const selectedNode =
    selectedNodeId != null
      ? roadmap.nodes.find((n) => n.id === selectedNodeId)
      : null;

  const handleAddNode = () => {
    const node = makeBlankNode();
    upsertNode(roadmap.id, node);
    setSelectedNodeId(node.id);
  };

  const handleConnect = (source: string, target: string) => {
    upsertEdge(roadmap.id, { id: crypto.randomUUID(), source, target });
  };

  // Hand off to /chat with the roadmap as the agentic target. ChatPage
  // drains the pending draft on mount and creates a conversation
  // tagged with target_roadmap_id, which switches sendMessage into
  // the tool-use loop.
  const handleEditWithAi = () => {
    useChatStore.getState().setPendingDraft({
      text: "",
      target: { roadmapId: roadmap.id },
    });
    navigate("/chat");
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass-border p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={`/roadmaps/${roadmap.id}`}
            className="rounded-md p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary"
            aria-label={t("roadmaps.backToList")}
          >
            <ArrowLeft size={18} />
          </Link>
          <input
            value={roadmap.title}
            onChange={(e) =>
              updateRoadmap(roadmap.id, { title: e.target.value })
            }
            placeholder={t("roadmaps.titlePlaceholder")}
            className="min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-lg font-semibold text-text-primary outline-none focus:bg-glass-bg"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleEditWithAi}
            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-glass-hover"
          >
            <Sparkles size={14} />
            <span className="hidden sm:inline">{t("roadmaps.editWithAi")}</span>
          </button>
          <Button size="sm" onClick={handleAddNode}>
            <Plus size={14} />
            {t("roadmaps.addNode")}
          </Button>
          <button
            onClick={() => navigate(`/roadmaps/${roadmap.id}`)}
            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-glass-hover"
          >
            <Eye size={14} />
            <span className="hidden sm:inline">{t("roadmaps.preview")}</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {roadmap.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm text-text-secondary">
                  {t("roadmaps.editorEmpty")}
                </p>
                <Button size="sm" onClick={handleAddNode} className="mt-3">
                  <Plus size={14} />
                  {t("roadmaps.addFirstNode")}
                </Button>
              </div>
            </div>
          ) : (
            <RoadmapGraph
              roadmap={roadmap}
              mode="edit"
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onConnect={handleConnect}
              onNodesDelete={(ids) => {
                for (const id of ids) removeNode(roadmap.id, id);
                if (selectedNodeId && ids.includes(selectedNodeId)) {
                  setSelectedNodeId(null);
                }
              }}
              onEdgesDelete={(ids) => {
                for (const id of ids) removeEdge(roadmap.id, id);
              }}
              onNodeDrag={(id, position) =>
                setNodePosition(roadmap.id, id, position)
              }
            />
          )}
        </div>

        {/* Right side panel — node editor */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-glass-border bg-bg-secondary/50 p-4 lg:block">
          {selectedNode ? (
            <NodeEditor
              key={selectedNode.id}
              node={selectedNode}
              onChange={(patch) =>
                upsertNode(roadmap.id, { ...selectedNode, ...patch })
              }
              onDelete={() => {
                removeNode(roadmap.id, selectedNode.id);
                setSelectedNodeId(null);
              }}
            />
          ) : (
            <div className="space-y-2 text-sm text-text-secondary">
              <p>{t("roadmaps.selectNodeHint")}</p>
              <p className="text-xs text-text-muted">
                {t("roadmaps.connectHint")}
              </p>
              {/* Description editor for the roadmap itself, since the
                  side panel would otherwise be empty. */}
              <div className="mt-6 border-t border-glass-border pt-4">
                <label className="block text-xs font-medium text-text-secondary">
                  {t("roadmaps.descriptionLabel")}
                </label>
                <textarea
                  value={roadmap.description}
                  onChange={(e) =>
                    updateRoadmap(roadmap.id, { description: e.target.value })
                  }
                  rows={4}
                  placeholder={t("roadmaps.descriptionPlaceholder")}
                  className="mt-1 w-full resize-y rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
                />
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function NodeEditor({
  node,
  onChange,
  onDelete,
}: {
  node: RoadmapNode;
  onChange: (patch: Partial<RoadmapNode>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-text-secondary">
          {t("roadmaps.nodeTitle")}
        </label>
        <input
          value={node.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="mt-1 w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-text-secondary">
          {t("roadmaps.nodeDescription")}
        </label>
        <textarea
          value={node.description}
          onChange={(e) => onChange({ description: e.target.value })}
          rows={4}
          className="mt-1 w-full resize-y rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
        />
      </div>
      <NumberInput
        label={t("roadmaps.nodeMinutes")}
        value={node.estimatedMinutes}
        min={0}
        step={5}
        suffix="min"
        onChange={(v) =>
          onChange({ estimatedMinutes: Number.isNaN(v) ? 0 : v })
        }
      />
      <button
        onClick={onDelete}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger hover:bg-danger/20"
      >
        <Trash2 size={14} />
        {t("roadmaps.deleteNode")}
      </button>
    </div>
  );
}
