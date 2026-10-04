import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings } from "lucide-react";
import { FormModal } from "@/components/ui/FormModal";
import { Button } from "@/components/ui/Button";
import { OptionChips } from "@/features/settings/ui";

// the same tab components the /settings route renders, loaded on first open
const AppearanceTab = lazy(() =>
  import("@/features/settings/tabs/AppearanceTab").then((m) => ({
    default: m.AppearanceTab,
  })),
);
const AiTab = lazy(() =>
  import("@/features/settings/tabs/AiTab").then((m) => ({ default: m.AiTab })),
);
const GeneralTab = lazy(() =>
  import("@/features/settings/tabs/GeneralTab").then((m) => ({
    default: m.GeneralTab,
  })),
);

type Tab = "appearance" | "ai" | "general";

/** Settings without leaving the book: a floating window over the reader. */
export function ReaderSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("ai");

  return (
    <FormModal
      open={open}
      onClose={onClose}
      title={t("reader.settingsModal.title")}
      icon={Settings}
      size="lg"
      resizeStorageKey="pnyxy-reader-settings-modal"
      footer={
        <Button variant="secondary" type="button" onClick={onClose}>
          {t("common.close")}
        </Button>
      }
    >
      <OptionChips<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { value: "ai", label: t("settings.ai") },
          { value: "appearance", label: t("settings.appearance") },
          { value: "general", label: t("settings.general") },
        ]}
      />
      <Suspense
        fallback={<p className="py-6 text-sm text-text-muted">{t("common.loading")}</p>}
      >
        <div className="space-y-6">
          {tab === "ai" && <AiTab />}
          {tab === "appearance" && <AppearanceTab />}
          {tab === "general" && <GeneralTab />}
        </div>
      </Suspense>
    </FormModal>
  );
}
