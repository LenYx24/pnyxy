import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { useRoadmapStore } from "@/stores/roadmap-store";
import {
  generateRoadmap,
  RoadmapGenerationError,
  MIN_ROADMAP_NODES,
  MAX_ROADMAP_NODES,
  DEFAULT_ROADMAP_NODES,
} from "@/lib/roadmap/roadmap-ai";
import type { RoadmapNode, RoadmapEdge } from "@/types/roadmap";

interface RoadmapPreview {
  title: string;
  description: string;
  nodes: RoadmapNode[];
  edges: RoadmapEdge[];
}

interface AiGenerateRoadmapModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Topic-prompt → AI-generated roadmap → persisted via the existing
 * roadmap store. Mirrors the shape of the quiz-generation modal but
 * stays self-contained to avoid coupling the quiz flow to changes
 * here.
 *
 * Flow:
 *   1. User types a topic ("learn linear algebra"), picks a node
 *      count, clicks Generate.
 *   2. We stream from the AI provider chain, parse JSON, validate,
 *      drop cycles defensively. Errors are surfaced inline so the
 *      user can fix the topic and retry without losing state.
 *   3. Preview lists the proposed nodes. User can accept (creates
 *      the roadmap and navigates to /roadmaps/<id>/edit) or reject
 *      to refine the topic.
 */
export function AiGenerateRoadmapModal({
  open,
  onClose,
}: AiGenerateRoadmapModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const createRoadmap = useRoadmapStore((s) => s.createRoadmap);
  const updateRoadmap = useRoadmapStore((s) => s.updateRoadmap);
  const upsertNode = useRoadmapStore((s) => s.upsertNode);
  const upsertEdge = useRoadmapStore((s) => s.upsertEdge);

  const [topic, setTopic] = useState("");
  const [nodeCount, setNodeCount] = useState(DEFAULT_ROADMAP_NODES);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RoadmapPreview | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const topicRef = useRef<HTMLInputElement>(null);

  // Reset on each open. Keeps state simple, the user gets a clean
  // slate even if they cancel mid-generation last time.
  useEffect(() => {
    if (!open) return;
    setTopic("");
    setNodeCount(DEFAULT_ROADMAP_NODES);
    setError(null);
    setPreview(null);
    setGenerating(false);
    const timer = setTimeout(() => topicRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [open]);

  // Cancel any in-flight generation when the modal closes.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const handleGenerate = async () => {
    if (generating) return;
    setError(null);
    setPreview(null);
    setGenerating(true);
    abortRef.current = new AbortController();
    try {
      const draft = await generateRoadmap({
        topic,
        maxNodes: nodeCount,
        signal: abortRef.current.signal,
      });
      setPreview(draft);
    } catch (err) {
      if (err instanceof RoadmapGenerationError) {
        // Map a few error kinds to friendlier messages; everything
        // else falls through to the raw error text.
        if (err.kind === "empty_topic")
          setError(t("roadmaps.aiGenerate.errors.emptyTopic"));
        else if (err.kind === "parse_failed" || err.kind === "shape_invalid")
          setError(t("roadmaps.aiGenerate.errors.parseFailed"));
        else if (err.kind === "no_response")
          setError(t("roadmaps.aiGenerate.errors.noResponse"));
        else setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleAccept = () => {
    if (!preview) return;
    const r = createRoadmap(preview.title);
    updateRoadmap(r.id, { description: preview.description });
    for (const n of preview.nodes) upsertNode(r.id, n);
    for (const e of preview.edges) upsertEdge(r.id, e);
    onClose();
    navigate(`/roadmaps/${r.id}/edit`);
  };

  if (!open) return null;

  const canGenerate = !generating && topic.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !generating && onClose()}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-glass-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("roadmaps.aiGenerate.title")}
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={generating}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:opacity-50"
            aria-label={t("common.close")}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("roadmaps.aiGenerate.topicLabel")}
            </label>
            <input
              ref={topicRef}
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canGenerate) handleGenerate();
              }}
              placeholder={t("roadmaps.aiGenerate.topicPlaceholder")}
              maxLength={200}
              disabled={generating}
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent disabled:opacity-50"
            />
            <p className="mt-1 text-2xs text-text-muted">
              {t("roadmaps.aiGenerate.topicHint")}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("roadmaps.aiGenerate.countLabel", { count: nodeCount })}
            </label>
            <input
              type="range"
              min={MIN_ROADMAP_NODES}
              max={MAX_ROADMAP_NODES}
              value={nodeCount}
              onChange={(e) => setNodeCount(Number(e.target.value))}
              disabled={generating}
              className="w-full accent-accent"
            />
            <div className="flex justify-between text-2xs text-text-muted">
              <span>{MIN_ROADMAP_NODES}</span>
              <span>{MAX_ROADMAP_NODES}</span>
            </div>
          </div>

          {generating && (
            <div className="flex items-center gap-2 rounded-lg border border-glass-border bg-glass-bg/40 px-3 py-2 text-sm text-text-muted">
              <Loader2 size={14} className="animate-spin text-accent" />
              {t("roadmaps.aiGenerate.generating")}
            </div>
          )}

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          {preview && !generating && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {t("roadmaps.aiGenerate.previewLabel", {
                  count: preview.nodes.length,
                  edges: preview.edges.length,
                })}
              </p>
              <div className="rounded-lg border border-glass-border bg-glass-bg/40 p-3">
                <p className="text-sm font-semibold text-text-primary">
                  {preview.title}
                </p>
                {preview.description && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    {preview.description}
                  </p>
                )}
              </div>
              <ol className="space-y-1.5">
                {preview.nodes.map((n, i) => (
                  <li
                    key={n.id}
                    className="rounded-md border border-glass-border bg-bg-primary/40 p-2"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-2xs font-medium text-accent">
                        {i + 1}.
                      </span>
                      <span className="flex-1 text-sm font-medium text-text-primary">
                        {n.title}
                      </span>
                      <span className="shrink-0 text-2xs text-text-muted">
                        ~{n.estimatedMinutes}m
                      </span>
                    </div>
                    {n.description && (
                      <p className="mt-1 pl-5 text-xs text-text-secondary">
                        {n.description}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-glass-border px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={generating}>
            {t("common.cancel")}
          </Button>
          {preview ? (
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setPreview(null);
                  setError(null);
                }}
              >
                {t("roadmaps.aiGenerate.regenerate")}
              </Button>
              <Button onClick={handleAccept}>
                {t("roadmaps.aiGenerate.accept")}
              </Button>
            </>
          ) : (
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              {generating ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  {t("roadmaps.aiGenerate.generatingShort")}
                </>
              ) : (
                <>
                  <Sparkles size={14} />
                  {t("roadmaps.aiGenerate.generate")}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
