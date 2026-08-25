import { useTranslation } from "react-i18next";
import {
  SHORTCUT_CATALOG,
  SHORTCUT_GROUP_ORDER,
  isMac,
} from "@/lib/keyboard-shortcuts";
import { Keyboard } from "lucide-react";
import { Button, Kbd } from "@/components/ui";
import { useShortcutsSheet } from "@/components/ui/shortcuts-sheet-store";
import { SettingsSection } from "../ui";

export function ShortcutsTab() {
  const { t } = useTranslation();
  const modifierNote = isMac()
    ? t("shortcuts.modifierMac")
    : t("shortcuts.modifierPc");
  const openSheet = useShortcutsSheet((s) => s.setOpen);

  return (
    <div className="space-y-8">
      <SettingsSection
        description={modifierNote}
        actions={
          <Button variant="secondary" size="sm" onClick={() => openSheet(true)}>
            <Keyboard size={14} />
            {t("shortcuts.sheet.openOverlay")}
          </Button>
        }
      />
      {SHORTCUT_GROUP_ORDER.map((group) => {
        const items = SHORTCUT_CATALOG.filter((s) => s.group === group);
        if (items.length === 0) return null;
        return (
          <SettingsSection key={group} title={t(`shortcuts.groups.${group}`)}>
            {items.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between gap-4 py-2.5"
              >
                <span className="text-[15px] text-text-primary">
                  {t(`shortcuts.items.${s.labelKey}`)}
                </span>
                <Kbd shortcut={s} variant="chips" className="shrink-0" />
              </div>
            ))}
          </SettingsSection>
        );
      })}
    </div>
  );
}
