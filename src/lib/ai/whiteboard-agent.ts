/**
 * Whiteboard tool-calling loop: the same shape as the library and roadmap
 * agents (stream with tools, dispatch each call, feed results back until the
 * model stops or the round cap is hit), with one addition. The first user
 * turn carries a snapshot of the board, so the model works from what the
 * user actually drew rather than from a list of coordinates.
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
  WHITEBOARD_TOOLS,
  buildWhiteboardSystemPrompt,
  dispatchWhiteboardTool,
} from "@/lib/ai/whiteboard-tools";
import {
  boardViewportSize,
  captureBoardImage,
} from "@/features/whiteboard/board-capture";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import type { AiProvider } from "@/stores/settings-store";

const MAX_AGENTIC_ROUNDS = 6;

export async function runWhiteboardAgenticLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
  extraContext?: string,
): Promise<string> {
  const viewport = boardViewportSize() ?? undefined;
  const systemPrompt =
    buildWhiteboardSystemPrompt(viewport) +
    (extraContext ? `\n\n${extraContext}` : "");

  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Attach the board to the latest user turn. Only the newest one: older
  // snapshots are stale by now and would just cost tokens.
  const snapshot = captureBoardImage();
  const last = toolMessages[toolMessages.length - 1];
  if (snapshot && last && last.role === "user") {
    const text = typeof last.content === "string" ? last.content : "";
    last.content = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: snapshot.media_type,
          data: snapshot.data,
        },
      },
      { type: "text", text: text || "(see the board)" },
    ];
  }

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
        tools: WHITEBOARD_TOOLS,
        maxOutputTokens: 4000,
        preferredProvider,
        signal,
      })) {
        if (event.kind === "text_delta") {
          textBuf += event.text;
          acc += event.text;
          patchAssistant(acc);
        } else if (event.kind === "tool_call") {
          flushText();
          const result = await dispatchWhiteboardTool(event.name, event.input);
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
