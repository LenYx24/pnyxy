// Shared by the local stdio server (Node, ./index.ts) and the remote one
// (Deno edge function, supabase/functions/mcp), so imports stay runtime
// neutral: bare specifiers resolve through node_modules or the function's
// import map, and Web Crypto replaces node:crypto.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractPages } from "./pdf-text.ts";

// Hard caps so one tool call can't flood the agent's context.
const MAX_PAGES_PER_READ = 30;
const MAX_CHARS_PER_READ = 120_000;
const MAX_MESSAGES = 200;

const text = (value: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    },
  ],
});

const fail = (message: string) => ({ ...text(message), isError: true });

/** Sent to the agent on connect: when and how to use these tools. */
export const SERVER_INSTRUCTIONS = `Pnyxy is the user's study app: their library of PDFs and books, notes, quizzes and past AI tutor chats.
- Start with get_reading_state to see what they are studying and where they stopped; list_library / search_library to find material.
- read_document returns page text with page numbers; cite pages as p.N so the user can find them.
- Save lasting results into Pnyxy instead of only answering in chat: create_note / update_note for explanations and summaries, create_quiz for practice questions (wrong answers come back for spaced review).
- Keep the library tidy: create_folder, move_item and rename_item. Put new material next to related material (e.g. inside the course's folder), not at the top level.`;

export interface Session {
  /** Client signed in as the user: every query runs under their RLS. */
  db: SupabaseClient;
  userId: string;
}

