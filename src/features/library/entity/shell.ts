import type { LucideIcon } from "lucide-react";
import type { TFunction } from "i18next";
import { FolderInput, Trash2 } from "lucide-react";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import type { EntityDescriptor, EntityAction } from "./descriptors";

export type ToggleSelect = (
  id: string,
  event: { ctrlKey: boolean; shiftKey: boolean },
) => void;

/** Shared click handling for cards and rows: modifier-click and
 *  selection-mode click toggle selection, a plain click opens. */
export function makeSelectAwareClick(
  selKey: string,
  selectionActive: boolean,
  onToggleSelect: ToggleSelect | undefined,
  open: () => void,
) {
  return (e: React.MouseEvent) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onToggleSelect?.(selKey, {
        ctrlKey: e.ctrlKey || e.metaKey,
        shiftKey: e.shiftKey,
      });
      return;
    }
    if (selectionActive) {
      onToggleSelect?.(selKey, { ctrlKey: false, shiftKey: false });
      return;
    }
    open();
  };
}

export interface MenuAction extends EntityAction {
  danger?: boolean;
}

/** Ordered menu actions: open, [edit], move, [export], delete. The move
 *  and delete entries are injected here so every entity gets them. */
export function buildMenuActions(
  d: EntityDescriptor,
  t: TFunction,
  openMovePicker: () => void,
  openIcon: LucideIcon,
): MenuAction[] {
  const actions: MenuAction[] = [
    { id: "open", label: d.openLabel, icon: openIcon, onClick: d.open },
  ];
  if (d.editAction) actions.push(d.editAction);
  actions.push({
    id: "move",
    label: t("library.actions.moveToFolder"),
    icon: FolderInput,
    onClick: openMovePicker,
  });
  if (d.exportAction) actions.push(d.exportAction);
  actions.push({
    id: "delete",
    label: t("common.delete"),
    icon: Trash2,
    danger: true,
    onClick: d.remove,
  });
  return actions;
}

/** Right-click entries: same actions with a divider before delete. */
export function toContextEntries(actions: MenuAction[]): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [];
  for (const a of actions) {
    if (a.id === "delete") entries.push({ id: "div-1", divider: true });
    entries.push({
      id: a.id,
      label: a.label,
      icon: a.icon,
      onClick: a.onClick,
      danger: a.danger,
    });
  }
  return entries;
}
