/** Non-component picker plumbing (react-refresh wants components alone):
 *  provider labels, the display-label helper and the quota-rows hook. */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuthStore } from "@/stores/auth-store";
import { supabase } from "@/lib/supabase";
import type { AiProvider } from "@/stores/settings-store";
import { PNYXY_MODEL_OPTIONS, type PnyxyQuotaRow } from "../quota";

// keep in sync with ai-client.ts / ai-chat-proxy
export const PROVIDER_INFO: Record<
  AiProvider,
  { model: string; routing: string }
> = {
  pnyxy: { model: "Claude Haiku 4.5", routing: "Pnyxy free quota" },
  anthropic: { model: "Claude Sonnet 4.5", routing: "Your Anthropic key" },
  openai: { model: "GPT-4o mini", routing: "Your OpenAI key" },
  local: { model: "Local model", routing: "Ollama / LM Studio" },
};

/** Short display label for the model the next turn will use. */
export function modelDisplayLabel(
  provider: AiProvider | null,
  pnyxyModel: string | null,
  autoModel: string,
): string {
  if (provider) return PROVIDER_INFO[provider].model;
  const pinned = pnyxyModel
    ? PNYXY_MODEL_OPTIONS.find((m) => m.id === pnyxyModel)
    : null;
  if (pinned) return pinned.label;
  return PNYXY_MODEL_OPTIONS.find((m) => m.id === autoModel)?.label ?? autoModel;
}

/** Today's free-tier usage rows. Signed-in only (anon uses an IP bucket we can't read). */
export function useQuotaRows(isStreaming: boolean) {
  const user = useAuthStore((s) => s.user);
  const [rows, setRows] = useState<PnyxyQuotaRow[]>([]);
  const refresh = useCallback(() => {
    if (!user) return;
    void supabase.rpc("get_my_ai_usage_today").then(({ data, error }) => {
      if (!error && Array.isArray(data)) setRows(data as PnyxyQuotaRow[]);
    });
  }, [user]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // refetch when the tab comes back: the buckets reset at UTC midnight and
  // another tab / device may have spent quota meanwhile
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);
  // refetch when streaming ends so the line reflects the last turn
  const prevStreaming = useRef(isStreaming);
  useEffect(() => {
    if (prevStreaming.current && !isStreaming) refresh();
    prevStreaming.current = isStreaming;
  }, [isStreaming, refresh]);
  return rows;
}
