/**
 * Library tool-calling loop for the chat's "Organize library" mode. Same
 * shape as the roadmap agent: stream with tools, dispatch each tool_call
 * (write tools await the user's approval card), feed results back until
 * the model stops or the round cap is reached. Visible content interleaves
 * model text with one blockquote line per tool call.
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
  LIBRARY_TOOLS,
  buildLibraryAgentSystemPrompt,
  dispatchLibraryTool,
} from "@/lib/ai/library-tools";
import { useLibraryStore } from "@/stores/library-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import type { AiProvider } from "@/stores/settings-store";

const MAX_AGENTIC_ROUNDS = 8;

export async function runLibraryAgenticLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
  extraContext?: string,
): Promise<string> {
  // the snapshot needs folders + books; cheap no-op when already fresh
  const lib = useLibraryStore.getState();
  await Promise.all([lib.fetchFolders(), lib.fetchLibrary()]).catch(() => {});
  const systemPrompt =
    buildLibraryAgentSystemPrompt() + (extraContext ? `\n\n${extraContext}` : "");

  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const approval = useToolApprovalStore.getState();
  // Stop button: reject whatever card is open so the loop unwinds
  const onAbort = () => approval.endTurn();
  signal.addEventListener("abort", onAbort, { once: true });

  let acc = "";
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
        maxOutputTokens: 3000,
        preferredProvider,
        signal,
      })) {
        if (event.kind === "text_delta") {
          textBuf += event.text;
          acc += event.text;
          patchAssistant(acc);
        } else if (event.kind === "tool_call") {
          flushText();
          const result = await dispatchLibraryTool(event.name, event.input);
          if (signal.aborted) break;
          acc +=
            (acc.endsWith("\n\n") || acc === "" ? "" : "\n\n") +
            `> ${result.ok ? "✓" : "✕"} ${result.summary}\n`;
          patchAssistant(acc);
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
      if (!acc.endsWith("\n")) acc += "\n";
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    useToolApprovalStore.getState().endTurn();
  }

  return acc.trim() || "(no response)";
}
