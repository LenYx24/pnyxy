import { useEffect, useMemo } from "react";
import { useSettingsStore } from "@/stores/settings-store";
import { useAiModelConfigStore } from "@/stores/ai-model-config-store";
import { useServedModelStore } from "@/lib/ai/served-model";
import { useChatStore } from "@/stores/chat-store";
import { useChatModelStore } from "@/stores/chat-model-store";
import { getConfiguredProviders } from "@/lib/ai/ai-client";
import { selectQuotaRow } from "../quota";
import { useQuotaRows } from "./model-meta";
import { ModelPicker } from "./ModelPicker";

/**
 * Standalone model picker for use outside the composer (the mobile chat
 * header, Gemini-style). It mirrors the composer's picker wiring: the same
 * stores feed the options/label/quota, and the SELECTED provider is shared via
 * useChatModelStore, so this picker and the composer's stay in sync. The few
 * derivations here intentionally mirror ChatComposer (they read the same
 * stores, so they can't diverge at runtime); keep them aligned if the
 * composer's picker wiring changes.
 */
export function ChatModelPickerContainer({
  className,
}: {
  className?: string;
}) {
  const selectedProvider = useChatModelStore((s) => s.selectedProvider);
  const setSelectedProvider = useChatModelStore((s) => s.setSelectedProvider);

  const enabledProviders = useSettingsStore((s) => s.enabledProviders);
  const configuredProviders = useMemo(
    () => getConfiguredProviders(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enabledProviders],
  );

  const loadModelConfig = useAiModelConfigStore((s) => s.load);
  const modelConfig = useAiModelConfigStore((s) => s.config);
  useEffect(() => {
    void loadModelConfig();
  }, [loadModelConfig]);
  const visibleProviders = useMemo(
    () =>
      configuredProviders
        .filter((p) => modelConfig[p]?.enabled ?? true)
        .sort(
          (a, b) =>
            (modelConfig[a]?.sortOrder ?? 999) -
            (modelConfig[b]?.sortOrder ?? 999),
        ),
    [configuredProviders, modelConfig],
  );
  const pnyxyEnabled = modelConfig.pnyxy?.enabled ?? true;

  const isStreaming = useChatStore((s) => s.streamingMessageId !== null);
  const quotaRows = useQuotaRows(isStreaming);
  const pnyxyModel = useSettingsStore((s) => s.pnyxyModel);
  const servedModel = useServedModelStore((s) => s.model);
  const activeQuotaModel = useMemo(
    () =>
      selectQuotaRow(quotaRows, { pinnedModel: pnyxyModel, servedModel }).model,
    [quotaRows, pnyxyModel, servedModel],
  );

  return (
    <div className={className}>
      <ModelPicker
        value={selectedProvider}
        options={visibleProviders}
        onChange={setSelectedProvider}
        autoModel={activeQuotaModel}
        quotaRows={quotaRows}
        pnyxyEnabled={pnyxyEnabled}
      />
    </div>
  );
}
