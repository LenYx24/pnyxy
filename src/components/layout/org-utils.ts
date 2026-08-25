import { useOrgStore } from "@/stores/org-store";

/** Two-letter monogram from an org name: "Personal" -> "PE",
 *  "BME VIK" -> "BV". */
export function orgMonogram(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The active org (falls back to the first one), null while loading. */
export function useCurrentOrg() {
  const organizations = useOrgStore((s) => s.organizations);
  const currentOrgId = useOrgStore((s) => s.currentOrgId);
  if (organizations.length === 0) return null;
  return organizations.find((o) => o.id === currentOrgId) ?? organizations[0];
}
