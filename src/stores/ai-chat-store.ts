import { create } from "zustand";
import {
  extractPdfText,
  streamChatResponse,
  type ChatMessage,
} from "@/lib/ai-client";
import { useReaderStore } from "@/stores/reader-store";
import type { AiProvider } from "@/stores/settings-store";

interface AiChatState {
  conversations: Map<string, ChatMessage[]>;
  isStreaming: boolean;
  streamingContent: string;
  /**
   * Provider currently producing the response, set as soon as the
   * first delta is received. Null while waiting / between turns.
   */
  activeProvider: AiProvider | null;
  error: string | null;

  sendMessage: (text: string) => Promise<void>;
  clearConversation: () => void;
}

const PAGE_CONTEXT_RANGE = 3;

export const useAiChatStore = create<AiChatState>((set, get) => ({
  conversations: new Map(),
  isStreaming: false,
  streamingContent: "",
  activeProvider: null,
  error: null,

  async sendMessage(text: string) {
    const readerState = useReaderStore.getState();
    const docId = readerState.activeDocumentId;
    const activeDoc = readerState.getActiveDoc();
    if (!docId || !activeDoc?.meta?.fileUrl) return;

    const { conversations } = get();
    const existing = conversations.get(docId) ?? [];

    const userMessage: ChatMessage = { role: "user", content: text };
    const updatedMessages = [...existing, userMessage];

    const nextConvos = new Map(conversations);
    nextConvos.set(docId, updatedMessages);
    set({
      conversations: nextConvos,
      isStreaming: true,
      streamingContent: "",
      activeProvider: null,
      error: null,
    });

    try {
      const currentPage = activeDoc.currentPage;
      const startPage = Math.max(1, currentPage - PAGE_CONTEXT_RANGE);
      const endPage = Math.min(
        activeDoc.totalPages,
        currentPage + PAGE_CONTEXT_RANGE,
      );

      const pageContext = await extractPdfText(
        activeDoc.meta.fileUrl,
        startPage,
        endPage,
      );

      const title = activeDoc.customTitle || activeDoc.meta.title || "Untitled";
      let fullResponse = "";
      let lastProvider: AiProvider | null = null;

      for await (const chunk of streamChatResponse(
        updatedMessages,
        title,
        pageContext,
      )) {
        fullResponse += chunk.delta;
        if (chunk.provider !== lastProvider) {
          lastProvider = chunk.provider;
          set({ streamingContent: fullResponse, activeProvider: chunk.provider });
        } else {
          set({ streamingContent: fullResponse });
        }
      }

      const assistantMessage: ChatMessage = {
        role: "assistant",
        content: fullResponse,
      };

      const finalConvos = new Map(get().conversations);
      finalConvos.set(docId, [...updatedMessages, assistantMessage]);
      set({
        conversations: finalConvos,
        isStreaming: false,
        streamingContent: "",
        activeProvider: null,
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "An error occurred";
      set({
        isStreaming: false,
        streamingContent: "",
        activeProvider: null,
        error: errorMessage,
      });
    }
  },

  clearConversation() {
    const docId = useReaderStore.getState().activeDocumentId;
    if (!docId) return;
    const nextConvos = new Map(get().conversations);
    nextConvos.delete(docId);
    set({ conversations: nextConvos, error: null });
  },
}));
