// Tools for the chat's assistant mode: the model sees a snapshot of the
// folder tree (paths + what lives in each) and can look things up, create
// folders, notes and chats, move items, search the web and offer a
// whiteboard card. Creating things and filing the current chat run
// directly (each step can be undone from the activity log); moving the
// user's existing items still asks for approval. Runs entirely
// client-side against the stores; see library-agent.ts for the loop.

import type { ToolDef } from "@/lib/roadmap/roadmap-tools";
import type { AgentOffer, AgentRef, AgentUndo } from "@/lib/ai/agent-blocks";
import { streamChatResponse } from "@/lib/ai/ai-client";
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

// Intent detection so the library-organize skill works in a plain chat (no need
// to switch the composer to "Organize library"). Require BOTH a folder/library
// noun AND an organize/create/move verb, mirroring detectRoadmapIntent, so
// ordinary chat isn't hijacked. Short stems cover HU conjugations + English.
// A false positive is not destructive: every write still needs the user's
// per-action approval (see dispatchLibraryTool), so a wrong guess just shows an
// approval card the user can reject.
const LIBRARY_NOUN_RE = /(mapp(á|a)|folder|könyvtár|könyvtar|library)/i;
const LIBRARY_VERB_RE =
  /(rendez|szervez|organi[sz]e|tidy|hozz\s*l[ée]tre|creat|k[ée]sz[íi]t|mozgat|mozgasd|tedd|helyezd|pakol|sort\b|categor|csoportos)/i;

/** True when a plain-chat message reads as "organize my library / make a folder and move things there". */
export function detectLibraryOrganizeIntent(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return LIBRARY_NOUN_RE.test(lower) && LIBRARY_VERB_RE.test(lower);
}

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
    name: "create_note",
    description:
      "Create a note in a folder with Markdown content, e.g. a summary of what you found or a starter plan. Returns its id.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path; \"\" for the root." },
        title: { type: "string", description: "Short note title." },
        markdown: { type: "string", description: "The note body in Markdown." },
      },
      required: ["path", "title", "markdown"],
    },
  },
  {
    name: "web_search",
    description:
      "Search the web and get a short factual summary back. Use it when setting up something you don't know well (a game, a course, a tool) so notes and advice are accurate.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look up." },
      },
      required: ["query"],
    },
  },
  {
    name: "offer_whiteboard",
    description:
      "Show the user a card to create a whiteboard (drawing board) in a folder; they confirm the name with Enter. Use it when drawing would help (diagrams, production chains, mind maps) or when they ask for a board.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Folder path; \"\" for the root." },
        title: { type: "string", description: "Suggested board name." },
      },
      required: ["path", "title"],
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
  /** One line for logs and the approval card. */
  summary: string;
  /** What the model gets back as the tool result. */
  modelOutput: string;
  /** Path chips for the activity log. */
  refs?: AgentRef[];
  /** Detail shown next to the step (search query, error). */
  detail?: string;
  undo?: AgentUndo;
  /** Folder whose contents changed, shown as a mini library. */
  touchedFolderId?: string | null;
  offer?: AgentOffer;
}

/** Per-turn state the dispatcher needs. */
export interface ToolContext {
  /** The conversation the user is talking in; filing it needs no approval. */
  conversationId?: string | null;
  /** Ids created during this turn; moving them needs no approval. */
  createdIds: Set<string>;
  signal?: AbortSignal;
}

