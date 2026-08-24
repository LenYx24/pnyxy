import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronRight, Map as MapIcon, Plus, Sparkles, Trophy } from "lucide-react";
import { cn } from "@/lib/cn";
import { datedDefaultTitle } from "@/lib/entity-title";
import { Button } from "@/components/ui";
import { useRoadmapStore } from "@/stores/roadmap-store";
import { progressFraction } from "./lib/scheduler";
import { AiGenerateRoadmapModal } from "./AiGenerateRoadmapModal";

export function RoadmapsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const load = useRoadmapStore((s) => s.load);
  const loaded = useRoadmapStore((s) => s.loaded);
  const roadmaps = useRoadmapStore((s) => s.roadmaps);
  const enrollments = useRoadmapStore((s) => s.enrollments);
  const createRoadmap = useRoadmapStore((s) => s.createRoadmap);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [aiOpen, setAiOpen] = useState(false);

  useEffect(() => {
    if (!loaded) void load();
  }, [load, loaded]);

  const { inProgress, completed } = useMemo(() => {
    const inProg: Array<{
      enrollmentId: string;
      roadmapId: string;
      progress: number;
    }> = [];
    const done: typeof inProg = [];
    for (const e of enrollments.values()) {
      const r = roadmaps.get(e.roadmapId);
      if (!r) continue;
      const progress = progressFraction(r, e);
      const entry = {
        enrollmentId: e.id,
        roadmapId: e.roadmapId,
        progress,
      };
      if (progress >= 1) done.push(entry);
      else inProg.push(entry);
    }
    return { inProgress: inProg, completed: done };
  }, [enrollments, roadmaps]);

  const [showCompleted, setShowCompleted] = useState(false);

  const allRoadmaps = useMemo(
    () => Array.from(roadmaps.values()).sort((a, b) => b.updatedAt - a.updatedAt),
    [roadmaps],
  );

  const handleCreate = () => {
    const title = newTitle.trim();
    const r = createRoadmap(title || datedDefaultTitle(t, "roadmap"));
    setCreating(false);
    setNewTitle("");
    navigate(`/roadmaps/${r.id}/edit`);
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
            <MapIcon size={20} className="text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-text-primary">
              {t("roadmaps.title")}
            </h1>
            <p className="text-xs text-text-muted sm:text-sm">
              {t("roadmaps.tagline")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="soft" onClick={() => setAiOpen(true)}>
            <Sparkles size={16} />
            {t("roadmaps.aiGenerate.button")}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus size={16} />
            {t("roadmaps.new")}
          </Button>
        </div>
      </div>

      <AiGenerateRoadmapModal open={aiOpen} onClose={() => setAiOpen(false)} />

      {creating && (
        <div className="rounded-xl border border-glass-border bg-glass-bg/50 p-4">
          <label className="block text-sm font-medium text-text-primary">
            {t("roadmaps.titleLabel")}
          </label>
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setNewTitle("");
              }
            }}
            placeholder={t("roadmaps.titlePlaceholder")}
            className="mt-2 w-full rounded-md border border-glass-border bg-bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCreating(false);
                setNewTitle("");
              }}
            >
              {t("common.cancel")}
            </Button>
            <Button size="sm" onClick={handleCreate}>
              {t("roadmaps.createAndEdit")}
            </Button>
          </div>
        </div>
      )}

      {/* In-progress enrollments: always visible. */}
      {inProgress.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
            {t("roadmaps.enrolledHeading")}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {inProgress.map(({ roadmapId, progress }) => {
              const r = roadmaps.get(roadmapId)!;
              const pct = Math.round(progress * 100);
              return (
                <Link
                  key={roadmapId}
                  to={`/roadmaps/${roadmapId}`}
                  className="group block rounded-xl border border-glass-border bg-glass-bg/50 p-4 transition-colors hover:bg-glass-hover"
                >
                  <h3 className="line-clamp-2 text-sm font-semibold text-text-primary">
                    {r.title}
                  </h3>
                  {r.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                      {r.description}
                    </p>
                  )}
                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-glass-bg">
                      <div
                        className="h-full rounded-full bg-accent transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="mt-1 text-2xs text-text-muted">
                      {t("roadmaps.percentComplete", { pct })}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Completed enrollments: collapsed by default to keep the list tidy. */}
      {completed.length > 0 && (
        <section className="space-y-3">
          <button
            onClick={() => setShowCompleted((v) => !v)}
            className="flex w-full items-center gap-2 text-sm font-semibold uppercase tracking-wide text-text-muted hover:text-text-primary transition-colors"
            aria-expanded={showCompleted}
          >
            <ChevronRight
              size={14}
              className={cn(
                "transition-transform",
                showCompleted && "rotate-90",
              )}
            />
            <Trophy size={14} className="text-warning" />
            <span>
              {t("roadmaps.completedHeading", { count: completed.length })}
            </span>
          </button>
          {showCompleted && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {completed.map(({ roadmapId }) => {
                const r = roadmaps.get(roadmapId)!;
                return (
                  <Link
                    key={roadmapId}
                    to={`/roadmaps/${roadmapId}`}
                    className="group block rounded-xl border border-glass-border bg-glass-bg/30 p-4 opacity-80 transition-colors hover:bg-glass-hover hover:opacity-100"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="line-clamp-2 text-sm font-semibold text-text-primary">
                        {r.title}
                      </h3>
                      <Trophy
                        size={14}
                        className="shrink-0 text-warning"
                      />
                    </div>
                    {r.description && (
                      <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                        {r.description}
                      </p>
                    )}
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* All roadmaps section */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          {t("roadmaps.yoursHeading")}
        </h2>
        {allRoadmaps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-glass-border p-8 text-center">
            <p className="text-sm text-text-secondary">
              {t("roadmaps.empty")}
            </p>
            <button
              onClick={() => setCreating(true)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white"
            >
              <Plus size={16} />
              {t("roadmaps.new")}
            </button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {allRoadmaps.map((r) => (
              <Link
                key={r.id}
                to={`/roadmaps/${r.id}`}
                className="group block rounded-xl border border-glass-border bg-glass-bg/50 p-4 transition-colors hover:bg-glass-hover"
              >
                <h3 className="line-clamp-2 text-sm font-semibold text-text-primary">
                  {r.title}
                </h3>
                {r.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-text-secondary">
                    {r.description}
                  </p>
                )}
                <p className="mt-2 text-2xs text-text-muted">
                  {t("roadmaps.nodeCount", { count: r.nodes.length })}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