export function registerTools(server: McpServer, { db, userId }: Session): void {
  // downloaded PDFs, per process, so paging through a book doesn't refetch it
  const fileCache = new Map<string, Uint8Array>();

  async function bookBytes(storagePath: string): Promise<Uint8Array> {
    const cached = fileCache.get(storagePath);
    if (cached) return cached;
    const { data, error } = await db.storage.from("book-files").download(storagePath);
    if (error || !data) throw new Error(`download failed: ${error?.message ?? "empty"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    fileCache.set(storagePath, bytes);
    return bytes;
  }

  server.registerTool(
    "list_library",
    {
      title: "List library",
      description:
        "Lists the user's Pnyxy library: folders, uploaded documents (books/PDFs), notes and whiteboards. Use the document `id` with read_document.",
      inputSchema: {
        folder_id: z
          .string()
          .optional()
          .describe("Only items directly in this folder; omit for everything."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ folder_id }) => {
      let booksQuery = db
        .from("books")
        .select("id, title, authors, format, page_count, folder_id, file_hash, created_at")
        .eq("user_id", userId);
      let notesQuery = db
        .from("notes")
        .select("id, title, book_id, folder_id, updated_at")
        .eq("user_id", userId);
      if (folder_id) {
        booksQuery = booksQuery.eq("folder_id", folder_id);
        notesQuery = notesQuery.eq("folder_id", folder_id);
      }
      const [folders, books, notes, boards] = await Promise.all([
        db.from("folders").select("id, name, parent_id").eq("user_id", userId).order("name"),
        booksQuery.order("created_at", { ascending: false }),
        notesQuery.order("updated_at", { ascending: false }),
        db
          .from("whiteboards")
          .select("id, title, book_id, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false }),
      ]);
      const err = folders.error ?? books.error ?? notes.error ?? boards.error;
      if (err) return fail(err.message);
      return text({
        folders: folder_id ? undefined : folders.data,
        documents: books.data,
        notes: notes.data,
        whiteboards: folder_id ? undefined : boards.data,
      });
    },
  );

  server.registerTool(
    "search_library",
    {
      title: "Search library",
      description: "Finds documents and notes whose title (or note text) contains the query.",
      inputSchema: { query: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      // two plain ilike queries instead of one .or() string: a comma or
      // parenthesis in the query would otherwise be parsed as filter syntax
      const [books, notesByTitle, notesByText] = await Promise.all([
        db
          .from("books")
          .select("id, title, authors, format, page_count")
          .eq("user_id", userId)
          .ilike("title", like)
          .limit(25),
        db
          .from("notes")
          .select("id, title, book_id, updated_at")
          .eq("user_id", userId)
          .ilike("title", like)
          .limit(25),
        db
          .from("notes")
          .select("id, title, book_id, updated_at")
          .eq("user_id", userId)
          .ilike("content", like)
          .limit(25),
      ]);
      const err = books.error ?? notesByTitle.error ?? notesByText.error;
      if (err) return fail(err.message);
      const notes = new Map<string, unknown>();
      for (const n of [...(notesByTitle.data ?? []), ...(notesByText.data ?? [])]) {
        notes.set(n.id, n);
      }
      return text({ documents: books.data, notes: [...notes.values()] });
    },
  );

  server.registerTool(
    "read_document",
    {
      title: "Read document pages",
      description: `Returns the text of a PDF in the user's library, page by page with page numbers (cite them as p.N). At most ${MAX_PAGES_PER_READ} pages per call; page through long books.`,
      inputSchema: {
        document_id: z.string().describe("A document id from list_library / search_library."),
        from_page: z.number().int().min(1).default(1),
        to_page: z.number().int().min(1).optional().describe("Inclusive; defaults to from_page + 9."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ document_id, from_page, to_page }) => {
      const { data: book, error } = await db
        .from("books")
        .select("title, format, book_files(storage_path, is_primary)")
        .eq("id", document_id)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return fail(error.message);
      if (!book) return fail("No such document in this library.");
      if ((book.format ?? "pdf").toLowerCase() !== "pdf") {
        return fail(`Only PDFs can be read for now (this one is ${book.format}).`);
      }
      const files = (book.book_files ?? []) as Array<{ storage_path: string; is_primary: boolean }>;
      const file = files.find((f) => f.is_primary) ?? files[0];
      if (!file) return fail("This document has no uploaded file.");

      const last = Math.min(to_page ?? from_page + 9, from_page + MAX_PAGES_PER_READ - 1);
      const { pages, pageCount } = await extractPages(await bookBytes(file.storage_path), from_page, last);
      let body = "";
      for (const p of pages) {
        const chunk = `\n\n=== p.${p.page} ===\n${p.text || "(no text layer on this page)"}`;
        if (body.length + chunk.length > MAX_CHARS_PER_READ) {
          body += `\n\n[stopped before p.${p.page}: size limit, read on from there]`;
          break;
        }
        body += chunk;
      }
      return text(`${book.title} (${pageCount} pages)${body}`);
    },
  );

  server.registerTool(
    "get_reading_state",
    {
      title: "Reading state",
      description:
        "What the user has been reading lately (document, current page, last read) and how many quiz reviews are due. Use it to pick up where they are.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      // the reader's resume position is keyed by the file's content hash
      const [resume, due] = await Promise.all([
        db
          .from("book_resume_state")
          .select("doc_id, page, updated_at")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false })
          .limit(10),
        db
          .from("quiz_reviews")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .lte("due_at", new Date().toISOString()),
      ]);
      if (resume.error) return fail(resume.error.message);
      const hashes = (resume.data ?? []).map((r) => r.doc_id);
      const byHash = new Map<string, { id: string; title: string; page_count: number | null }>();
      if (hashes.length > 0) {
        const { data } = await db
          .from("books")
          .select("id, title, page_count, file_hash")
          .eq("user_id", userId)
          .in("file_hash", hashes);
        for (const b of data ?? []) byHash.set(b.file_hash, b);
      }
      return text({
        recent: (resume.data ?? []).map((r) => {
          const book = byHash.get(r.doc_id);
          return {
            document_id: book?.id ?? null,
            title: book?.title ?? null,
            page: r.page,
            page_count: book?.page_count ?? null,
            last_read: r.updated_at,
          };
        }),
        quiz_reviews_due: due.error ? null : due.count,
      });
    },
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List AI conversations",
      description: "The user's Pnyxy AI chats, newest first, with the document each one is about.",
      inputSchema: { limit: z.number().int().min(1).max(100).default(30) },
      annotations: { readOnlyHint: true },
    },
    async ({ limit }) => {
      const { data, error } = await db
        .from("chat_conversations")
        .select("id, title, source_doc_id, source_doc_title, source_page, folder_id, updated_at")
        .eq("user_id", userId)
        .is("archived_at", null)
        .order("updated_at", { ascending: false })
        .limit(limit);
      if (error) return fail(error.message);
      return text(data);
    },
  );

  server.registerTool(
    "read_conversation",
    {
      title: "Read an AI conversation",
      description: "Messages of one Pnyxy AI chat in order (all branches, each with its parent id).",
      inputSchema: { conversation_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ conversation_id }) => {
      const { data, error } = await db
        .from("chat_messages")
        .select("id, parent_message_id, role, content, created_at")
        .eq("conversation_id", conversation_id)
        .order("created_at")
        .limit(MAX_MESSAGES);
      if (error) return fail(error.message);
      return text(data);
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Saves a markdown note into the user's Pnyxy library (e.g. a summary, a worked explanation, study material). It shows up under Notes.",
      inputSchema: {
        title: z.string().min(1).max(200),
        content: z.string().describe("Markdown."),
        folder_id: z.string().optional(),
      },
    },
    async ({ title, content, folder_id }) => {
      const now = new Date().toISOString();
      const { data, error } = await db
        .from("notes")
        .insert({
          id: crypto.randomUUID(),
          user_id: userId,
          book_id: null,
          title,
          content,
          folder_id: folder_id ?? null,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();
      if (error) return fail(error.message);
      return text({ created: data.id });
    },
  );
  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description:
        "Changes a note in the user's library: rename it, replace its markdown, or append to it (e.g. add a section to running study notes).",
      inputSchema: {
        note_id: z.string(),
        title: z.string().min(1).max(200).optional(),
        content: z.string().optional().describe("Markdown."),
        mode: z
          .enum(["replace", "append"])
          .default("replace")
          .describe("append adds `content` after the existing text."),
      },
    },
    async ({ note_id, title, content, mode }) => {
      if (title === undefined && content === undefined) {
        return fail("Nothing to change: pass a title and/or content.");
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (title !== undefined) patch.title = title;
      if (content !== undefined) {
        if (mode === "append") {
          const { data: note, error } = await db
            .from("notes")
            .select("content")
            .eq("id", note_id)
            .eq("user_id", userId)
            .maybeSingle();
          if (error) return fail(error.message);
          if (!note) return fail("No such note in this library.");
          const existing = (note.content as string | null) ?? "";
          patch.content = existing ? `${existing.trimEnd()}\n\n${content}` : content;
        } else {
          patch.content = content;
        }
      }
      const { data, error } = await db
        .from("notes")
        .update(patch)
        .eq("id", note_id)
        .eq("user_id", userId)
        .select("id");
      if (error) return fail(error.message);
      if (!data || data.length === 0) return fail("No such note in this library.");
      return text({ updated: note_id });
    },
  );

  const quizQuestion = z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("mcq4"),
      question: z.string().min(1),
      options: z.array(z.string().min(1)).length(4),
      correct_index: z.number().int().min(0).max(3),
      explanation: z.string().optional(),
    }),
    z.object({
      kind: z.literal("multi_select"),
      question: z.string().min(1),
      options: z.array(z.string().min(1)).length(4),
      correct_indices: z.array(z.number().int().min(0).max(3)).min(1),
      explanation: z.string().optional(),
    }),
    z.object({
      kind: z.literal("true_false"),
      question: z.string().min(1),
      correct: z.boolean(),
      explanation: z.string().optional(),
    }),
    z.object({
      kind: z.literal("short_answer"),
      question: z.string().min(1),
      answer: z.string().min(1),
      explanation: z.string().optional(),
    }),
  ]);

  server.registerTool(
    "create_quiz",
    {
      title: "Create a quiz",
      description:
        "Saves a practice quiz into the user's Pnyxy library. It appears under Quizzes, can be taken in the app, and wrong answers come back for spaced review. Question kinds: mcq4 (4 options, one correct), multi_select (4 options, several correct), true_false, short_answer.",
      inputSchema: {
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        document_id: z
          .string()
          .optional()
          .describe("The library document the quiz is about, if any."),
        folder_id: z.string().optional(),
        questions: z.array(quizQuestion).min(1).max(100),
      },
    },
    async ({ title, description, document_id, folder_id, questions }) => {
      const { data: quiz, error } = await db
        .from("quizzes")
        .insert({
          user_id: userId,
          title: title.trim(),
          description: description?.trim() || null,
          visibility: "private",
          uploaded_book_id: document_id ?? null,
          folder_id: folder_id ?? null,
        })
        .select("id")
        .single();
      if (error || !quiz) return fail(error?.message ?? "Could not create the quiz.");

      // same row shapes as the app's quiz editor (stores/quiz-store.ts draftToRow)
      const rows = questions.map((q, position) => {
        const base = {
          quiz_id: quiz.id,
          position,
          kind: q.kind,
          question_text: q.question.trim(),
          explanation: q.explanation?.trim() || null,
        };
        switch (q.kind) {
          case "mcq4":
            return {
              ...base,
              option_a: q.options[0],
              option_b: q.options[1],
              option_c: q.options[2],
              option_d: q.options[3],
              correct_index: q.correct_index,
              correct_text: null,
            };
          case "multi_select":
            return {
              ...base,
              option_a: q.options[0],
              option_b: q.options[1],
              option_c: q.options[2],
              option_d: q.options[3],
              correct_index: null,
              correct_text: [...new Set(q.correct_indices)].sort((a, b) => a - b).join(","),
            };
          case "true_false":
            return {
              ...base,
              option_a: "True",
              option_b: "False",
              option_c: null,
              option_d: null,
              correct_index: q.correct ? 0 : 1,
              correct_text: null,
            };
          case "short_answer":
            return {
              ...base,
              option_a: null,
              option_b: null,
              option_c: null,
              option_d: null,
              correct_index: null,
              correct_text: q.answer.trim(),
            };
        }
      });
      const { error: qErr } = await db.from("quiz_questions").insert(rows);
      if (qErr) {
        // don't leave an empty quiz shell behind
        await db.from("quizzes").delete().eq("id", quiz.id);
        return fail(qErr.message);
      }
      return text({ created: quiz.id, questions: rows.length });
    },
  );

  // Folders and documents carry the organization (workspace) they live in;
  // a new or moved item takes its target folder's, root-level ones the
  // user's default organization.
  async function folderOrg(folderId: string): Promise<string | null> {
    const { data } = await db
      .from("folders")
      .select("org_id")
      .eq("id", folderId)
      .eq("user_id", userId)
      .maybeSingle();
    return (data?.org_id as string | undefined) ?? null;
  }

  async function defaultOrg(): Promise<string | null> {
    const { data } = await db
      .from("organizations")
      .select("id")
      .eq("user_id", userId)
      .eq("is_default", true)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }

  server.registerTool(
    "create_folder",
    {
      title: "Create a folder",
      description:
        "Creates a folder in the user's library, optionally inside another folder. Use it to organize material (e.g. a course folder with one subfolder per topic).",
      inputSchema: {
        name: z.string().min(1).max(200),
        parent_id: z.string().optional().describe("Parent folder id; omit for the top level."),
      },
    },
    async ({ name, parent_id }) => {
      const orgId = parent_id ? await folderOrg(parent_id) : await defaultOrg();
      if (!orgId) return fail(parent_id ? "No such parent folder." : "No workspace found.");
      const { data, error } = await db
        .from("folders")
        .insert({
          user_id: userId,
          org_id: orgId,
          name: name.trim(),
          parent_id: parent_id ?? null,
          sort_order: 0,
        })
        .select("id")
        .single();
      if (error) return fail(error.message);
      return text({ created: data.id });
    },
  );

  const itemType = z.enum(["document", "note", "quiz", "folder"]);
  const itemTable = {
    document: { table: "books", parent: "folder_id", name: "title" },
    note: { table: "notes", parent: "folder_id", name: "title" },
    quiz: { table: "quizzes", parent: "folder_id", name: "title" },
    folder: { table: "folders", parent: "parent_id", name: "name" },
  } as const;

  server.registerTool(
    "move_item",
    {
      title: "Move into a folder",
      description:
        "Moves a document, note, quiz or folder into another folder (or to the top level with folder_id null).",
      inputSchema: {
        item_type: itemType,
        item_id: z.string(),
        folder_id: z.string().nullable().describe("Target folder id, or null for the top level."),
      },
    },
    async ({ item_type, item_id, folder_id }) => {
      const spec = itemTable[item_type];
      const patch: Record<string, unknown> = { [spec.parent]: folder_id };
      if (folder_id) {
        const targetOrg = await folderOrg(folder_id);
        if (!targetOrg) return fail("No such target folder.");
        if (item_type === "folder") {
          // walk up from the target: moving a folder under itself would cut
          // the subtree off from the root
          let cursor: string | null = folder_id;
          for (let depth = 0; cursor && depth < 64; depth++) {
            if (cursor === item_id) return fail("A folder can't be moved into itself.");
            const parent: { data: { parent_id: string | null } | null } = await db
              .from("folders")
              .select("parent_id")
              .eq("id", cursor)
              .maybeSingle();
            cursor = parent.data?.parent_id ?? null;
          }
          const ownOrg = await folderOrg(item_id);
          if (ownOrg && ownOrg !== targetOrg) {
            return fail("Folders can't be moved between workspaces.");
          }
        }
        if (item_type === "document") patch.org_id = targetOrg;
      }
      const { data, error } = await db
        .from(spec.table)
        .update(patch)
        .eq("id", item_id)
        .eq("user_id", userId)
        .select("id");
      if (error) return fail(error.message);
      if (!data || data.length === 0) return fail(`No such ${item_type} in this library.`);
      return text({ moved: item_id, folder_id });
    },
  );

  server.registerTool(
    "rename_item",
    {
      title: "Rename",
      description: "Renames a document, note, quiz or folder in the user's library.",
      inputSchema: {
        item_type: itemType,
        item_id: z.string(),
        name: z.string().min(1).max(200),
      },
    },
    async ({ item_type, item_id, name }) => {
      const spec = itemTable[item_type];
      const { data, error } = await db
        .from(spec.table)
        .update({ [spec.name]: name.trim() })
        .eq("id", item_id)
        .eq("user_id", userId)
        .select("id");
      if (error) return fail(error.message);
      if (!data || data.length === 0) return fail(`No such ${item_type} in this library.`);
      return text({ renamed: item_id });
    },
  );
}
