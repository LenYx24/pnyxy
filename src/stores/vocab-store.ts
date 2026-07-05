import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import {
  loadAllVocabEntries,
  saveVocabEntry as dbSaveVocabEntry,
  deleteVocabEntry as dbDeleteVocabEntry,
  findVocabEntryByWord,
  type StoredVocabEntry,
} from "@/lib/annotation-storage";
import { newCard, reviewCard, hydrateCard } from "@/lib/vocab-scheduler";
import type { VocabEntry, VocabRating } from "@/types/vocab";
import type { Card } from "ts-fsrs";

interface CaptureInput {
  word: string;
  definition: string;
  lang?: string;
  contextSentence?: string;
  sourceDocumentId?: string | null;
  sourceTitle?: string | null;
  sourcePage?: number | null;
}

interface VocabState {
  /** All entries for the current user (or the local-only anon set). */
  entries: Map<string, VocabEntry>;
  isLoading: boolean;

  loadEntries: () => Promise<void>;
  captureFromLookup: (input: CaptureInput) => Promise<VocabEntry>;
  recordReview: (id: string, rating: VocabRating) => Promise<void>;
  removeEntry: (id: string) => Promise<void>;

  /** Pull-down + push-up on sign-in. Idempotent, safe to call repeatedly. */
  syncOnSignIn: () => Promise<void>;

  /** Entries whose `dueAt` is in the past, sorted oldest-first. */
  getDueEntries: (filter?: { sourceDocumentId?: string | null }) => VocabEntry[];
}

function hydrateEntry(stored: StoredVocabEntry): VocabEntry {
  return {
    id: stored.id,
    userId: stored.userId,
    word: stored.word,
    lang: stored.lang,
    definition: stored.definition,
    contextSentence: stored.contextSentence,
    sourceDocumentId: stored.sourceDocumentId,
    sourceTitle: stored.sourceTitle,
    sourcePage: stored.sourcePage,
    fsrsCard: hydrateCard(stored.fsrsCard),
    dueAt: stored.dueAt,
    createdAt: stored.createdAt,
    updatedAt: stored.updatedAt,
  };
}

