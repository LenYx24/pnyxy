// Library tools for the chat's "Organize library" mode: the model sees a
// snapshot of the folder tree (paths + what lives in each) and can look
// things up or, with the user's per-action approval, create folders, move
// items and start conversations. Runs entirely client-side against the
// stores; see library-agent.ts for the loop.

import type { ToolDef } from "@/lib/roadmap/roadmap-tools";
import { useLibraryStore } from "@/stores/library-store";
import { useChatStore } from "@/stores/chat-store";
import { useNoteStore } from "@/stores/note-store";
import { useResourceStore } from "@/stores/resource-store";
import { useToolApprovalStore } from "@/stores/tool-approval-store";
import type { Folder } from "@/types/database";

export type LibraryItemKind = "book" | "chat" | "note" | "resource" | "folder";

const SEP = "/";
/** Snapshot budget so a big library doesn't eat the whole prompt. */
const MAX_SNAPSHOT_ITEMS_PER_FOLDER = 12;
const MAX_SNAPSHOT_CHARS = 12_000;

export const LIBRARY_TOOLS: ToolDef[] = [
  {
    name: "search_library",
    description:
      "Search the user's library by name (case-insensitive substring) across folders, books, chats, notes and saved links. Use it when the snapshot in the system prompt was truncated or you need an item's id.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to look for in names/titles." },
      },
      required: ["query"],
    },
  },
  {
    name: "create_folder",
    description:
      "Create a folder at a slash-separated path (missing ancestors are created too, existing ones reused), e.g. \"History/WW2\". Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path from the library root, segments separated by /." },
      },
      required: ["path"],
    },
  },
  {
    name: "move_item",
    description:
      "Move a book, chat, note, saved link or folder into a folder (empty path = library root). Use ids from the snapshot or search_library. Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["book", "chat", "note", "resource", "folder"] },
        id: { type: "string" },
        path: { type: "string", description: "Destination folder path; \"\" for the root." },
      },
      required: ["kind", "id", "path"],
    },
  },
  {
    name: "create_chat",
    description:
      "Start a new (empty) conversation in a folder so the user has a place to study a topic. Returns its id. Asks the user for approval first.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path; \"\" for the root." },
        title: { type: "string", description: "Short conversation title." },
      },
      required: ["path", "title"],
    },
  },
];

export interface ToolOutcome {
  ok: boolean;
  /** One line for the visible transcript (blockquote). */
  summary: string;
  /** What the model gets back as the tool result. */
  modelOutput: string;
}

// ── folder path helpers ────────────────────────────────────────

function folderPaths(folders: Folder[]): Map<string, string> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const cache = new Map<string, string>();
  const pathOf = (f: Folder, depth = 0): string => {
    const hit = cache.get(f.id);
    if (hit !== undefined) return hit;
    const parent = f.parent_id && depth < 64 ? byId.get(f.parent_id) : undefined;
    const p = parent ? `${pathOf(parent, depth + 1)}${SEP}${f.name}` : f.name;
    cache.set(f.id, p);
    return p;
  };
  for (const f of folders) pathOf(f);
  return cache;
}

function normalizePath(raw: string): string {
  return raw
    .split(SEP)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(SEP);
}

/** Folder id for a path, null for the root, undefined when missing. */
function resolvePath(folders: Folder[], raw: string): string | null | undefined {
  const norm = normalizePath(raw).toLowerCase();
  if (!norm) return null;
  const paths = folderPaths(folders);
  for (const [id, p] of paths) {
    if (p.toLowerCase() === norm) return id;
  }
  return undefined;
}

// ── snapshot ───────────────────────────────────────────────────

interface SnapshotItem {
  kind: LibraryItemKind;
  id: string;
  title: string;
  folderId: string | null;
}

function collectItems(): SnapshotItem[] {
  const lib = useLibraryStore.getState();
  const chat = useChatStore.getState();
  const notes = useNoteStore.getState().notes;
  const resources = useResourceStore.getState().resources;
  const items: SnapshotItem[] = [];
  for (const b of lib.books) {
    items.push({
      kind: "book",
      id: b.id,
      title: b.source === "uploaded" ? b.book.title : b.catalog_book.title,
      folderId: b.folder_id,
    });
  }
  for (const c of chat.conversations) {
    // temporary chats are kept like normal quick chats now, so only
    // archived ones are hidden from the AI's library snapshot
    if (c.archived_at) continue;
    items.push({ kind: "chat", id: c.id, title: c.title || "(untitled chat)", folderId: c.folder_id });
  }
  for (const n of notes) {
    items.push({ kind: "note", id: n.id, title: n.title || "(untitled note)", folderId: n.folderId });
  }
  for (const r of resources) {
    items.push({ kind: "resource", id: r.id, title: r.title || r.url, folderId: r.folder_id });
  }
  return items;
}

