/**
 * Tool-calling loop for the chat's assistant mode (library setup, notes,
 * whiteboards, web lookups). Same shape as the roadmap agent: stream with
 * tools, dispatch each tool_call, feed results back until the model stops
 * or the round cap is reached. The visible message is composed as the
 * activity log (one `pnyxy-step` block per tool call) followed by the
 * model's prose and then the cards (mini library, whiteboard offer), so
 * it renders the same live and after a reload.
 */
import {
  streamChatWithTools,
  type ContentBlock,
  type TextBlock,
  type ToolMessage,
  type ToolResultBlock,
  type ToolStopReason,
} from "@/lib/ai/ai-client";
import {
  serializeFolder,
  serializeOffer,
  serializeStep,
  type AgentOffer,
  type AgentStep,
} from "@/lib/ai/agent-blocks";
import {
  LIBRARY_TOOLS,
  buildLibraryAgentSystemPrompt,
  dispatchLibraryTool,
  type ToolContext,
} from "@/lib/ai/library-tools";
import { useLibraryStore } from "@/stores/library-store";
import { useNoteStore } from "@/stores/note-store";
import { useResourceStore } from "@/stores/resource-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import type { AiProvider } from "@/stores/settings-store";

const MAX_AGENTIC_ROUNDS = 10;

export async function runLibraryAgenticLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
  extraContext?: string,
  conversationId?: string | null,
): Promise<string> {
  // the snapshot needs folders, books and notes; the chat page loads
  // neither notes nor links itself
  const lib = useLibraryStore.getState();
  await Promise.allSettled([
    lib.fetchFolders(),
    lib.fetchLibrary(),
    useNoteStore.getState().notes.length === 0
      ? useNoteStore.getState().loadNotes()
      : null,
    useResourceStore.getState().resources.length === 0
      ? useResourceStore.getState().fetchResources()
      : null,
  ]);
  const systemPrompt =
    buildLibraryAgentSystemPrompt(conversationId) +
    (extraContext ? `\n\n${extraContext}` : "");

  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const approval = useToolApprovalStore.getState();
  // Stop button: reject whatever card is open so the loop unwinds
  const onAbort = () => approval.endTurn();
  signal.addEventListener("abort", onAbort, { once: true });

  const ctx: ToolContext = { conversationId, createdIds: new Set(), signal };
  const steps: AgentStep[] = [];
  const offers: AgentOffer[] = [];
  let lastFolderId: string | null = null;
  let prose = "";
  const compose = () =>
    [
      ...steps.map(serializeStep),
      prose.trim(),
      ...(lastFolderId ? [serializeFolder(lastFolderId)] : []),
      ...offers.map(serializeOffer),
    ]
      .filter(Boolean)
      .join("\n\n");

  try {
    for (let round = 0; round < MAX_AGENTIC_ROUNDS; round++) {
      const turnBlocks: ContentBlock[] = [];
      const pendingResults: ToolResultBlock[] = [];
      let textBuf = "";
      let stopReason: ToolStopReason = "other";
      const flushText = () => {
        if (textBuf) {
          turnBlocks.push({ type: "text", text: textBuf } as TextBlock);
          textBuf = "";
        }
      };

      for await (const event of streamChatWithTools(toolMessages, {
        systemPrompt,
        tools: LIBRARY_TOOLS,
        maxOutputTokens: 4000,
        preferredProvider,
        signal,
      })) {
        if (event.kind === "text_delta") {
          textBuf += event.text;
          prose += event.text;
          patchAssistant(compose());
        } else if (event.kind === "tool_call") {
          flushText();
          // a paragraph break between rounds so prose doesn't run together
          if (prose && !prose.endsWith("\n\n")) prose += "\n\n";
          const step: AgentStep = { op: event.name, ok: true, run: true };
          steps.push(step);
          patchAssistant(compose());
          const started = performance.now();
          const result = await dispatchLibraryTool(event.name, event.input, ctx);
          if (signal.aborted) break;
          Object.assign(step, {
            ok: result.ok,
            run: undefined,
            ms: Math.round(performance.now() - started),
            ...(result.refs?.length ? { refs: result.refs } : {}),
            ...(result.detail || !result.ok
              ? { q: result.detail ?? result.summary }
              : {}),
            ...(result.undo ? { undo: result.undo } : {}),
          });
          if (result.touchedFolderId) lastFolderId = result.touchedFolderId;
          if (result.offer) offers.push(result.offer);
          patchAssistant(compose());
          turnBlocks.push({
            type: "tool_use",
            id: event.id,
            name: event.name,
            input: event.input,
          });
          pendingResults.push({
            type: "tool_result",
            tool_use_id: event.id,
            content: result.modelOutput,
            is_error: !result.ok,
          });
        } else if (event.kind === "stop") {
          flushText();
          stopReason = event.reason;
        }
      }

      if (turnBlocks.length === 0) break;
      toolMessages.push({ role: "assistant", content: turnBlocks });
      if (stopReason !== "tool_use" || pendingResults.length === 0) break;
      toolMessages.push({ role: "user", content: pendingResults });
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    useToolApprovalStore.getState().endTurn();
  }

  // a step cut off by Stop must not spin forever in the saved message
  for (const s of steps) {
    if (s.run) {
      s.run = undefined;
      s.ok = false;
    }
  }
  return compose() || "(no response)";
}
