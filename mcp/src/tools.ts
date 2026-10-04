import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Session } from "./session.js";
import { extractPages } from "./pdf-text.js";

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
          id: randomUUID(),
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
}