/** Text tree of the library for the system prompt: every folder path with
 *  the first N items inside, then the root's items. Ids are included so
 *  the model can reference them in move_item without a search round. */
export function formatLibrarySnapshot(): string {
  const folders = useLibraryStore.getState().folders;
  const paths = folderPaths(folders);
  const items = collectItems();
  const byFolder = new Map<string | null, SnapshotItem[]>();
  for (const it of items) {
    const list = byFolder.get(it.folderId) ?? [];
    list.push(it);
    byFolder.set(it.folderId, list);
  }
  const renderItems = (list: SnapshotItem[] | undefined, indent: string) => {
    if (!list || list.length === 0) return "";
    const shown = list.slice(0, MAX_SNAPSHOT_ITEMS_PER_FOLDER);
    let out = shown
      .map((it) => `${indent}- [${it.kind}] ${it.title} (id: ${it.id})`)
      .join("\n");
    if (list.length > shown.length) {
      out += `\n${indent}- … ${list.length - shown.length} more (use search_library)`;
    }
    return out + "\n";
  };

  let out = "";
  const sortedFolders = [...folders].sort((a, b) =>
    (paths.get(a.id) ?? "").localeCompare(paths.get(b.id) ?? ""),
  );
  if (sortedFolders.length === 0) out += "(no folders yet)\n";
  for (const f of sortedFolders) {
    out += `📁 ${paths.get(f.id)}  (folder id: ${f.id})\n`;
    out += renderItems(byFolder.get(f.id), "   ");
  }
  const rootItems = byFolder.get(null);
  if (rootItems && rootItems.length > 0) {
    out += `📁 (root)\n` + renderItems(rootItems, "   ");
  }
  if (out.length > MAX_SNAPSHOT_CHARS) {
    out = out.slice(0, MAX_SNAPSHOT_CHARS) + "\n… (snapshot truncated; use search_library)\n";
  }
  return out;
}

