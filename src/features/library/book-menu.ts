import type { TFunction } from "i18next";
import { MessageSquare, MoreHorizontal } from "lucide-react";
import type { ContextMenuEntry } from "@/stores/context-menu-store";
import { isDivider } from "@/stores/context-menu-store";

/**
 * Shortens a book's right-click menu: the everyday actions (`primaryIds`,
 * in that order) plus "chat about this book" stay on top, every other
 * row moves into a "More" submenu, the destructive rows stay last.
 */
export function groupBookMenu(
  items: ContextMenuEntry[],
  primaryIds: string[],
  openChat: () => void,
  t: TFunction,
): ContextMenuEntry[] {
  const rows = items.filter((e) => !isDivider(e));
  const danger = rows.filter((e) => !isDivider(e) && e.danger);
  const primary = primaryIds.flatMap((id) => rows.filter((e) => e.id === id));
  const rest = rows.filter((e) => !primary.includes(e) && !danger.includes(e));
  const chat: ContextMenuEntry = {
    id: "chat",
    label: t("library.actions.chatAboutBook"),
    icon: MessageSquare,
    onClick: openChat,
  };
  return [
    ...primary.slice(0, 1),
    chat,
    ...primary.slice(1),
    ...(rest.length
      ? [{ id: "more", label: t("library.actions.more"), icon: MoreHorizontal, onClick: () => {}, children: rest }]
      : []),
    ...(danger.length ? [{ id: "div-danger", divider: true as const }, ...danger] : []),
  ];
}
