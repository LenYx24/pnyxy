/**
 * "What does the AI see for the next message?" transparency modal: shows
 * every layer the next turn's system prompt (and history window) is
 * assembled from, in prompt order, each with the real text/data behind it.
 * A client mirror of what the send path (chat-stream.ts -> ai-context.ts
 * -> ai-client.ts) actually builds, so the user can audit context instead
 * of guessing. Reuses `buildAiContextPack` itself (not a re-implementation)
 * so the preset/document/attachment text shown here is exactly what would
 * be sent.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Copy, Eye, Info } from "lucide-react";
import { Button, FormModal, Tooltip, chipClass, chipAccentClass } from "@/components/ui";
import { useContextOverridesStore, type OverridableLayer } from "@/stores/context-overrides-store";
import {
  buildSystemPrompt,
  estimateTokens,
} from "@/lib/ai/ai-client";
import { buildAiContextPack, type AiContextPack } from "@/lib/ai/ai-context";
import {
  TEACHER_GUARDRAIL,
  TEACHER_MODE_ENABLED,
  teacherBlock,
} from "@/lib/ai/teacher-mode";
import { resolveAiContextForConversation } from "@/features/settings/ai-context/resolve-runtime";
import { findLibraryItemByDocId } from "@/features/settings/ai-context/library-keys";
import { useChatStore, pathFromRoot, windowChatHistory } from "@/stores/chat-store";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSpaceStore } from "@/stores/space-store";
import { modelLabel, predictBilledModel, QUOTA_AUTO_DEFAULT_MODEL } from "@/features/chat/quota";
import { showToast } from "@/stores/toast-store";
import { logError } from "@/lib/logger";
import { cn } from "@/lib/cn";
import type { ChatMessageAttachment } from "@/types/chat";
import type { Folder } from "@/types/database";
import type { Space, SpaceSection } from "@/types/space";

interface ContextInspectorModalProps {
  open: boolean;
  onClose: () => void;
  docId: string | null;
  docTitle: string | null;
  conversationId: string | null;
  /** Attachments staged for the next send, when the caller owns that state
   *  (only the composer does; header-only entry points omit it). */
  attachments?: ChatMessageAttachment[];
  /** Thinking/reasoning toggle, when the caller owns it (composer only). */
  reasoning?: boolean;
}

const SOURCE_KEY: Record<string, string> = {
  override: "sourceOverride",
  book: "sourceBook",
  folder: "sourceFolder",
  org: "sourceOrg",
  default: "sourceDefault",
};

// Illustrative reference budget for the size bar. No single number is
// enforced across every provider/model this app can route to, this is a
// reasonable mid-range figure (matches the free-tier Gemini/GPT-4o-mini
// context sizes) purely to give the bar a sense of scale.
const DISPLAY_CONTEXT_BUDGET_TOKENS = 32_000;

// Rough per-image token cost (vision tokenizers bill in tiles, not chars),
// used only to fold image attachments into the size estimate.
const IMAGE_TOKEN_ESTIMATE = 1500;

type LayerKey =
  | "base"
  | "teacher"
  | "preset"
  | "course"
  | "document"
  | "attachments"
  | "history"
  | "search";

interface CourseContext {
  space: Space;
  termLabel: string | null;
  /** null when the space isn't the currently loaded one (its sections
   *  aren't fetched outside its own course page, see resolveCourseContext). */
  sections: SpaceSection[] | null;
}

/** Walk a folder's parent chain (root last) and collect the names seen. */
function folderChainNames(
  folders: readonly Folder[],
  folderId: string | null,
): Set<string> {
  const byId = new Map(folders.map((f) => [f.id, f] as const));
  const names = new Set<string>();
  let cur = folderId ? byId.get(folderId) : undefined;
  let guard = 0;
  while (cur && guard++ < 64) {
    names.add(cur.name);
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined;
  }
  return names;
}

/**
 * Best-effort course match for the "Course" layer. There's no direct
 * client-side link from a conversation to a Space today:
 *  - `books.source_space_id` (migration 00065) exists in the DB but isn't
 *    selected into the client `Book`/library-store shape, so it can't be
 *    read here without an extra query; skipped.
 *  - Course spaces create a root library folder named exactly after the
 *    space (see `ensureCourseFolders` in stores/space-store.ts), so this
 *    walks the book's (and the conversation's own) folder chain looking
 *    for a name match against the user's spaces instead.
 * Term + sections only render when the matched space is also the
 * currently loaded `activeSpace`, since that's the only time its
 * offerings/sections are in the store, fetching them here on every modal
 * open would race whatever the Spaces page itself is showing.
 */