// ── dispatch ───────────────────────────────────────────────────

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export async function dispatchLibraryTool(
  name: string,
  rawInput: unknown,
): Promise<ToolOutcome> {
  const input = (rawInput ?? {}) as Record<string, unknown>;
  const lib = useLibraryStore.getState();
  const approval = useToolApprovalStore.getState();

  try {
    switch (name) {
      case "search_library": {
        const q = asString(input.query).trim().toLowerCase();
        if (!q) return { ok: false, summary: "search_library: empty query", modelOutput: "Error: query is required." };
        const paths = folderPaths(lib.folders);
        const folderHits = lib.folders
          .filter((f) => f.name.toLowerCase().includes(q))
          .slice(0, 20)
          .map((f) => `[folder] ${paths.get(f.id)} (id: ${f.id})`);
        const itemHits = collectItems()
          .filter((it) => it.title.toLowerCase().includes(q))
          .slice(0, 30)
          .map(
            (it) =>
              `[${it.kind}] ${it.title} (id: ${it.id}, in: ${it.folderId ? paths.get(it.folderId) ?? "?" : "root"})`,
          );
        const lines = [...folderHits, ...itemHits];
        return {
          ok: true,
          summary: `Searched the library for "${q}" (${lines.length} hits)`,
          modelOutput: lines.length ? lines.join("\n") : "No matches.",
        };
      }

      case "create_folder": {
        const path = normalizePath(asString(input.path));
        if (!path) return { ok: false, summary: "create_folder: empty path", modelOutput: "Error: path is required." };
        const existing = resolvePath(lib.folders, path);
        if (existing) {
          return { ok: true, summary: `Folder "${path}" already exists`, modelOutput: `Folder already exists (id: ${existing}).` };
        }
        const ok = await approval.request({ tool: name, summary: `Create folder "${path}"` });
        if (!ok) return { ok: false, summary: `Skipped creating "${path}"`, modelOutput: "The user declined this action. Do not retry it; continue without it." };
        const created = await lib.createFolderPath(path, null);
        if (!created) throw new Error("createFolderPath returned null");
        return { ok: true, summary: `Created folder "${path}"`, modelOutput: `Created folder "${path}" (id: ${created.id}).` };
      }

      case "move_item": {
        const kind = asString(input.kind) as LibraryItemKind;
        const id = asString(input.id);
        const path = normalizePath(asString(input.path));
        if (!id || !kind) return { ok: false, summary: "move_item: missing id/kind", modelOutput: "Error: kind and id are required." };
        const target = resolvePath(lib.folders, path);
        if (target === undefined) {
          return { ok: false, summary: `move_item: no folder "${path}"`, modelOutput: `Error: folder "${path}" does not exist. Create it first with create_folder.` };
        }
        const item = kind === "folder"
          ? (() => { const f = lib.folders.find((x) => x.id === id); return f ? { title: f.name } : null; })()
          : collectItems().find((it) => it.kind === kind && it.id === id) ?? null;
        if (!item) return { ok: false, summary: `move_item: ${kind} ${id} not found`, modelOutput: `Error: no ${kind} with id ${id}.` };
        const dest = path || "the library root";
        const ok = await approval.request({ tool: name, summary: `Move ${kind} "${item.title}" → ${dest}` });
        if (!ok) return { ok: false, summary: `Skipped moving "${item.title}"`, modelOutput: "The user declined this action. Do not retry it; continue without it." };
        switch (kind) {
          case "book": {
            const entry = lib.books.find((b) => b.id === id);
            if (!entry) throw new Error("book vanished");
            await lib.moveBookToFolder(entry, target);
            break;
          }
          case "chat":
            await useChatStore.getState().moveConversationToFolder(id, target);
            break;
          case "note":
            useNoteStore.getState().moveNoteToFolder(id, target);
            break;
          case "resource":
            await useResourceStore.getState().moveResourceToFolder(id, target);
            break;
          case "folder":
            await lib.moveFolderToFolder(id, target);
            break;
          default:
            return { ok: false, summary: `move_item: unknown kind ${kind}`, modelOutput: `Error: unknown kind "${kind}".` };
        }
        return { ok: true, summary: `Moved ${kind} "${item.title}" → ${dest}`, modelOutput: `Moved ${kind} "${item.title}" to ${dest}.` };
      }

      case "create_chat": {
        const path = normalizePath(asString(input.path));
        const title = asString(input.title).trim().slice(0, 80);
        const target = resolvePath(lib.folders, path);
        if (target === undefined) {
          return { ok: false, summary: `create_chat: no folder "${path}"`, modelOutput: `Error: folder "${path}" does not exist. Create it first with create_folder.` };
        }
        const dest = path || "the library root";
        const ok = await approval.request({ tool: name, summary: `Start chat "${title || "(untitled)"}" in ${dest}` });
        if (!ok) return { ok: false, summary: `Skipped creating chat "${title}"`, modelOutput: "The user declined this action. Do not retry it; continue without it." };
        const chat = useChatStore.getState();
        // keep the conversation the user is talking in active; a new chat is
        // created in the background via a direct insert-like path
        const currentActive = chat.activeConversationId;
        const newId = await chat.createConversation(title, target ?? null, null);
        if (currentActive && newId && newId !== currentActive) {
          await chat.openConversation(currentActive);
        }
        if (!newId) throw new Error("createConversation returned null");
        return {
          ok: true,
          summary: `Started chat "${title}" in ${dest}`,
          modelOutput: `Created conversation "${title}" (id: ${newId}) in ${dest}. Link it for the user as [${title}](/chat/${newId}).`,
        };
      }

      default:
        return { ok: false, summary: `Unknown tool ${name}`, modelOutput: `Error: unknown tool "${name}".` };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, summary: `${name} failed: ${msg}`, modelOutput: `Error: ${msg}` };
  }
}

export function buildLibraryAgentSystemPrompt(): string {
  return `You are Pnyxy's study assistant in "Organize library" mode. Pnyxy is a learning app: the user's library holds folders with books (PDFs/EPUBs), chats (AI conversations), notes and saved links (web pages / YouTube videos). Folders nest via slash paths like "History/WW2".

Your job: help the student set up and keep a sensible structure for what they want to learn, and act on it with the tools when they ask (create folders, move things, start a chat for a topic). Typical request: "I want to learn about X" → propose a small folder structure (2–5 folders, not a taxonomy of everything), then create it and start a chat in the right folder, so the student can begin immediately.

Rules:
- Every write tool asks the user to approve; if they decline, don't retry, adapt.
- Prefer reusing existing folders over creating near-duplicates; check the snapshot first.
- Keep names short and in the user's language. Reply in the user's language (Hungarian if they write Hungarian).
- After acting, summarize what changed in 2–4 lines and link chats you created as [title](/chat/<id>).
- Don't move things the user didn't mention unless you asked and they agreed.

Current library snapshot (paths, items and ids):
${formatLibrarySnapshot()}`;
}
