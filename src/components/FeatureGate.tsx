import type { ReactNode } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { FEATURE_META, type FeatureKey } from "@/lib/features";
import { useFeature } from "@/lib/use-features";
import { useSettingsStore } from "@/stores/settings-store";

/** Route wrapper: renders children only when the feature is enabled.
 *  A deep link into a switched-off surface says so and offers to turn it
 *  back on, instead of silently landing somewhere else. */
export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const enabled = useFeature(feature);
  const setFeatureOverride = useSettingsStore((s) => s.setFeatureOverride);
  if (enabled) return <>{children}</>;
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="max-w-md text-sm text-text-secondary">
        {t("featureGate.off", { feature: FEATURE_META[feature].label })}
      </p>
      <div className="flex gap-2">
        <Button onClick={() => setFeatureOverride(feature, true)}>
          {t("featureGate.enable")}
        </Button>
        <Button variant="secondary" onClick={() => navigate("/library")}>
          {t("featureGate.toLibrary")}
        </Button>
      </div>
    </div>
  );
}