function serializeEntry(entry: VocabEntry): StoredVocabEntry {
  return {
    id: entry.id,
    userId: entry.userId,
    word: entry.word,
    lang: entry.lang,
    definition: entry.definition,
    contextSentence: entry.contextSentence,
    sourceDocumentId: entry.sourceDocumentId,
    sourceTitle: entry.sourceTitle,
    sourcePage: entry.sourcePage,
    fsrsCard: serializeCard(entry.fsrsCard),
    dueAt: entry.dueAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function serializeCard(card: Card): unknown {
  return {
    ...card,
    due: card.due instanceof Date ? card.due.toISOString() : card.due,
    last_review:
      card.last_review instanceof Date
        ? card.last_review.toISOString()
        : card.last_review,
  };
}

/** Row shape as it lives in Supabase `vocab_entries`. */
interface CloudRow {
  id: string;
  user_id: string;
  word: string;
  lang: string;
  definition: string;
  context_sentence: string;
  source_document_id: string | null;
  source_title: string | null;
  source_page: number | null;
  fsrs_state: unknown;
  due_at: string;
  created_at: string;
  updated_at: string;
}

function rowToEntry(row: CloudRow): VocabEntry {
  return {
    id: row.id,
    userId: row.user_id,
    word: row.word,
    lang: row.lang,
    definition: row.definition,
    contextSentence: row.context_sentence,
    sourceDocumentId: row.source_document_id,
    sourceTitle: row.source_title,
    sourcePage: row.source_page,
    fsrsCard: hydrateCard(row.fsrs_state),
    dueAt: new Date(row.due_at).getTime(),
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function entryToRow(entry: VocabEntry, userId: string): Omit<CloudRow, "created_at" | "updated_at"> {
  return {
    id: entry.id,
    user_id: userId,
    word: entry.word,
    lang: entry.lang,
    definition: entry.definition,
    context_sentence: entry.contextSentence,
    source_document_id: entry.sourceDocumentId,
    source_title: entry.sourceTitle,
    source_page: entry.sourcePage,
    fsrs_state: serializeCard(entry.fsrsCard),
    due_at: new Date(entry.dueAt).toISOString(),
  };
}

async function pushEntry(entry: VocabEntry, userId: string) {
  const { error } = await supabase
    .from("vocab_entries")
    .upsert(entryToRow(entry, userId), { onConflict: "user_id,word,lang" });
  if (error) throw error;
}

export const useVocabStore = create<VocabState>((set, get) => ({
  entries: new Map(),
  isLoading: false,

  async loadEntries() {
    set({ isLoading: true });
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data, error } = await supabase
          .from("vocab_entries")
          .select("*")
          .eq("user_id", user.id)
          .order("due_at", { ascending: true });
        if (error) throw error;
        const map = new Map<string, VocabEntry>();
        for (const row of (data ?? []) as CloudRow[]) {
          const entry = rowToEntry(row);
          map.set(entry.id, entry);
          // Mirror to IDB for offline.
          dbSaveVocabEntry(serializeEntry(entry)).catch(() => {});
        }
        set({ entries: map });
      } else {
        const stored = await loadAllVocabEntries();
        const map = new Map<string, VocabEntry>();
        for (const s of stored) {
          const entry = hydrateEntry(s);
          map.set(entry.id, entry);
        }
        set({ entries: map });
      }
    } catch (err) {
      logError("vocab-store.loadEntries", err);
    } finally {
      set({ isLoading: false });
    }
  },

  async captureFromLookup(input) {
    const lang = input.lang ?? "en";
    const normalized = input.word.trim().toLowerCase();
    if (!normalized) {
      throw new Error("empty_word");
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Check for existing entry in memory first, then IDB as a fallback.
    const existingInMemory = [...get().entries.values()].find(
      (e) => e.word === normalized && e.lang === lang,
    );
    const existingStored =
      existingInMemory ??
      (await findVocabEntryByWord(normalized, lang).then((s) =>
        s ? hydrateEntry(s) : null,
      ));

    const now = Date.now();

    let entry: VocabEntry;
    if (existingStored) {
      // Refresh definition + context, but preserve SRS state so
      // re-looking up a word doesn't reset learning progress.
      entry = {
        ...existingStored,
        definition: input.definition || existingStored.definition,
        contextSentence:
          input.contextSentence?.trim() || existingStored.contextSentence,
        sourceDocumentId:
          input.sourceDocumentId ?? existingStored.sourceDocumentId,
        sourceTitle: input.sourceTitle ?? existingStored.sourceTitle,
        sourcePage: input.sourcePage ?? existingStored.sourcePage,
        userId: user?.id ?? existingStored.userId,
        updatedAt: now,
      };
    } else {
      const card = newCard(new Date(now));
      entry = {
        id: crypto.randomUUID(),
        userId: user?.id ?? null,
        word: normalized,
        lang,
        definition: input.definition,
        contextSentence: input.contextSentence?.trim() ?? "",
        sourceDocumentId: input.sourceDocumentId ?? null,
        sourceTitle: input.sourceTitle ?? null,
        sourcePage: input.sourcePage ?? null,
        fsrsCard: card,
        dueAt: card.due.getTime(),
        createdAt: now,
        updatedAt: now,
      };
    }

    // Optimistic: update store + IDB immediately.
    const next = new Map(get().entries);
    next.set(entry.id, entry);
    set({ entries: next });
    await dbSaveVocabEntry(serializeEntry(entry));

    // Background cloud push (fire-and-forget, offline-first).
    if (user) {
      pushEntry(entry, user.id).catch((err) =>
        logError("vocab-store.captureFromLookup.push", err),
      );
    }

    return entry;
  },

  async recordReview(id, rating) {
    const existing = get().entries.get(id);
    if (!existing) return;

    const { card, dueAt } = reviewCard(existing.fsrsCard, rating);
    const now = Date.now();
    const updated: VocabEntry = {
      ...existing,
      fsrsCard: card,
      dueAt: dueAt.getTime(),
      updatedAt: now,
    };

    const next = new Map(get().entries);
    next.set(id, updated);
    set({ entries: next });
    await dbSaveVocabEntry(serializeEntry(updated));

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      pushEntry(updated, user.id).catch((err) =>
        logError("vocab-store.recordReview.push", err),
      );
    }
  },

  async removeEntry(id) {
    const existing = get().entries.get(id);
    if (!existing) return;

    const next = new Map(get().entries);
    next.delete(id);
    set({ entries: next });
    await dbDeleteVocabEntry(id);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { error } = await supabase
        .from("vocab_entries")
        .delete()
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) logError("vocab-store.removeEntry", error);
    }
  },

  async syncOnSignIn() {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Push any local-only entries (userId was null at capture time).
    const localOnly = [...get().entries.values()].filter(
      (e) => e.userId === null,
    );
    for (const entry of localOnly) {
      try {
        await pushEntry(entry, user.id);
        entry.userId = user.id;
        await dbSaveVocabEntry(serializeEntry(entry));
      } catch (err) {
        logError("vocab-store.syncOnSignIn.push", err);
      }
    }

    // Pull authoritative cloud state.
    await get().loadEntries();
  },

  getDueEntries(filter) {
    const now = Date.now();
    const all = [...get().entries.values()]
      .filter((e) => e.dueAt <= now)
      .filter((e) =>
        filter?.sourceDocumentId !== undefined
          ? e.sourceDocumentId === filter.sourceDocumentId
          : true,
      );
    all.sort((a, b) => a.dueAt - b.dueAt);
    return all;
  },
}));
