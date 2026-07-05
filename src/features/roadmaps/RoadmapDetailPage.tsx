import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  ExternalLink,
  Pencil,
  Play,
  Sparkles,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import {
  useEnrollmentForRoadmap,
  useRoadmap,
  useRoadmapStore,
} from "@/stores/roadmap-store";
import { Button, ConfirmModal } from "@/components/ui";
import { RoadmapGraph } from "./components/RoadmapGraph";
import { DeadlinePicker } from "./components/DeadlinePicker";
import { EnrollDialog } from "./EnrollDialog";
import {
  computeSchedule,
  formatMinutes,
  progressFraction,
  totalEstimatedMinutes,
} from "./lib/scheduler";
import type { ResourceRef } from "@/types/roadmap";
import {
  displayProgressPct,
  fetchAutoProgressMap,
} from "@/lib/roadmap/roadmap-auto-progress";
import { cn } from "@/lib/cn";
import { bookIdSegment } from "@/lib/slugify";

export function RoadmapDetailPage() {
  const { t } = useTranslation();
  const { roadmapId } = useParams();
  const navigate = useNavigate();
  const load = useRoadmapStore((s) => s.load);
  const loaded = useRoadmapStore((s) => s.loaded);
  const roadmap = useRoadmap(roadmapId);
  const enrollment = useEnrollmentForRoadmap(roadmapId);
  const toggleNodeComplete = useRoadmapStore((s) => s.toggleNodeComplete);
  const setNodeProgress = useRoadmapStore((s) => s.setNodeProgress);
  const unenroll = useRoadmapStore((s) => s.unenroll);
  const deleteRoadmap = useRoadmapStore((s) => s.deleteRoadmap);
  const setNodeDateOverride = useRoadmapStore((s) => s.setNodeDateOverride);
  const setDeadline = useRoadmapStore((s) => s.setDeadline);

  // Fetch auto-progress for matched book references on mount + on
  // focus (e.g. user reads a referenced book in another tab, comes
  // back). One Supabase round-trip total, caps at the number of
  // distinct matched books in the roadmap.
  const [autoProgress, setAutoProgress] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!roadmap) return;
    let cancelled = false;
    const refresh = () => {
      void fetchAutoProgressMap(roadmap).then((map) => {
        if (!cancelled) setAutoProgress(map);
      });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
    };
  }, [roadmap]);

  const [enrollDialogOpen, setEnrollDialogOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [unenrollConfirmOpen, setUnenrollConfirmOpen] = useState(false);

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
          className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent"
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

  const handleDelete = () => setDeleteConfirmOpen(true);
  const performDelete = () => {
    deleteRoadmap(roadmap.id);
    navigate("/roadmaps");
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
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs text-text-secondary">
                  {pct === 100 ? (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <Trophy size={12} />
                      {t("roadmaps.complete")}
                    </span>
                  ) : (
                    `${pct}%`
                  )}
                </span>
              </div>
              <button
                onClick={() => setUnenrollConfirmOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-text-secondary hover:bg-glass-hover"
              >
                <XCircle size={14} />
                <span className="hidden sm:inline">
                  {t("roadmaps.unenroll")}
                </span>
              </button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={roadmap.nodes.length === 0}
              onClick={() => setEnrollDialogOpen(true)}
            >
              <Play size={14} />
              {t("roadmaps.startLearning")}
            </Button>
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
            className="inline-flex items-center gap-1.5 rounded-md border border-glass-border px-2.5 py-1.5 text-xs text-danger hover:bg-danger/10"
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
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white"
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
              autoProgress={autoProgress}
              onSelectNode={setSelectedNodeId}
              onNodeClick={handleNodeClick}
            />
          )}
        </div>

        {/* Side panel — always shown while enrolled (carries the
            deadline picker that applies to the whole roadmap), with
            the per-node section appended below when a node is also
            selected. */}
        {(enrollment || selectedNode) && (
          <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-glass-border bg-bg-secondary/50 p-4 lg:block">
            {enrollment && (
              <DeadlinePicker
                roadmap={roadmap}
                enrollment={enrollment}
                onChange={(date, mult) => setDeadline(enrollment.id, date, mult)}
              />
            )}
            {selectedNode && (
              <>
                <h3 className="mt-4 text-base font-semibold text-text-primary">
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
                      className="w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
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
                        className="text-xs text-accent hover:underline"
                      >
                        {t("roadmaps.resetSchedule")}
                      </button>
                    )}
                  </div>
                )}
                {enrollment && (
                  <NodeProgressPanel
                    manualPct={enrollment.nodeProgress[selectedNode.id] ?? 0}
                    autoPct={autoProgress[selectedNode.id] ?? 0}
                    onChange={(pct) =>
                      setNodeProgress(enrollment.id, selectedNode.id, pct)
                    }
                    onToggleComplete={() =>
                      toggleNodeComplete(enrollment.id, selectedNode.id)
                    }
                  />
                )}
                <ReferencesPanel
                  references={
                    (selectedNode.payload?.references as
                      | ResourceRef[]
                      | undefined) ?? []
                  }
                />
              </>
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

      <ConfirmModal
        open={deleteConfirmOpen}
        title={t("roadmaps.deleteTitle")}
        body={t("roadmaps.deleteConfirm")}
        confirmLabel={t("common.delete")}
        danger
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={performDelete}
      />

      <ConfirmModal
        open={unenrollConfirmOpen}
        title={t("roadmaps.unenrollTitle")}
        body={t("roadmaps.unenrollConfirm")}
        confirmLabel={t("roadmaps.unenroll")}
        onClose={() => setUnenrollConfirmOpen(false)}
        onConfirm={() => {
          if (enrollment) unenroll(enrollment.id);
        }}
      />
    </div>
  );
}

