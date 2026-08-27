import type { ChatConversation, ChatFolder } from "@/types/chat";

/** Section caption: 11 px uppercase, muted-2 (date groups and folder names). */
export const captionClass =
  "text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2";

export type DateGroupKey = "today" | "week" | "earlier";

/**
 * Buckets conversations by `updated_at` into Today / This week / Earlier,
 * newest first inside each bucket. Empty buckets are dropped so captions
 * never sit above nothing.
 */
export function groupConversationsByDate(
  conversations: ChatConversation[],
  now: Date = new Date(),
): { key: DateGroupKey; items: ChatConversation[] }[] {
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const weekAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;
  const buckets: Record<DateGroupKey, ChatConversation[]> = {
    today: [],
    week: [],
    earlier: [],
  };
  for (const c of conversations) {
    const ts = Date.parse(c.updated_at || c.created_at);
    if (Number.isNaN(ts) || ts < weekAgo) buckets.earlier.push(c);
    else if (ts >= startOfToday) buckets.today.push(c);
    else buckets.week.push(c);
  }
  const byNewest = (a: ChatConversation, b: ChatConversation) =>
    Date.parse(b.updated_at || b.created_at) -
    Date.parse(a.updated_at || a.created_at);
  return (["today", "week", "earlier"] as const)
    .map((key) => ({ key, items: buckets[key].sort(byNewest) }))
    .filter((g) => g.items.length > 0);
}

export function dateGroupLabel(
  key: DateGroupKey,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (key === "today") return t("chat.sidebar.groupToday");
  if (key === "week") return t("chat.sidebar.groupWeek");
  return t("chat.sidebar.groupEarlier");
}

type Translate = (key: string, opts?: Record<string, unknown>) => string;

/**
 * The auto-created "Quick chats" folder (chat-store `ensureQuickChatsFolder`)
 * is a storage detail: loose chats are filed there so they do not pile up at
 * the library root. The sidebar never draws it as a folder. The name is
 * matched against the i18n value plus the historical English default, so a
 * folder created under another UI language is still recognised.
 */
export function isQuickChatsFolder(folder: ChatFolder, t: Translate): boolean {
  const name = folder.name.trim().toLowerCase();
  if (name === "quick chats" || name === "gyors chatek") return true;
  const localized = t("chat.sidebar.quickChats").trim().toLowerCase();
  return name === localized;
}

/**
 * Maps every quick-chats folder id to the parent it lives under, so chats
 * inside count as loose chats of that parent (root for the usual case).
 */
export function quickChatsParentById(
  folders: ChatFolder[],
  t: Translate,
): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const f of folders) {
    if (isQuickChatsFolder(f, t)) m.set(f.id, f.parent_id);
  }
  return m;
}

/** Folder id -> folder name, for the quick view's subtitle. Quick-chats
 *  folders are omitted (their chats are loose, no subtitle). */
export function folderNameById(
  folders: ChatFolder[],
  t: Translate,
): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of folders) {
    if (!isQuickChatsFolder(f, t)) m.set(f.id, f.name);
  }
  return m;
}
