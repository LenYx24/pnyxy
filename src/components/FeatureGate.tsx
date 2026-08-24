import type { ReactNode } from "react";
import { Navigate } from "react-router";
import type { FeatureKey } from "@/lib/features";
import { useFeature } from "@/lib/use-features";

/** Route wrapper: renders children only when the feature is enabled,
 *  otherwise redirects to the library so deep links into hidden
 *  surfaces never show a half-working page. */
export function FeatureGate({
  feature,
  children,
}: {
  feature: FeatureKey;
  children: ReactNode;
}) {
  const enabled = useFeature(feature);
  if (!enabled) return <Navigate to="/library" replace />;
  return <>{children}</>;
}