/**
 * Per-node progress slider + quick-complete button. Shows the
 * composited display percent (max of manual + auto-detected) and
 * highlights when auto-detection is contributing, so the user
 * understands that reading the cited book updated their progress
 * without them clicking anything.
 */
function NodeProgressPanel({
  manualPct,
  autoPct,
  onChange,
  onToggleComplete,
}: {
  manualPct: number;
  autoPct: number;
  onChange: (pct: number) => void;
  onToggleComplete: () => void;
}) {
  const { t } = useTranslation();
  const display = displayProgressPct(manualPct, autoPct);
  const autoWins = autoPct > manualPct;

  return (
    <div className="mt-4 space-y-2 rounded-md border border-glass-border bg-bg-secondary/40 p-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-text-secondary">
          {t("roadmaps.nodeProgress")}
        </label>
        <span className="text-sm font-semibold text-text-primary">
          {display}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={manualPct}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
        aria-label={t("roadmaps.nodeProgressManual")}
      />
      {autoWins && (
        <div className="flex items-center gap-1.5 text-2xs text-accent">
          <Sparkles size={11} />
          <span>{t("roadmaps.autoProgressBadge", { pct: autoPct })}</span>
        </div>
      )}
      <button
        onClick={onToggleComplete}
        className={cn(
          "w-full rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
          display >= 100
            ? "border border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover"
            : "bg-accent text-white hover:opacity-90",
        )}
      >
        {display >= 100
          ? t("roadmaps.markIncomplete")
          : t("roadmaps.markComplete")}
      </button>
    </div>
  );
}

/**
 * Lists the AI-cited references for the selected node. Matched
 * books become tappable links to the in-app book page; unmatched
 * citations show greyed with the cite-only badge so the user knows
 * the AI proposed it but we don't have it locally.
 */
function ReferencesPanel({ references }: { references: ResourceRef[] }) {
  const { t } = useTranslation();
  if (references.length === 0) return null;
  return (
    <div className="mt-4 space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {t("roadmaps.resources")}
      </h4>
      <ul className="space-y-1.5">
        {references.map((ref, i) => (
          <li key={i}>
            <ReferenceRow refItem={ref} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReferenceRow({ refItem }: { refItem: ResourceRef }) {
  const { t } = useTranslation();
  const matched =
    refItem.match?.source === "library" || refItem.match?.source === "catalog";
  const inner = (
    <div
      className={cn(
        "rounded-md border px-2.5 py-2 text-xs transition-colors",
        matched
          ? "border-accent/30 bg-accent/5 hover:bg-accent/10"
          : "border-glass-border bg-glass-bg/40 text-text-muted",
      )}
    >
      <div className="flex items-start gap-1.5">
        <BookOpen
          size={11}
          className={cn(
            "mt-0.5 shrink-0",
            matched ? "text-accent" : "text-text-muted",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text-primary">
            {refItem.title}
          </p>
          {refItem.author && (
            <p className="truncate text-2xs text-text-muted">
              {refItem.author}
            </p>
          )}
          {(refItem.pageRange || refItem.section) && (
            <p className="mt-0.5 text-2xs text-text-muted">
              {refItem.pageRange
                ? t("roadmaps.refPageRange", {
                    from: refItem.pageRange.from,
                    to: refItem.pageRange.to,
                  })
                : refItem.section}
            </p>
          )}
          {!matched && refItem.match?.source === "none" && (
            <p className="mt-1 text-2xs uppercase tracking-wide text-text-muted">
              {t("roadmaps.refNotInLibrary")}
            </p>
          )}
          {matched && (
            <p className="mt-1 inline-flex items-center gap-0.5 text-2xs text-accent">
              <ExternalLink size={9} />
              {refItem.match?.source === "library"
                ? t("roadmaps.refOpenLibrary")
                : t("roadmaps.refOpenCatalog")}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  if (
    matched &&
    refItem.match &&
    (refItem.match.source === "library" || refItem.match.source === "catalog")
  ) {
    return (
      <Link to={`/books/${bookIdSegment(refItem.match.bookId, refItem.title)}`}>
        {inner}
      </Link>
    );
  }
  if (refItem.url) {
    return (
      <a href={refItem.url} target="_blank" rel="noreferrer">
        {inner}
      </a>
    );
  }
  return inner;
}