const pathLabel = (path: string) => path.split(SEP).join(" / ");

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
  ctx: ToolContext = { createdIds: new Set() },
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
        const refs: AgentRef[] = lib.folders
          .filter((f) => f.name.toLowerCase().includes(q))
          .slice(0, 3)
          .map((f) => ({ k: "folder", id: f.id, label: pathLabel(paths.get(f.id) ?? f.name) }));
        return {
          ok: true,
          summary: `Searched the library for "${q}" (${lines.length} hits)`,
          modelOutput: lines.length ? lines.join("\n") : "No matches.",
          detail: q,
          refs,
        };
      }

      case "create_folder": {
        const path = normalizePath(asString(input.path));
        if (!path) return { ok: false, summary: "create_folder: empty path", modelOutput: "Error: path is required." };
        const existing = resolvePath(lib.folders, path);
        if (existing) {
          return {
            ok: true,
            summary: `Folder "${path}" already exists`,
            modelOutput: `Folder already exists (id: ${existing}).`,
            refs: [{ k: "folder", id: existing, label: pathLabel(path) }],
          };
        }
        const created = await lib.createFolderPath(path, null);
        if (!created) throw new Error("createFolderPath returned null");
        ctx.createdIds.add(created.id);
        // the chat sidebar keeps its own copy of the shared folders table
        void useChatStore.getState().fetchFolders();
        return {
          ok: true,
          summary: `Created folder "${path}"`,
          modelOutput: `Created folder "${path}" (id: ${created.id}).`,
          refs: [{ k: "folder", id: created.id, label: pathLabel(path) }],
          undo: { op: "delete_folder", id: created.id },
          touchedFolderId: created.id,
        };
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
          ? (() => { const f = lib.folders.find((x) => x.id === id); return f ? { title: f.name, folderId: f.parent_id } : null; })()
          : collectItems().find((it) => it.kind === kind && it.id === id) ?? null;
        if (!item) return { ok: false, summary: `move_item: ${kind} ${id} not found`, modelOutput: `Error: no ${kind} with id ${id}.` };
        const dest = path || "the library root";
        // filing this chat or something made this turn is what the user
        // asked for; moving their existing material still needs a yes
        const needsApproval =
          !(kind === "chat" && id === ctx.conversationId) && !ctx.createdIds.has(id);
        if (needsApproval) {
          const ok = await approval.request({ tool: name, summary: `Move ${kind} "${item.title}" → ${dest}` });
          if (!ok) return { ok: false, summary: `Skipped moving "${item.title}"`, modelOutput: "The user declined this action. Do not retry it; continue without it." };
        }
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
        return {
          ok: true,
          summary: `Moved ${kind} "${item.title}" → ${dest}`,
          modelOutput: `Moved ${kind} "${item.title}" to ${dest}.`,
          refs: [
            { k: kind, id, label: item.title },
            ...(target ? [{ k: "folder" as const, id: target, label: pathLabel(path) }] : []),
          ],
          undo: { op: "move", kind, id, to: item.folderId },
          touchedFolderId: target,
        };
      }

      case "create_chat": {
        const path = normalizePath(asString(input.path));
        const title = asString(input.title).trim().slice(0, 80);
        const target = resolvePath(lib.folders, path);
        if (target === undefined) {
          return { ok: false, summary: `create_chat: no folder "${path}"`, modelOutput: `Error: folder "${path}" does not exist. Create it first with create_folder.` };
        }
        const dest = path || "the library root";
        const chat = useChatStore.getState();
        // keep the conversation the user is talking in active; a new chat is
        // created in the background via a direct insert-like path
        const currentActive = chat.activeConversationId;
        const newId = await chat.createConversation(title, target ?? null, null);
        if (currentActive && newId && newId !== currentActive) {
          await chat.openConversation(currentActive);
        }
        if (!newId) throw new Error("createConversation returned null");
        ctx.createdIds.add(newId);
        return {
          ok: true,
          summary: `Started chat "${title}" in ${dest}`,
          modelOutput: `Created conversation "${title}" (id: ${newId}) in ${dest}. Link it for the user as [${title}](/chat/${newId}).`,
          refs: [{ k: "chat", id: newId, label: title }],
          touchedFolderId: target,
        };
      }

      case "create_note": {
        const path = normalizePath(asString(input.path));
        const title = asString(input.title).trim().slice(0, 120);
        const markdown = asString(input.markdown);
        const target = resolvePath(lib.folders, path);
        if (target === undefined) {
          return { ok: false, summary: `create_note: no folder "${path}"`, modelOutput: `Error: folder "${path}" does not exist. Create it first with create_folder.` };
        }
        const notes = useNoteStore.getState();
        const id = notes.createNote(target);
        notes.updateNote(id, { title, content: markdown });
        ctx.createdIds.add(id);
        return {
          ok: true,
          summary: `Created note "${title}"`,
          modelOutput: `Created note "${title}" (id: ${id}). Link it as [${title}](/notes/${id}).`,
          refs: [{ k: "note", id, label: title }],
          touchedFolderId: target,
        };
      }

      case "web_search": {
        const query = asString(input.query).trim().slice(0, 300);
        if (!query) return { ok: false, summary: "web_search: empty query", modelOutput: "Error: query is required." };
        let text = "";
        for await (const chunk of streamChatResponse(
          [{ role: "user", content: `Search the web for: ${query}\n\nReply with a compact factual summary (at most 12 bullet points) of what you found, in the language of the query. List the source page titles at the end.` }],
          "",
          "",
          {
            webSearch: true,
            maxOutputTokens: 1500,
            signal: ctx.signal,
            systemPromptOverride:
              "You are a research helper with Google Search. Search the web and report only what the results say, concisely; never invent facts.",
          },
        )) {
          text += chunk.delta;
        }
        return {
          ok: true,
          summary: `Searched the web for "${query}"`,
          modelOutput: text.trim() || "No results.",
          detail: query,
        };
      }

      case "offer_whiteboard": {
        const path = normalizePath(asString(input.path));
        const title = asString(input.title).trim().slice(0, 120);
        const target = resolvePath(lib.folders, path);
        if (target === undefined) {
          return { ok: false, summary: `offer_whiteboard: no folder "${path}"`, modelOutput: `Error: folder "${path}" does not exist. Create it first with create_folder.` };
        }
        return {
          ok: true,
          summary: `Offered a whiteboard "${title}"`,
          modelOutput: "A card is shown under your reply; the user names the board and creates it with Enter. Don't repeat it in prose beyond one short mention.",
          offer: { kind: "whiteboard", title, folderId: target },
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

export function buildLibraryAgentSystemPrompt(
  conversationId?: string | null,
): string {
  const thisChat = conversationId
    ? `\nThe conversation you are talking in has id ${conversationId} (kind "chat"). "This chat" / "ez a beszélgetés" means it; file it with move_item when you set up a folder for the topic.\n`
    : "";
  return `You are Pnyxy's study assistant in assistant mode. Pnyxy is a learning app: the user's library holds folders with books (PDFs/EPUBs), chats (AI conversations), notes, whiteboards and saved links (web pages / YouTube videos). Folders nest via slash paths like "History/WW2".

Your job: set up and keep a sensible place for what the user wants to learn or work on, and act on it with the tools. Typical request: "set up X for me" → look at the library snapshot, pick or create a fitting folder (reuse existing parents, e.g. put a game under an existing "Games" folder), move this chat there, look things up on the web when the topic is unfamiliar, save what you found as a short note, and offer a whiteboard when drawing would help. Then tell the user how to start.
${thisChat}
Rules:
- Act, don't ask for permission for each step: the user sees every step in the activity log and can undo it. Moving the user's existing items (not this chat, not things you just made) shows them an approval card; if they decline, don't retry.
- Prefer reusing existing folders over creating near-duplicates; check the snapshot first. Keep the structure small (1-3 new folders).
- Keep names short and in the user's language. Reply in the user's language (Hungarian if they write Hungarian).
- Don't narrate tool calls in prose; the log shows them. After acting, write 2-4 short sentences: what is set up and how to begin. Link notes and chats you created as [title](/notes/<id>) or [title](/chat/<id>).
- Don't move things the user didn't mention unless you asked and they agreed. Never claim a step happened unless its tool succeeded.

Current library snapshot (paths, items and ids):
${formatLibrarySnapshot()}`;
}