async function resolveCourseContext(
  docId: string | null,
  conversationId: string | null,
): Promise<CourseContext | null> {
  const spaceState = useSpaceStore.getState();
  if (spaceState.mySpaces.length === 0) {
    try {
      await spaceState.fetchMine();
    } catch (err) {
      logError("contextInspector:resolveCourse", err);
      return null;
    }
  }
  const mySpaces = useSpaceStore.getState().mySpaces;
  if (mySpaces.length === 0) return null;

  const libraryState = useLibraryStore.getState();
  const bookFolderId = docId
    ? (findLibraryItemByDocId(libraryState.books, docId)?.folder_id ?? null)
    : null;
  const conv = conversationId
    ? useChatStore.getState().conversations.find((c) => c.id === conversationId)
    : null;
  const convFolderId = conv?.folder_id ?? null;

  const candidateNames = new Set<string>([
    ...folderChainNames(libraryState.folders, bookFolderId),
    ...folderChainNames(libraryState.folders, convFolderId),
  ]);
  if (candidateNames.size === 0) return null;

  const matched = mySpaces.find((sp) => candidateNames.has(sp.name));
  if (!matched) return null;

  const fresh = useSpaceStore.getState();
  const isActive = fresh.activeSpace?.id === matched.id;
  return {
    space: matched,
    termLabel: isActive ? (fresh.activeSpaceOfferings[0]?.term_label ?? null) : null,
    sections: isActive ? fresh.activeSpaceSections : null,
  };
}

function TokenBadge({ tokens }: { tokens: number | null }) {
  if (tokens === null) return null;
  return (
    <span className="shrink-0 font-mono text-2xs tabular-nums text-text-muted-2">
      ~{tokens.toLocaleString()}
    </span>
  );
}

/** Small on/off switch in a card header (stops the header's own toggle). */
function LayerSwitch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!on);
      }}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors cursor-pointer",
        on ? "bg-accent" : "bg-surface-3",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-[left]",
          on ? "left-3.5" : "left-0.5",
        )}
      />
    </button>
  );
}

function LayerCard({
  badge,
  title,
  chips,
  tokens,
  open,
  onToggle,
  children,
  enabled = true,
  onEnabledChange,
  switchLabel,
}: {
  badge: number;
  title: string;
  chips?: React.ReactNode;
  tokens: number | null;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  /** Layer switched off for the next sends (inspector override). */
  enabled?: boolean;
  onEnabledChange?: (next: boolean) => void;
  switchLabel?: string;
}) {
  return (
    <div className={cn("rounded-control bg-bg-secondary", !enabled && "opacity-60")}>
      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left cursor-pointer"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-2xs font-semibold text-text-secondary">
          {badge}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
          {title}
        </span>
        {chips}
        <TokenBadge tokens={enabled ? tokens : 0} />
        {onEnabledChange && switchLabel && (
          <LayerSwitch on={enabled} onChange={onEnabledChange} label={switchLabel} />
        )}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={cn(
            "shrink-0 text-text-muted transition-transform",
            open && "rotate-180",
          )}
        />
      </div>
      {open && (
        <div className="space-y-2 px-3 pb-3 text-sm text-text-secondary">
          {children}
        </div>
      )}
    </div>
  );
}

/** "Edit for this chat" box under a layer: the original stays visible
 *  above, the replacement is stored per conversation and applied on send. */
