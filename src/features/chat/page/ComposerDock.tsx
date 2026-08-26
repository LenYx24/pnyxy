/**
 * The composer column at the bottom of the sheet: the roadmap-edit chip,
 * the "branching from" chip, and ChatComposer itself. Owns the submit
 * mapping (composer payload -> chat-store send / branch / image call), the
 * reading-context loader and the source-document chip.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Map as MapIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { chipClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useFeature } from "@/lib/use-features";
import { buildRecommendationSystemPrompt } from "@/lib/ai/recommendation-prompts";
import {
  fetchRecentReading,
  formatReadingContextPrompt,
} from "@/lib/reading-context";
import { useChatStore } from "@/stores/chat-store";
import { useRoadmap, useRoadmapStore } from "@/stores/roadmap-store";
import type { ChatConversation } from "@/types/chat";
import { ChatComposer, type ChatComposerSubmitPayload } from "../ChatComposer";
import type { ScopeSource } from "./useChatPageState";

interface ComposerDockProps {
  value: string;
  onChange: (value: string) => void;
  activeId: string | null;
  activeConversation: ChatConversation | null;
  scopeSource: ScopeSource;
  /** Wraps the composer so the page can focus its textarea. */
  composerWrapRef: RefObject<HTMLDivElement | null>;
}

export function ComposerDock({
  value,
  onChange,
  activeId,
  activeConversation,
  scopeSource,
  composerWrapRef,
}: ComposerDockProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roadmapsEnabled = useFeature("roadmaps");
  const {
    streamingMessageId,
    createConversation,
    sendMessage,
    sendImageMessage,
  } = useChatStore(
    useShallow((s) => ({
      streamingMessageId: s.streamingMessageId,
      createConversation: s.createConversation,
      sendMessage: s.sendMessage,
      sendImageMessage: s.sendImageMessage,
    })),
  );

  // roadmap-edit mode: load the roadmap store and resolve its title for the pill
  const targetRoadmapId = activeConversation?.target_roadmap_id ?? null;
  const targetRoadmap = useRoadmap(targetRoadmapId ?? undefined);
  const roadmapsLoaded = useRoadmapStore((s) => s.loaded);
  const loadRoadmaps = useRoadmapStore((s) => s.load);
  useEffect(() => {
    if (targetRoadmapId && !roadmapsLoaded) void loadRoadmaps();
  }, [targetRoadmapId, roadmapsLoaded, loadRoadmaps]);

  // conversation ids whose source-page chip is dismissed, session-only
  const [hiddenSourceChips, setHiddenSourceChips] = useState<Set<string>>(
    () => new Set(),
  );
  const handleHideSourceChip = useCallback((conversationId: string) => {
    setHiddenSourceChips((prev) => {
      const next = new Set(prev);
      next.add(conversationId);
      return next;
    });
  }, []);

  // maps the composer payload to a chat-store call (branch / lazy-create flows)
  const handleSubmit = useCallback(
    async (payload: ChatComposerSubmitPayload) => {
      const text = payload.text.trim();
      const attachments =
        payload.attachments.length > 0 ? payload.attachments : undefined;
      // allow attachment-only sends
      if (!text && !attachments) return;
      onChange("");
      // image mode routes to the Images API, needs a conversation first
      if (payload.mode === "image") {
        if (!activeId) {
          const id = await createConversation("", null, scopeSource);
          if (!id) return;
        }
        await sendImageMessage(text);
        return;
      }
      const provider = payload.provider ?? undefined;
      // topic-first modes swap the system prompt for one turn; reasoning is sticky
      const sendOptions =
        payload.mode !== "default" || payload.reasoning
          ? {
              ...(payload.mode !== "default"
                ? {
                    systemPromptOverride: buildRecommendationSystemPrompt(
                      payload.mode,
                    ),
                  }
                : {}),
              ...(payload.reasoning ? { reasoning: true } : {}),
            }
          : undefined;
      if (!activeId) {
        const id = await createConversation("", null, scopeSource);
        if (!id) return;
      }
      await sendMessage(text, provider, attachments, sendOptions);
    },
    [
      onChange,
      activeId,
      createConversation,
      sendMessage,
      sendImageMessage,
      scopeSource,
    ],
  );

  // reading-context loader for the composer's "+" menu
  const handleLoadReadingContext = useCallback(
    async (mode: "week" | "all") => {
      const books = await fetchRecentReading(
        mode === "week" ? { days: 7, limit: 10 } : { limit: 10 },
      );
      const intro =
        mode === "week"
          ? t("chat.readingContext.weekIntro")
          : t("chat.readingContext.recentIntro");
      return formatReadingContextPrompt(books, intro);
    },
    [t],
  );

  // source-document chip for the composer: click jumps back to the page,
  // x hides it for the session
  const sourceChip = useMemo(() => {
    if (!activeConversation?.source_doc_id) return null;
    if (hiddenSourceChips.has(activeConversation.id)) return null;
    const href = `/reader/${activeConversation.source_doc_id}${
      activeConversation.source_page
        ? `?page=${activeConversation.source_page}`
        : ""
    }`;
    return {
      label: t("chat.sourceContext", {
        title: activeConversation.source_doc_title ?? "-",
        page: activeConversation.source_page ?? "-",
      }),
      onOpen: () => navigate(href),
      onHide: () => handleHideSourceChip(activeConversation.id),
    };
  }, [activeConversation, hiddenSourceChips, navigate, handleHideSourceChip, t]);

  return (
    <div className="mx-auto w-full max-w-[820px] px-3 pb-0 pt-3 sm:px-7 sm:pb-5 sm:pt-4">
      {roadmapsEnabled && targetRoadmapId ? (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {/* roadmap edit-mode chip, shown when this conversation is tied to a roadmap */}
          {roadmapsEnabled && targetRoadmapId && (
            <span className={cn(chipClass, "max-w-full")}>
              <MapIcon size={14} strokeWidth={1.5} className="shrink-0" />
              <span className="min-w-0 truncate">
                {t("chat.editingRoadmap", {
                  title:
                    targetRoadmap?.title ||
                    t("roadmaps.untitled"),
                })}
              </span>
              <a
                href={`/roadmaps/${targetRoadmapId}/edit`}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/roadmaps/${targetRoadmapId}/edit`);
                }}
                className="shrink-0 text-text-primary underline-offset-2 hover:underline cursor-pointer"
              >
                {t("chat.openInEditor")}
              </a>
            </span>
          )}
        </div>
      ) : null}
      <div ref={composerWrapRef} className="contents">
        <ChatComposer
          value={value}
          onChange={onChange}
          onSubmit={handleSubmit}
          isStreaming={streamingMessageId !== null}
          onStop={() => useChatStore.getState().stopStreaming()}
          onLoadReadingContext={handleLoadReadingContext}
          contextChip={sourceChip}
          edgeToEdgeOnMobile
        />
      </div>
    </div>
  );
}
