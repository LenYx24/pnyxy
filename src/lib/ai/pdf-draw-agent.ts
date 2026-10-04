/**
 * Reader draw-mode tool loop: the whiteboard agent's shape (stream with tools,
 * dispatch each call, feed results back until the model stops or the round
 * cap is hit) pointed at the PDF page instead of a board. The latest user turn
 * carries the current page with the user's inline drawings, so the model
 * answers about what the user marked and can mark the page back.
 */
import {
  extractPdfText,
  streamChatWithTools,
  type ContentBlock,
  type TextBlock,
  type ToolMessage,
  type ToolResultBlock,
  type ToolStopReason,
} from "@/lib/ai/ai-client";
import {
  PDF_DRAW_TOOLS,
  buildPdfDrawSystemPrompt,
  dispatchPdfDrawTool,
  type PdfDrawTarget,
} from "@/lib/ai/pdf-draw-tools";
import { capturePdfPageWithDrawings } from "@/features/reader/page-capture";
import { useInlineDrawStore } from "@/stores/inline-draw-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import { logError } from "@/lib/logger";
import type { AiProvider } from "@/stores/settings-store";

const MAX_AGENTIC_ROUNDS = 6;
/** The image already shows the page; the text is only there so the model can
 *  quote exactly, so a long page is cut rather than paid for in full. */
const MAX_PAGE_TEXT_CHARS = 6000;

export interface PdfDrawLoopTarget extends PdfDrawTarget {
  fileUrl: string;
}

async function currentPageText(fileUrl: string, page: number): Promise<string> {
  try {
    const text = (await extractPdfText(fileUrl, page, page)).trim();
    if (!text) return "";
    return text.length > MAX_PAGE_TEXT_CHARS
      ? `${text.slice(0, MAX_PAGE_TEXT_CHARS)}\n[page text truncated]`
      : text;
  } catch (err) {
    logError("pdfDraw:pageText", err);
    return "";
  }
}

export async function runPdfDrawAgenticLoop(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  target: PdfDrawLoopTarget,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
  extraContext?: string,
): Promise<string> {
  const elements = useInlineDrawStore.getState().elementsForPage(target.page);
  const [snapshot, pageText] = await Promise.all([
    capturePdfPageWithDrawings(target.fileUrl, target.page, elements).catch((err) => {
      logError("pdfDraw:capture", err);
      return null;
    }),
    currentPageText(target.fileUrl, target.page),
  ]);

  const contextParts = [
    pageText ? `[Text of page ${target.page}, extracted from the PDF]\n${pageText}` : "",
    extraContext ?? "",
  ].filter(Boolean);
  const systemPrompt = buildPdfDrawSystemPrompt(
    target,
    contextParts.length > 0 ? contextParts.join("\n\n") : undefined,
  );

  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // Only the newest user turn gets the page: older captures are stale by now
  // and would just cost tokens.
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
      { type: "text", text: text || "(see the page)" },
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
        tools: PDF_DRAW_TOOLS,
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
          const result = await dispatchPdfDrawTool(event.name, event.input, target);
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
