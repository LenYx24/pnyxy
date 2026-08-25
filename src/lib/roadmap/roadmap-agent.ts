/**
 * Roadmap tool-calling agent used by chat. Runs streamChatWithTools and
 * dispatches each tool_call live against useRoadmapStore. On a "tool_use" stop
 * it appends the tool_use blocks + results and calls again, until end_turn or
 * the safety cap. Visible content interleaves model text with one blockquote
 * line per tool call.
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
  ROADMAP_TOOLS,
  LabelMap,
  formatRoadmapSnapshot,
  buildRoadmapEditSystemPrompt,
  buildRoadmapGenerateSystemPrompt,
  dispatchRoadmapTool,
} from "@/lib/roadmap/roadmap-tools";
import { useRoadmapStore } from "@/stores/roadmap-store";
import type { AiProvider } from "@/stores/settings-store";

export type RoadmapChatHistory = Array<{
  role: "user" | "assistant";
  content: string;
}>;

const MAX_AGENTIC_ROUNDS = 8;

/** Edit an existing roadmap: the model sees a labelled snapshot and edits it via tools. */
export async function runRoadmapAgenticLoop(
  roadmapId: string,
  history: RoadmapChatHistory,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const roadmap = useRoadmapStore.getState().roadmaps.get(roadmapId);
  if (!roadmap) {
    return `⚠ Roadmap not found.`;
  }
  // rebuilt from live state so the model sees stable n1..nN labels; add_node extends it in-place
  const labels = new LabelMap(roadmap.nodes);
  const snapshot = formatRoadmapSnapshot(roadmap, labels);
  const systemPrompt = buildRoadmapEditSystemPrompt(snapshot);
  return runRoadmapToolLoop(
    roadmapId,
    labels,
    systemPrompt,
    history,
    preferredProvider,
    patchAssistant,
    signal,
  );
}

/**
 * "generate a roadmap" skill: create an empty roadmap, populate it via the tool loop, and
 * append an inline link. If nothing gets added, the empty shell is rolled back.
 */
export async function runRoadmapGenerateLoop(
  history: RoadmapChatHistory,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const store = useRoadmapStore.getState();
  // empty title; the model sets a real one via update_roadmap_meta
  const roadmap = store.createRoadmap("");
  const labels = new LabelMap(roadmap.nodes);
  const systemPrompt = buildRoadmapGenerateSystemPrompt();

  const body = await runRoadmapToolLoop(
    roadmap.id,
    labels,
    systemPrompt,
    history,
    preferredProvider,
    patchAssistant,
    signal,
  );

  const built = useRoadmapStore.getState().roadmaps.get(roadmap.id);
  if (!built || built.nodes.length === 0) {
    // nothing was built, drop the empty shell and return prose
    store.deleteRoadmap(roadmap.id);
    return body;
  }
  // relative-link clicks in the message body are routed through the SPA router
  return `${body}\n\n**[Open the generated roadmap →](/roadmaps/${roadmap.id}/edit)**`;
}

/** Shared tool loop for editing and generating; callers pass the seed roadmap, labels, prompt. */
async function runRoadmapToolLoop(
  roadmapId: string,
  labels: LabelMap,
  systemPrompt: string,
  history: RoadmapChatHistory,
  preferredProvider: AiProvider | undefined,
  patchAssistant: (content: string) => void,
  signal: AbortSignal,
): Promise<string> {
  const toolMessages: ToolMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let acc = "";
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
      tools: ROADMAP_TOOLS,
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
        const result = dispatchRoadmapTool(
          event.name,
          event.input,
          roadmapId,
          labels,
        );
        // markdown blockquote so the tool-call line renders offset from the model's prose
        acc += (acc.endsWith("\n\n") || acc === "" ? "" : "\n\n") +
          `> ${result.summary}\n`;
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

    if (turnBlocks.length === 0) {
      // model returned nothing parseable; the API rejects empty assistant messages
      break;
    }
    toolMessages.push({ role: "assistant", content: turnBlocks });

    if (stopReason !== "tool_use" || pendingResults.length === 0) break;

    toolMessages.push({ role: "user", content: pendingResults });
    // separator so the next round's text starts on its own line
    if (!acc.endsWith("\n")) acc += "\n";
  }

  return acc.trim() || "(no response)";
}
