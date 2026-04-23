import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BotMessageSquare, Send, Trash2, AlertCircle, Settings, X } from "lucide-react";
import { useAiChatStore } from "@/stores/ai-chat-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useReaderStore } from "@/stores/reader-store";
import { cn } from "@/lib/cn";
import type { IDockviewPanelProps } from "dockview";
import type { ChatMessage } from "@/lib/ai-client";
import type { AiProvider } from "@/stores/settings-store";

const EMPTY_MESSAGES: ChatMessage[] = [];

const PROVIDER_LABELS: Record<AiProvider, string> = {
  pnyxy: "Pnyxy",
  anthropic: "Anthropic",
  openai: "OpenAI",
};

interface AiChatPanelContentProps {
  onClose?: () => void;
}

function CloseButton({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={t("reader.aiChat.closeAria")}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-transparent bg-glass-bg/60 text-text-secondary transition-colors hover:border-glass-border hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      <X size={20} />
    </button>
  );
}

export function AiChatPanelContent({ onClose }: AiChatPanelContentProps = {}) {
  const { t } = useTranslation();
  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const anthropicApiKey = useSettingsStore((s) => s.anthropicApiKey);
  const openaiApiKey = useSettingsStore((s) => s.openaiApiKey);
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const conversations = useAiChatStore((s) => s.conversations);
  const messages = useMemo(
    () =>
      activeDocumentId
        ? conversations.get(activeDocumentId) ?? EMPTY_MESSAGES
        : EMPTY_MESSAGES,
    [conversations, activeDocumentId],
  );
  const isStreaming = useAiChatStore((s) => s.isStreaming);
  const streamingContent = useAiChatStore((s) => s.streamingContent);
  const activeProvider = useAiChatStore((s) => s.activeProvider);
  const error = useAiChatStore((s) => s.error);
  const sendMessage = useAiChatStore((s) => s.sendMessage);
  const clearConversation = useAiChatStore((s) => s.clearConversation);

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage(trimmed);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Compute whether at least one enabled provider is usable.
  const hasUsableProvider = useMemo(() => {
    return enabledProviders.some((p) => {
      if (p === "pnyxy") return true;
      if (p === "anthropic") return !!anthropicApiKey.trim();
      if (p === "openai") return !!openaiApiKey.trim();
      return false;
    });
  }, [enabledProviders, anthropicApiKey, openaiApiKey]);

  if (!hasUsableProvider) {
    return (
      <div className="flex h-full flex-col bg-bg-secondary/50">
        {onClose && (
          <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
            <div className="flex items-center gap-2">
              <BotMessageSquare size={16} className="text-accent-purple" />
              <span className="text-sm font-medium text-text-primary">
                {t("reader.aiChat.title")}
              </span>
            </div>
            <CloseButton onClose={onClose} />
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <Settings size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">
            {enabledProviders.length === 0
              ? t("reader.aiChat.noProviders")
              : t("reader.aiChat.needsConfig")}
          </p>
        </div>
      </div>
    );
  }

  if (!activeDocumentId) {
    return (
      <div className="flex h-full flex-col bg-bg-secondary/50">
        {onClose && (
          <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
            <div className="flex items-center gap-2">
              <BotMessageSquare size={16} className="text-accent-purple" />
              <span className="text-sm font-medium text-text-primary">
                {t("reader.aiChat.title")}
              </span>
            </div>
            <CloseButton onClose={onClose} />
          </div>
        )}
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <BotMessageSquare size={32} className="text-text-muted" />
          <p className="text-sm text-text-secondary">
            {t("reader.aiChat.openDocument")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-glass-border pl-3 pr-1 py-1">
        <div className="flex items-center gap-2">
          <BotMessageSquare size={16} className="text-accent-purple" />
          <span className="text-sm font-medium text-text-primary">
            {t("reader.aiChat.title")}
          </span>
          {isStreaming && activeProvider && (
            <span className="text-[10px] uppercase tracking-wide text-text-muted">
              {t("reader.aiChat.via", {
                provider: PROVIDER_LABELS[activeProvider],
              })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="flex h-11 w-11 items-center justify-center rounded-md text-text-muted transition-colors hover:text-text-primary cursor-pointer"
              title={t("reader.aiChat.clearTitle")}
              aria-label={t("reader.aiChat.clearAria")}
            >
              <Trash2 size={16} />
            </button>
          )}
          {onClose && <CloseButton onClose={onClose} />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="flex flex-col items-center gap-2 py-8 text-center">
            <BotMessageSquare size={24} className="text-text-muted/50" />
            <p className="text-xs text-text-muted">
              {t("reader.aiChat.emptyPrompt")}
            </p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
              msg.role === "user"
                ? "ml-auto bg-accent-purple/20 text-text-primary"
                : "mr-auto bg-glass-bg text-text-secondary",
            )}
          >
            {msg.content}
          </div>
        ))}

        {isStreaming && streamingContent && (
          <div className="mr-auto max-w-[85%] rounded-lg bg-glass-bg px-3 py-2 text-sm text-text-secondary whitespace-pre-wrap">
            {streamingContent}
            <span className="inline-block w-1.5 h-4 ml-0.5 bg-accent-purple/60 animate-pulse" />
          </div>
        )}

        {isStreaming && !streamingContent && (
          <div className="mr-auto flex items-center gap-2 rounded-lg bg-glass-bg px-3 py-2 text-sm text-text-muted">
            <div className="flex gap-1">
              <div className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
              <div className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
              <div className="h-1.5 w-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            {t("reader.aiChat.thinking")}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-glass-border p-3">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("reader.aiChat.placeholder")}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple placeholder:text-text-muted"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className={cn(
              "shrink-0 rounded-lg p-2 transition-colors cursor-pointer",
              input.trim() && !isStreaming
                ? "bg-accent-purple text-white hover:bg-accent-purple/80"
                : "bg-glass-bg text-text-muted",
            )}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function AiChatPanel(_props: IDockviewPanelProps) {
  return <AiChatPanelContent />;
}
