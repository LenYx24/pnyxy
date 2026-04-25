import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  CalendarDays,
  Pencil,
  Play,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  useEnrollmentForRoadmap,
  useRoadmap,
  useRoadmapStore,
} from "@/stores/roadmap-store";
import { RoadmapGraph } from "./components/RoadmapGraph";
import { EnrollDialog } from "./EnrollDialog";
import {
  computeSchedule,
  formatMinutes,
  progressFraction,
  totalEstimatedMinutes,
} from "./lib/scheduler";

export function RoadmapDetailPage() {
  const { t } = useTranslation();
  const { roadmapId } = useParams();
  const navigate = useNavigate();
  const load = useRoadmapStore((s) => s.load);
  const loaded = useRoadmapStore((s) => s.loaded);
  const roadmap = useRoadmap(roadmapId);
  const enrollment = useEnrollmentForRoadmap(roadmapId);
  const toggleNodeComplete = useRoadmapStore((s) => s.toggleNodeComplete);
  const unenroll = useRoadmapStore((s) => s.unenroll);
  const deleteRoadmap = useRoadmapStore((s) => s.deleteRoadmap);
  const setNodeDateOverride = useRoadmapStore((s) => s.setNodeDateOverride);

  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const schedule = useMemo(
    () => (roadmap && enrollment ? computeSchedule(roadmap, enrollment) : null),
    [roadmap, enrollment],
  );

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        {t("common.loading")}
      </div>
    );
  }

  if (!roadmap) {
    return (
      <div className="mx-auto max-w-3xl p-6 text-center">
        <p className="text-text-secondary">{t("roadmaps.notFound")}</p>
        <Link
          to="/roadmaps"
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-purple"
        >
          <ArrowLeft size={14} />
          {t("roadmaps.backToList")}
        </Link>
      </div>
    );
  }

  const progress = enrollment ? progressFraction(roadmap, enrollment) : 0;
  const pct = Math.round(progress * 100);
  const totalMinutes = totalEstimatedMinutes(roadmap);
  const selectedNode =
    selectedNodeId != null
      ? roadmap.nodes.find((n) => n.id === selectedNodeId)
      : null;
  const selectedSchedule = selectedNode
    ? schedule?.get(selectedNode.id)
    : undefined;

  const handleNodeClick = (id: string) => {
    if (!enrollment) return;
    toggleNodeComplete(enrollment.id, id);
  };

  const handleDelete = () => {
    if (window.confirm(t("roadmaps.deleteConfirm"))) {
      deleteRoadmap(roadmap.id);
      navigate("/roadmaps");
    }
  };

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-glass-border p-3 sm:p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/roadmaps"
            className="rounded-md p-1.5 text-text-muted hover:bg-glass-hover hover:text-text-primary"
            aria-label={t("roadmaps.backToList")}
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-text-primary">
              {roadmap.title}
            </h1>
            <p className="truncate text-xs text-text-muted">
              {t("roadmaps.nodeCount", { count: roadmap.nodes.length })} ·{" "}
              {formatMinutes(totalMinutes)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {enrollment ? (
            <>
              <div className="hidden items-center gap-2 sm:flex">
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-glass-bg">
                  <div
                    className="h-full rounded-full bg-accent-purple transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary">
                  {pct === 100 ? (
                    <span className="inline-flex items-center gap-1 text-yellow-400">
                      <Trophy size={12} />
                      {t("roadmaps.complete")}
                    </span>
                  ) : (
                    `${pct}%`
                  )}
                </span>
              </div>
              <button
                onClick={() => {
                  if (window.confirm(t("roadmaps.unenrollConfirm"))) {
                    unenroll(enrollment.id);
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-glass-hover"
              >
                <XCircle size={14} />
                <span className="hidden sm:inline">
                  {t("roadmaps.unenroll")}
                </span>
              </button>
            </>
          ) : (
            <button
              disabled={roadmap.nodes.length === 0}
              onClick={() => setEnrollDialogOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent-purple px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              <Play size={14} />
              {t("roadmaps.startLearning")}
            </button>
          )}
          <Link
            to={`/roadmaps/${roadmap.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-glass-hover"
          >
            <Pencil size={14} />
            <span className="hidden sm:inline">{t("common.edit")}</span>
          </Link>
          <button
            onClick={handleDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-red-400 hover:bg-red-500/10"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          {roadmap.nodes.length === 0 ? (
            <div className="flex h-full items-center justify-center p-8 text-center">
              <div>
                <p className="text-sm text-text-secondary">
                  {t("roadmaps.emptyDetail")}
                </p>
                <Link
                  to={`/roadmaps/${roadmap.id}/edit`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent-purple px-3 py-1.5 text-sm font-medium text-white"
                >
                  <Pencil size={14} />
                  {t("roadmaps.startBuilding")}
                </Link>
              </div>
            </div>
          ) : (
            <RoadmapGraph
              roadmap={roadmap}
              enrollment={enrollment}
              mode="view"
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* Side panel — shown when a node is selected. */}
        {selectedNode && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-glass-border bg-bg-secondary/50 p-4 lg:block">
            <h3 className="text-base font-semibold text-text-primary">
              {selectedNode.title}
            </h3>
            {selectedNode.description && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">
                {selectedNode.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-1.5 text-xs text-text-muted">
              <CalendarDays size={12} />
              <span>{formatMinutes(selectedNode.estimatedMinutes)}</span>
            </div>
            {enrollment && selectedSchedule && (
              <div className="mt-4 space-y-2">
                <label className="block text-xs font-medium text-text-secondary">
                  {t("roadmaps.scheduledFor")}
                </label>
                <input
                  type="date"
                  value={selectedSchedule.dueDate}
                  onChange={(e) =>
                    setNodeDateOverride(
                      enrollment.id,
                      selectedNode.id,
                      e.target.value || null,
                    )
                  }
                  className="w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent-purple"
                />
                {selectedSchedule.manual && (
                  <button
                    onClick={() =>
                      setNodeDateOverride(
                        enrollment.id,
                        selectedNode.id,
                        null,
                      )
                    }
                    className="text-xs text-accent-purple hover:underline"
                  >
                    {t("roadmaps.resetSchedule")}
                  </button>
                )}
              </div>
            )}
            {enrollment && (
              <button
                onClick={() => toggleNodeComplete(enrollment.id, selectedNode.id)}
                className="mt-4 w-full rounded-md bg-accent-purple px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                {enrollment.completedNodeIds[selectedNode.id]
                  ? t("roadmaps.markIncomplete")
                  : t("roadmaps.markComplete")}
              </button>
            )}
          </aside>
        )}
      </div>

      {enrollDialogOpen && (
        <EnrollDialog
          roadmap={roadmap}
          onClose={() => setEnrollDialogOpen(false)}
        />
      )}
    </div>
  );
}
