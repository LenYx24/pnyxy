import { useTranslation } from "react-i18next";
import {
  OrgMonogramTile,
  OrgSwitcherPopover,
} from "@/components/layout/OrgSwitcher";
import { useCurrentOrg } from "@/components/layout/org-utils";

/**
 * Root crumb of the library breadcrumb: a quiet button carrying the
 * active workspace monogram + name ("Personal" or the org name) that
 * opens the shared OrgSwitcherPopover anchored to itself. Styled as a
 * plain crumb (no dropdown caret, the tile is the affordance) so it
 * reads as part of the trail. The popover injects ref / onClick / aria
 * props into the trigger button.
 */
export function LibraryOrgCrumb() {
  const { t } = useTranslation();
  const current = useCurrentOrg();
  const label = current?.name ?? t("library.list.breadcrumb.root");

  return (
    <OrgSwitcherPopover
      placement="bottom-start"
      trigger={
        <button
          type="button"
          title={t("sidebar.orgSwitcher.title")}
          className="flex max-w-[12rem] shrink-0 cursor-pointer items-center gap-1.5 rounded-control px-1.5 py-0.5 text-text-muted-2 transition-colors hover:bg-surface-3/60 hover:text-text-primary aria-expanded:bg-surface-3/60 aria-expanded:text-text-primary"
        >
          <OrgMonogramTile name={label} className="h-5 w-5" />
          <span className="hidden truncate sm:inline">{label}</span>
        </button>
      }
    />
  );
}
