/**
 * The message column of the sheet: scroll area with the thread's message
 * bubbles, the empty-state headline + suggestion chips, the loading
 * spinner, the scroll-to-bottom button, and the save-as-flashcards modal.
 * Owns per-bubble actions (regenerate / edit / delete / duplicate / pick
 * suggestion), TTS and the scroll anchoring (useThreadScroll).
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, GitBranch } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { TypingIndicator, chipClass } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useFeature } from "@/lib/use-features";
import { useReadAloud } from "@/hooks/use-read-aloud";
import { useChatStore } from "@/stores/chat-store";
import { useSettingsStore, type AiProvider } from "@/stores/settings-store";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import type { ChatConversation, ChatMessage } from "@/types/chat";
import { MessageBubble } from "../MessageBubble";
import { SaveAsFlashcardsModal } from "../SaveAsFlashcardsModal";
import type { ConfirmFn } from "../page/useChatPageState";
import { useThreadScroll } from "./useThreadScroll";

interface ChatThreadProps {
  activeId: string | null;
  activeConversation: ChatConversation | null;
  messages: Map<string, ChatMessage>;
  activeLeafId: string | null;
  streamingMessageId: string | null;
  /** Root-to-leaf message path that is rendered. */
  threadPath: ChatMessage[];
  /** Initial-load layout freeze, see useChatPageState. */
  settling: boolean;
  threadLoading: boolean;
  /** Empty-state layout: headline pinned above the centered composer. */
  sheetCentered: boolean;
  confirm: ConfirmFn;
  /** "Branch here" on a bubble: the next send forks under that message. */
  onBranchHere: (messageId: string) => void;
  onEmptySuggestion: (text: string) => void;
}