function LayerOverrideEditor({
  original,
  value,
  onSave,
  onReset,
}: {
  original: string;
  value: string | undefined;
  onSave: (text: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? original);
  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        {value !== undefined && (
          <span className={chipAccentClass}>{t("chat.contextInspector.override.editedChip")}</span>
        )}
        <button
          type="button"
          onClick={() => {
            setDraft(value ?? original);
            setEditing(true);
          }}
          className="text-xs text-accent hover:opacity-80 cursor-pointer"
        >
          {value !== undefined
            ? t("chat.contextInspector.override.editAgain")
            : t("chat.contextInspector.override.edit")}
        </button>
        {value !== undefined && (
          <button type="button" onClick={onReset} className="text-xs text-text-muted hover:text-text-primary cursor-pointer">
            {t("chat.contextInspector.override.reset")}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={8}
        className="field w-full resize-y font-mono text-[11px] leading-relaxed"
        aria-label={t("chat.contextInspector.override.edit")}
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            onSave(draft);
            setEditing(false);
          }}
        >
          {t("chat.contextInspector.override.apply")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
          {t("common.cancel")}
        </Button>
        <span className="text-2xs text-text-muted">{t("chat.contextInspector.override.hint")}</span>
      </div>
    </div>
  );
}

const preClass =
  "menu-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control bg-bg-primary px-3 py-2 font-mono text-[11px] leading-relaxed text-text-muted";

export function ContextInspectorModal({
  open,
  onClose,
  docId,
  docTitle,
  conversationId,
  attachments = [],
  reasoning = false,
}: ContextInspectorModalProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  // everything collapsed: the first view is the overview (bar + cards)
  const [openLayers, setOpenLayers] = useState<Set<LayerKey>>(() => new Set());
  // per-conversation overrides (switch layers off / replace their text)
  const overrides = useContextOverridesStore((s) => s.get(conversationId));
  const setLayerDisabled = useContextOverridesStore((s) => s.setDisabled);
  const setLayerEdit = useContextOverridesStore((s) => s.setEdit);
  const layerOn = (l: OverridableLayer) => !overrides.disabled.includes(l);
  const toggleLayer = useCallback((key: LayerKey) => {
    setOpenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const [loading, setLoading] = useState(true);
  const [contextPack, setContextPack] = useState<AiContextPack | null>(null);
  const [courseCtx, setCourseCtx] = useState<CourseContext | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const [pack, course] = await Promise.all([
        buildAiContextPack(docId, conversationId).catch((err) => {
          logError("contextInspector:buildPack", err);
          return { customContext: "", pageContext: "", imageAttachments: [] };
        }),
        resolveCourseContext(docId, conversationId).catch(() => null),
      ]);
      if (cancelled) return;
      setContextPack(pack);
      setCourseCtx(course);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, docId, conversationId]);

  // History window: the current path up to the active leaf, filtered to
  // conversational turns (mirrors chat-stream.ts's own filter before it
  // calls windowChatHistory), so "kept" here matches what the next turn
  // would actually resend.
  const messages = useChatStore((s) => s.messages);
  const activeLeafId = useChatStore((s) => s.activeLeafId);
  const historyTurns = useMemo(() => {
    if (!conversationId) return [];
    return pathFromRoot(messages, activeLeafId)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
  }, [messages, activeLeafId, conversationId]);
  const keptTurns = useMemo(
    () => windowChatHistory(historyTurns),
    [historyTurns],
  );
  const droppedCount = Math.max(0, historyTurns.length - keptTurns.length);

  // Context preset (sync, cheap store reads); resolved once more per
  // render so a live preset edit in Settings reflects immediately.
  const resolved = resolveAiContextForConversation({ docId, conversationId });
  const presetBody =
    contextPack?.customContext || resolved?.preset.body.trim() || "";

  const readerDoc = useReaderStore((s) =>
    docId ? s.documents.get(docId) : undefined,
  );
  const aiAttachToc = useSettingsStore((s) => s.aiAttachToc);
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);

  const effectiveDocTitle = (docTitle ?? "").trim();
  const hasDoc = effectiveDocTitle.length > 0;

  const baseText = useMemo(() => {
    const raw = buildSystemPrompt(effectiveDocTitle, "", "");
    const suffix = teacherBlock();
    return TEACHER_MODE_ENABLED && raw.endsWith(suffix)
      ? raw.slice(0, raw.length - suffix.length)
      : raw;
  }, [effectiveDocTitle]);

  const billedModel = predictBilledModel(pnyxyModel);
  const useGrounding = !hasDoc && billedModel === QUOTA_AUTO_DEFAULT_MODEL;

  // ── token estimate + size bar (chars/4, images at a flat estimate) ──
  const instrTokens =
    estimateTokens(baseText) +
    (TEACHER_MODE_ENABLED ? estimateTokens(TEACHER_GUARDRAIL) : 0) +
    estimateTokens(presetBody);
  const docImageTokens =
    (contextPack?.imageAttachments.length ?? 0) * IMAGE_TOKEN_ESTIMATE +
    attachments.length * IMAGE_TOKEN_ESTIMATE;
  const docTokens = estimateTokens(contextPack?.pageContext ?? "") + docImageTokens;
  const histTokens = keptTurns.reduce(
    (sum, m) => sum + estimateTokens(m.content),
    0,
  );
  const totalTokens = instrTokens + docTokens + histTokens;
  const barFillPercent =
    totalTokens > 0
      ? Math.min(100, (totalTokens / DISPLAY_CONTEXT_BUDGET_TOKENS) * 100)
      : 0;
  const segPercent = (n: number) => (totalTokens > 0 ? (n / totalTokens) * 100 : 0);

  const handleEditPreset = useCallback(() => {
    onClose();
    navigate("/settings/ai");
  }, [onClose, navigate]);

  const handleCopyPrompt = useCallback(async () => {
    const systemPrompt = buildSystemPrompt(
      effectiveDocTitle,
      contextPack?.pageContext ?? "",
      contextPack?.customContext ?? "",
    );
    const historyText = keptTurns
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n\n");
    const full = [systemPrompt, historyText].filter(Boolean).join("\n\n---\n\n");
    try {
      await navigator.clipboard.writeText(full);
      showToast(t("chat.contextInspector.copySuccess"), "success");
    } catch (err) {
      logError("contextInspector:copy", err);
      showToast(t("chat.contextInspector.copyFailed"), "error");
    }
  }, [effectiveDocTitle, contextPack, keptTurns, t]);

  const selectedPageNumbers = readerDoc
    ? Array.from(readerDoc.aiSelectedPages).sort((a, b) => a - b)
    : [];
  const tocAttached = !!readerDoc && aiAttachToc && readerDoc.toc.length > 0;

  const sections = courseCtx?.sections
    ? [...courseCtx.sections].sort((a, b) => a.sort_order - b.sort_order)
    : null;

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t("chat.contextInspector.title")}
      icon={Eye}
      size="lg"
      resizeStorageKey="pnyxy:context-inspector-size"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => void handleCopyPrompt()}>
            <Copy size={13} strokeWidth={1.5} />
            {t("chat.contextInspector.copyPrompt")}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={handleEditPreset}>
            {t("chat.contextInspector.editPreset")}
          </Button>
          <Button type="button" size="sm" variant="primary" onClick={onClose}>
            {t("common.ok")}
          </Button>
        </div>
      }
    >
      <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            <span>
              {t("chat.contextInspector.sizeSummary", {
                tokens: totalTokens.toLocaleString(),
                budget: DISPLAY_CONTEXT_BUDGET_TOKENS.toLocaleString(),
              })}
            </span>
            {/* the "how to read this" line lives behind an (i), not inline */}
            <Tooltip label={t("chat.contextInspector.intro")}>
              <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-surface-3 text-2xs text-text-muted" aria-label={t("chat.contextInspector.intro")}>
                <Info size={10} strokeWidth={1.75} />
              </span>
            </Tooltip>
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-secondary">
            <div
              className="flex h-full"
              style={{ width: `${barFillPercent}%` }}
            >
              <div
                className="h-full bg-accent"
                style={{ width: `${segPercent(instrTokens)}%` }}
              />
              <div
                className="h-full bg-accent/60"
                style={{ width: `${segPercent(docTokens)}%` }}
              />
              <div
                className="h-full bg-accent/30"
                style={{ width: `${segPercent(histTokens)}%` }}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-text-muted-2">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {t("chat.contextInspector.legendInstructions")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent/60" />
              {t("chat.contextInspector.legendDocument")}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent/30" />
              {t("chat.contextInspector.legendHistory")}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          {/* 1. Base instruction */}
          <LayerCard
            badge={1}
            title={t("chat.contextInspector.base")}
            chips={
              <>
              <span className={chipClass} title={t("chat.contextInspector.override.lockedHint")}>
                {t("chat.contextInspector.override.locked")}
              </span>
              <span className={chipClass}>
                {t(
                  hasDoc
                    ? "chat.contextInspector.modeDoc"
                    : "chat.contextInspector.modeChat",
                )}
              </span>
              </>
            }
            tokens={estimateTokens(baseText)}
            open={openLayers.has("base")}
            onToggle={() => toggleLayer("base")}
          >
            <pre className={preClass}>{baseText}</pre>
          </LayerCard>

          {/* 2. Teacher mode */}
          <LayerCard
            badge={2}
            title={t("chat.contextInspector.teacher")}
            chips={
              <>
                <span className={chipClass} title={t("chat.contextInspector.override.lockedHint")}>
                  {t("chat.contextInspector.override.locked")}
                </span>
                <span className={chipClass}>
                  {t(
                    TEACHER_MODE_ENABLED
                      ? "chat.contextInspector.active"
                      : "chat.contextInspector.off",
                  )}
                </span>
              </>
            }
            tokens={TEACHER_MODE_ENABLED ? estimateTokens(TEACHER_GUARDRAIL) : 0}
            open={openLayers.has("teacher")}
            onToggle={() => toggleLayer("teacher")}
          >
            <pre className={preClass}>{TEACHER_GUARDRAIL}</pre>
          </LayerCard>

          {/* 3. Context preset */}
          <LayerCard
            badge={3}
            title={t("chat.contextInspector.preset")}
            chips={
              resolved ? (
                <span className={chipAccentClass}>
                  {t(`chat.contextInspector.${SOURCE_KEY[resolved.source]}`)}
                </span>
              ) : undefined
            }
            tokens={estimateTokens(overrides.edits.preset ?? presetBody)}
            open={openLayers.has("preset")}
            onToggle={() => toggleLayer("preset")}
            enabled={layerOn("preset")}
            onEnabledChange={(on) => setLayerDisabled(conversationId, "preset", !on)}
            switchLabel={t("chat.contextInspector.override.switch")}
          >
            {resolved ? (
              <>
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                    {resolved.preset.name}
                  </p>
                  <button
                    type="button"
                    onClick={handleEditPreset}
                    className="shrink-0 text-xs text-accent transition-colors hover:opacity-80 cursor-pointer"
                  >
                    {t("common.edit")}
                  </button>
                </div>
                <pre className={preClass}>{presetBody}</pre>
              </>
            ) : (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.noPreset")}
              </p>
            )}
            <LayerOverrideEditor
              original={presetBody}
              value={overrides.edits.preset}
              onSave={(text) => setLayerEdit(conversationId, "preset", text)}
              onReset={() => setLayerEdit(conversationId, "preset", null)}
            />
          </LayerCard>

          {/* 4. Course, best-effort match, skipped when none */}
          {courseCtx && (
            <LayerCard
              badge={4}
              title={t("chat.contextInspector.course")}
              chips={
                <>
                  <span className={chipAccentClass}>{courseCtx.space.name}</span>
                  {courseCtx.termLabel && (
                    <span className={chipClass}>{courseCtx.termLabel}</span>
                  )}
                </>
              }
              tokens={null}
              open={openLayers.has("course")}
              onToggle={() => toggleLayer("course")}
            >
              {sections ? (
                sections.length > 0 ? (
                  <p className="text-xs text-text-muted">
                    {t(
                      sections.length === 1
                        ? "chat.contextInspector.sectionsCount_one"
                        : "chat.contextInspector.sectionsCount_other",
                      { count: sections.length },
                    )}
                    {": "}
                    {sections.map((s) => s.title).join(" · ")}
                  </p>
                ) : (
                  <p className="text-xs text-text-muted">
                    {t("chat.contextInspector.sectionsUnknown")}
                  </p>
                )
              ) : (
                <p className="text-xs text-text-muted">
                  {t("chat.contextInspector.sectionsUnknown")}
                </p>
              )}
            </LayerCard>
          )}

          {/* 5. Document */}
          <LayerCard
            badge={5}
            title={t("chat.contextInspector.doc")}
            chips={
              docId ? (
                <>
                  <span className={chipClass}>{effectiveDocTitle}</span>
                  {selectedPageNumbers.length > 0 && (
                    <span className={chipClass}>
                      {t(
                        selectedPageNumbers.length === 1
                          ? "chat.contextInspector.pages_one"
                          : "chat.contextInspector.pages_other",
                        { count: selectedPageNumbers.length },
                      )}
                    </span>
                  )}
                  {selectedPageNumbers.length > 0 && readerDoc && (
                    <span className={chipClass}>
                      {t(
                        readerDoc.aiSendPagesAsImage
                          ? "chat.contextInspector.asImages"
                          : "chat.contextInspector.asText",
                      )}
                    </span>
                  )}
                  {tocAttached && (
                    <span className={chipClass}>
                      {t("chat.contextInspector.tocAttached")}
                    </span>
                  )}
                </>
              ) : undefined
            }
            tokens={estimateTokens(overrides.edits.document ?? contextPack?.pageContext ?? "")}
            open={openLayers.has("document")}
            onToggle={() => toggleLayer("document")}
            enabled={layerOn("document")}
            onEnabledChange={(on) => setLayerDisabled(conversationId, "document", !on)}
            switchLabel={t("chat.contextInspector.override.switch")}
          >
            {!docId ? (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.noDoc")}
              </p>
            ) : loading ? (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.loading")}
              </p>
            ) : contextPack?.pageContext ? (
              <pre className={preClass}>{contextPack.pageContext}</pre>
            ) : (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.noPagesSelected")}
              </p>
            )}
            {docId && (
              <>
                {tocAttached && (
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <LayerSwitch
                      on={layerOn("toc")}
                      onChange={(on) => setLayerDisabled(conversationId, "toc", !on)}
                      label={t("chat.contextInspector.override.toc")}
                    />
                    {t("chat.contextInspector.override.toc")}
                  </label>
                )}
                <LayerOverrideEditor
                  original={contextPack?.pageContext ?? ""}
                  value={overrides.edits.document}
                  onSave={(text) => setLayerEdit(conversationId, "document", text)}
                  onReset={() => setLayerEdit(conversationId, "document", null)}
                />
              </>
            )}
          </LayerCard>

          {/* 6. Attachments (composer-staged, e.g. a whiteboard snapshot) */}
          <LayerCard
            badge={6}
            title={t("chat.contextInspector.attachments")}
            chips={
              attachments.length > 0 ? (
                <span className={chipClass}>
                  {t(
                    attachments.length === 1
                      ? "chat.contextInspector.attachmentsCount_one"
                      : "chat.contextInspector.attachmentsCount_other",
                    { count: attachments.length },
                  )}
                </span>
              ) : undefined
            }
            tokens={attachments.length * IMAGE_TOKEN_ESTIMATE}
            open={openLayers.has("attachments")}
            onToggle={() => toggleLayer("attachments")}
          >
            {attachments.length > 0 ? (
              <p className="text-xs text-text-secondary">
                {attachments.map((a) => a.name).filter(Boolean).join(", ")}
              </p>
            ) : (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.noAttachments")}
              </p>
            )}
          </LayerCard>

          {/* 7. History window */}
          <LayerCard
            badge={7}
            title={t("chat.contextInspector.history")}
            chips={
              <span className={chipClass}>
                {t("chat.contextInspector.historyCount", {
                  kept: keptTurns.length,
                  total: historyTurns.length,
                })}
              </span>
            }
            tokens={histTokens}
            open={openLayers.has("history")}
            onToggle={() => toggleLayer("history")}
            enabled={layerOn("history")}
            onEnabledChange={(on) => setLayerDisabled(conversationId, "history", !on)}
            switchLabel={t("chat.contextInspector.override.switch")}
          >
            {historyTurns.length === 0 ? (
              <p className="text-xs text-text-muted">
                {t("chat.contextInspector.historyEmpty")}
              </p>
            ) : droppedCount > 0 ? (
              <p className="text-xs text-text-muted">
                {t(
                  droppedCount === 1
                    ? "chat.contextInspector.historyDropped_one"
                    : "chat.contextInspector.historyDropped_other",
                  { count: droppedCount },
                )}
              </p>
            ) : null}
          </LayerCard>

          {/* 8. Search and model */}
          <LayerCard
            badge={8}
            title={t("chat.contextInspector.searchModel")}
            chips={
              <>
                <span className={chipClass}>
                  {t(
                    useGrounding
                      ? "chat.contextInspector.groundingOn"
                      : "chat.contextInspector.groundingOff",
                  )}
                </span>
                <span className={chipClass}>{modelLabel(billedModel)}</span>
              </>
            }
            tokens={null}
            open={openLayers.has("search")}
            onToggle={() => toggleLayer("search")}
          >
            <p className="text-xs text-text-muted">
              {t("chat.contextInspector.model")}: {modelLabel(billedModel)}
              {" · "}
              {t("chat.contextInspector.thinking")}
              {": "}
              {t(
                reasoning
                  ? "chat.contextInspector.thinkingOn"
                  : "chat.contextInspector.thinkingOff",
              )}
            </p>
          </LayerCard>
        </div>
    </FormModal>
  );
}