export function ChatThread({
  activeId,
  activeConversation,
  messages,
  activeLeafId,
  streamingMessageId,
  threadPath,
  settling,
  threadLoading,
  sheetCentered,
  confirm,
  onBranchHere,
  onEmptySuggestion,
}: ChatThreadProps) {
  const { t } = useTranslation();
  const flashcardsEnabled = useFeature("flashcards");
  // parent lookup for the fork banner
  const allConversations = useChatStore((s) => s.conversations);
  const { branchFrom, setActiveLeaf, messageSuggestions } = useChatStore(
    useShallow((s) => ({
      branchFrom: s.branchFrom,
      setActiveLeaf: s.setActiveLeaf,
      messageSuggestions: s.messageSuggestions,
    })),
  );

  // model picker: null = default fallback chain, otherwise a strict pick
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );
  // used by the onPickSuggestion path; composer keeps its own copy
  const [selectedProvider, setSelectedProvider] = useState<AiProvider | null>(
    () => null,
  );
  // if the picked provider gets disabled, fall back to default
  useEffect(() => {
    if (selectedProvider && !configuredProviders.includes(selectedProvider)) {
      setSelectedProvider(null);
    }
  }, [configuredProviders, selectedProvider]);

  // flashcard extractor, held at thread level so the modal overlays the app
  const [flashcardSource, setFlashcardSource] = useState<{
    text: string;
    title: string;
  } | null>(null);

  const { scrollContainerRef, threadEndRef, atBottom, handleScroll, scrollToBottom } =
    useThreadScroll({ activeId, activeLeafId, messages, streamingMessageId });

  // one shared TTS instance so reading one bubble stops another
  const tts = useReadAloud();

  const emptySuggestions = [
    t("chat.emptySuggestion1"),
    t("chat.emptySuggestion2"),
    t("chat.emptySuggestion3"),
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="chat-scroll flex-1 overflow-y-auto overflow-x-hidden"
      >
        <div
          className={cn(
            "mx-auto flex w-full min-w-0 max-w-[820px] flex-col gap-7 px-3 pb-4 pt-3 sm:px-7 sm:pt-4",
            // empty state: pin the headline to the bottom of the
            // scroll area so it sits right above the centered composer
            sheetCentered && "min-h-full justify-end",
          )}
        >
          {(settling || threadLoading) && (
            <div
              className="pointer-events-none absolute inset-x-0 top-0 flex justify-center py-16"
              aria-label={t("chat.loading")}
            >
              <TypingIndicator size="md" className="text-text-muted" />
            </div>
          )}

          {sheetCentered && (
            <div
              className={cn(
                "flex flex-col items-center gap-4 pb-1 text-center",
                settling && "invisible",
              )}
              aria-hidden={settling || undefined}
            >
              <h1 className="font-display text-2xl font-semibold text-text-primary sm:text-3xl">
                {t("chat.emptyHeadline")}
              </h1>
              {/* an open empty conversation gets no helper line: the
                  headline + composer say it all, extra copy steals focus */}
              {!activeId && (
                <p className="text-sm text-text-muted">{t("chat.emptyBody")}</p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                {emptySuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onEmptySuggestion(s)}
                    className={cn(
                      chipClass,
                      "px-3 py-[7px] text-[13px] transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary",
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* forked conversation: where it came from, click = open the parent */}
          {activeConversation?.parent_conversation_id &&
            threadPath.length > 0 &&
            (() => {
              const parent = allConversations.find(
                (c) => c.id === activeConversation.parent_conversation_id,
              );
              if (!parent) return null;
              return (
                <button
                  type="button"
                  onClick={() =>
                    void useChatStore.getState().openConversation(parent.id)
                  }
                  className={cn(
                    chipClass,
                    "self-start transition-colors cursor-pointer hover:bg-surface-3 hover:text-text-primary",
                  )}
                >
                  <GitBranch size={14} strokeWidth={1.5} className="shrink-0" />
                  <span className="min-w-0 truncate">
                    {t("chat.forkedFrom", {
                      defaultValue: "Branched from {{title}}",
                      title: parent.title || t("chat.untitled"),
                    })}
                  </span>
                </button>
              );
            })()}
          {threadPath.map((msg) => {
            const parent = msg.parent_message_id
              ? messages.get(msg.parent_message_id)
              : null;
            // regenerate needs an assistant message with a user parent to resend;
            // undefined otherwise (first turn / detached) hides the button
            const handleRegenerate =
              msg.role === "assistant" && parent && parent.role === "user"
                ? () => {
                    const grandparent = parent.parent_message_id;
                    const provider = selectedProvider ?? undefined;
                    void branchFrom(
                      grandparent,
                      parent.content,
                      provider,
                      parent.attachments ?? undefined,
                    );
                  }
                : undefined;
            // edit only on user messages: branches a sibling under the same
            // parent, carrying attachments so an image+question keeps its image
            const handleEdit =
              msg.role === "user"
                ? (newText: string) => {
                    const provider = selectedProvider ?? undefined;
                    void branchFrom(
                      msg.parent_message_id,
                      newText,
                      provider,
                      msg.attachments ?? undefined,
                    );
                  }
                : undefined;
            return (
              <Fragment key={msg.id}>
              <MessageBubble
                msg={msg}
                messages={messages}
                activeLeafId={activeLeafId}
                streamingMessageId={streamingMessageId}
                sourceDocId={activeConversation?.source_doc_id ?? null}
                confirm={confirm}
                onBranchHere={() => onBranchHere(msg.id)}
                onPickBranch={setActiveLeaf}
                onSaveAsFlashcards={
                  flashcardsEnabled
                    ? () =>
                        setFlashcardSource({
                          text: msg.content,
                          title:
                            activeConversation?.title ||
                            t("chat.flashcards.defaultTitle"),
                        })
                    : undefined
                }
                onRegenerate={handleRegenerate}
                onEdit={handleEdit}
                onDelete={async () => {
                  const ok = await confirm({
                    title: t("chat.confirmDeleteMessageTitle"),
                    body: t("chat.confirmDeleteMessageBody"),
                    confirmLabel: t("common.delete"),
                    danger: true,
                  });
                  if (!ok) return;
                  await useChatStore.getState().deleteMessage(msg.id);
                }}
                tts={tts}
                suggestions={
                  msg.role === "assistant"
                    ? messageSuggestions.get(msg.id)
                    : undefined
                }
                onPickSuggestion={(text) => {
                  // branch a new user turn under this assistant message
                  const provider = selectedProvider ?? undefined;
                  void branchFrom(msg.id, text, provider);
                }}
              />
              {/* fork point: everything above is inherited history */}
              {msg.id === activeConversation?.forked_from_message_id && (
                <div className="flex items-center gap-3 text-2xs text-text-muted-2">
                  <div className="h-px flex-1 bg-surface-3" aria-hidden="true" />
                  <GitBranch size={12} strokeWidth={1.5} className="shrink-0" />
                  <span>
                    {t("chat.forkPoint", {
                      defaultValue: "Fork point, the messages above are history",
                    })}
                  </span>
                  <div className="h-px flex-1 bg-surface-3" aria-hidden="true" />
                </div>
              )}
              </Fragment>
            );
          })}
          <div ref={threadEndRef} />
        </div>
      </div>
      {/* jump-to-latest, shown when the user has scrolled up (e.g. reading
          while the answer is still streaming) */}
      {!atBottom && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={t("chat.scrollToBottom")}
          title={t("chat.scrollToBottom")}
          className="absolute bottom-3 right-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-bg-tertiary text-text-muted shadow-page transition-colors hover:bg-surface-3 hover:text-text-primary cursor-pointer"
        >
          <ChevronDown size={20} strokeWidth={1.5} />
        </button>
      )}
      {flashcardSource && (
        <SaveAsFlashcardsModal
          open={!!flashcardSource}
          onClose={() => setFlashcardSource(null)}
          passage={flashcardSource.text}
          defaultTitle={flashcardSource.title}
        />
      )}
    </div>
  );
}
