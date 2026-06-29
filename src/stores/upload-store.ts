import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { createPdfAdapter } from "@/features/reader/adapters/pdf-adapter";
import { logUploadAttempt } from "@/lib/upload-telemetry";
import { useOrgStore } from "./org-store";
import { useLibraryStore } from "./library-store";
import type { StorageTier } from "@/types/database";

interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  tier: StorageTier;
}

export interface UploadJob {
  /** Client-generated id; the upload's row in the visible queue. */
  id: string;
  fileName: string;
  fileSize: number;
  /** Folder the new book lands in, or null for the org's root. */
  folderId: string | null;
  status: "uploading" | "success" | "error";
  /** 0–100. Monotonic within a single attempt; resets to 0 on retry. */
  progress: number;
  error: string | null;
  /** Set on success — the resulting `books` row id, so the ghost card
   *  can dispatch to /reader/<id> on click before fetchLibrary lands. */
  bookId: string | null;
  /** Wall-clock timestamp; used for the auto-dismiss-success timer. */
  createdAt: number;
  /** Original File reference, retained until success/dismiss so
   *  failed uploads can be retried inline without re-picking the
   *  file. Storing File objects on the store is fine — it's just a
   *  reference, not a serialised blob. */
  file: File;
}

interface UploadState {
  uploads: Map<string, UploadJob>;
  storageUsage: StorageUsage | null;

  fetchStorageUsage: () => Promise<void>;

  /** Enqueue a PDF for background upload. Returns the new job's id
   *  *synchronously* — the work runs in the background and the UI
   *  watches `uploads.get(id)` for status / progress. Multiple
   *  concurrent uploads are safe; the server-side storage-limit
   *  trigger catches over-budget races even if the client-side
   *  pre-check passed for both. On success the job's `status` flips
   *  to `"success"` and a single `fetchLibrary(true)` runs so the
   *  new book lands in the library list. */
  enqueueUpload: (file: File, folderId?: string | null) => string;

  /** Drop a finished or errored job from the visible queue. The
   *  underlying `books` row (if it was created) is untouched — this
   *  only clears the ghost card. */
  dismissUpload: (id: string) => void;

  /** Re-attempt a failed job in place. Resets progress + error and
   *  reuses the same job id so the ghost card doesn't blink. The
   *  caller passes the original File again because it lives on the
   *  job and we want one helper that works whether the UI cached the
   *  File or pulled it back from `uploads.get(id).file`. */
  retryUpload: (id: string) => void;

  /** Backward-compat: enqueue + await completion. Returns the
   *  resulting book id and any error message from the terminal job
   *  state. Used by callers that genuinely need to wait
   *  (Open-in-reader after upload, sequential batch import counters,
   *  the device-scan modal's per-file status tracker). New code
   *  should prefer `enqueueUpload`. */
  uploadPdf: (
    file: File,
    folderId?: string | null,
  ) => Promise<{ bookId: string | null; error: string | null }>;
}

function patchJob(
  uploads: Map<string, UploadJob>,
  id: string,
  patch: Partial<UploadJob>,
): Map<string, UploadJob> {
  const job = uploads.get(id);
  if (!job) return uploads;
  const next = new Map(uploads);
  next.set(id, { ...job, ...patch });
  return next;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  uploads: new Map(),
  storageUsage: null,

  fetchStorageUsage: async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [usageRes, limitRes, profileRes] = await Promise.all([
      supabase.rpc("get_user_storage_usage", { uid: user.id }),
      supabase.rpc("get_user_storage_limit", { uid: user.id }),
      supabase.from("profiles").select("storage_tier").eq("id", user.id).single(),
    ]);

    if (usageRes.error || limitRes.error || profileRes.error) {
      console.error("Failed to fetch storage usage");
      return;
    }

    set({
      storageUsage: {
        usedBytes: Number(usageRes.data ?? 0),
        limitBytes: Number(limitRes.data ?? 104857600),
        tier: (profileRes.data?.storage_tier as StorageTier) ?? "free",
      },
    });
  },

  enqueueUpload: (file, folderId = null) => {
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const job: UploadJob = {
      id,
      fileName: file.name,
      fileSize: file.size,
      folderId,
      status: "uploading",
      progress: 0,
      error: null,
      bookId: null,
      createdAt: Date.now(),
      file,
    };
    set((s) => {
      const next = new Map(s.uploads);
      next.set(id, job);
      return { uploads: next };
    });
    void runUploadJob(id, set, get);
    return id;
  },

  dismissUpload: (id) => {
    set((s) => {
      if (!s.uploads.has(id)) return s;
      const next = new Map(s.uploads);
      next.delete(id);
      return { uploads: next };
    });
  },

  retryUpload: (id) => {
    const job = get().uploads.get(id);
    if (!job || job.status === "uploading") return;
    set((s) => ({
      uploads: patchJob(s.uploads, id, {
        status: "uploading",
        progress: 0,
        error: null,
      }),
    }));
    void runUploadJob(id, set, get);
  },

  uploadPdf: async (file, folderId) => {
    const id = get().enqueueUpload(file, folderId ?? null);
    // Subscribe-once for the terminal state. Zustand setState is
    // synchronous so this resolves on the same microtask the job
    // finishes in — no slop. We don't store the resolve handler on
    // the job itself because we want `UploadJob` to stay POJO-clean
    // and serialisable for future devtools / persistence.
    return new Promise<{ bookId: string | null; error: string | null }>(
      (resolve) => {
        const unsubscribe = useUploadStore.subscribe((s) => {
          const job = s.uploads.get(id);
          if (!job) {
            // Dismissed before completion — treat as cancelled.
            unsubscribe();
            resolve({ bookId: null, error: null });
            return;
          }
          if (job.status === "success") {
            unsubscribe();
            resolve({ bookId: job.bookId, error: null });
            return;
          }
          if (job.status === "error") {
            unsubscribe();
            resolve({ bookId: null, error: job.error });
          }
        });
      },
    );
  },
}));

/**
 * Background runner — owns one job's full lifecycle. Patches the job
 * row as it makes progress; on terminal status (success/error) the
 * caller is responsible for either dismissing (auto-fade after a few
 * seconds for success) or surfacing the error (manual dismiss).
 *
 * Module-scoped so we can call it from both `enqueueUpload` and
 * `retryUpload` without putting it on the store interface.
 */
async function runUploadJob(
  id: string,
  set: (
    partial:
      | Partial<UploadState>
      | ((s: UploadState) => Partial<UploadState>),
  ) => void,
  get: () => UploadState,
) {
  const job = get().uploads.get(id);
  if (!job) return;
  const file = job.file;
  const folderId = job.folderId;

  const fail = (
    message: string,
    telemetryStatus:
      | "upload_failed"
      | "parse_failed"
      | "rejected_too_large" = "upload_failed",
  ) => {
    void logUploadAttempt({
      file,
      status: telemetryStatus,
      failureReason: message,
    });
    set((s) => ({
      uploads: patchJob(s.uploads, id, {
        status: "error",
        error: message,
      }),
    }));
  };
  const bump = (progress: number) => {
    set((s) => ({ uploads: patchJob(s.uploads, id, { progress }) }));
  };

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      fail("You must be signed in to upload files.");
      return;
    }
    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      fail("No active organization. Pick one from the sidebar.");
      return;
    }

    bump(10);

    // 1. Extract metadata via PDF adapter.
    const adapter = createPdfAdapter();
    let title: string;
    let authors: string[];
    let author: string | null;
    let pageCount: number | null;
    let fileHash: string;
    try {
      const meta = await adapter.load(file);
      // The book's name is its filename (extension stripped), not the
      // PDF's embedded Title — embedded titles are frequently missing,
      // stale, or generic ("Microsoft Word - untitled"), whereas the
      // filename is what the user recognises.
      title = file.name.replace(/\.pdf$/i, "").trim() || meta.title;
      // Document metadata uses ";" as the multi-author separator (a
      // comma would clash with "Last, First" names), so split on that.
      authors = (meta.author ?? "")
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean);
      author = authors.length > 0 ? authors.join(", ") : null;
      pageCount = meta.totalPages;
      fileHash = meta.id; // pdf-adapter uses the file hash as id
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to read PDF.";
      fail(`Failed to read PDF: ${message}`, "parse_failed");
      return;
    } finally {
      adapter.dispose();
    }

    bump(30);

    // 2. Duplicate check, scoped to current org so the same PDF can
    //    live in two orgs (e.g. "Personal" + "School") with separate
    //    storage paths.
    const { data: existing } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .eq("file_hash", fileHash)
      .maybeSingle();
    if (existing) {
      fail("This PDF is already in this organization's library.");
      return;
    }

    bump(40);

    // 3. Upload bytes. Path includes org id so deletes per org don't
    //    cross-contaminate.
    const storagePath = `${user.id}/${orgId}/${fileHash}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from("book-files")
      .upload(storagePath, file, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError) {
      fail(`Upload failed: ${uploadError.message}`);
      return;
    }

    bump(70);

    // 4. Insert books row.
    const { data: bookRow, error: bookError } = await supabase
      .from("books")
      .insert({
        user_id: user.id,
        org_id: orgId,
        title,
        authors,
        author,
        format: "pdf" as const,
        page_count: pageCount,
        file_hash: fileHash,
        folder_id: folderId,
      })
      .select("id")
      .single();
    if (bookError || !bookRow) {
      // Best-effort cleanup of the orphaned bytes — failure here is
      // acceptable, the duplicate check on retry would catch it.
      await supabase.storage.from("book-files").remove([storagePath]);
      fail(`Failed to save book: ${bookError?.message ?? "unknown"}`);
      return;
    }

    bump(85);

    // 5. Insert book_files row — server-side trigger enforces the
    //    storage-tier limit here.
    const { error: fileError } = await supabase.from("book_files").insert({
      book_id: bookRow.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: "application/pdf",
      size_bytes: file.size,
    });
    if (fileError) {
      await supabase.storage.from("book-files").remove([storagePath]);
      await supabase.from("books").delete().eq("id", bookRow.id);
      const overLimit = fileError.message.includes("Storage limit");
      fail(
        overLimit
          ? "Storage limit exceeded. Upgrade to Premium for more space."
          : `Failed to save file record: ${fileError.message}`,
        overLimit ? "rejected_too_large" : "upload_failed",
      );
      return;
    }

    bump(100);

    void logUploadAttempt({ file, status: "accepted" });

    set((s) => ({
      uploads: patchJob(s.uploads, id, {
        status: "success",
        progress: 100,
        bookId: bookRow.id as string,
      }),
    }));

    // Refresh storage usage + library list so the new book lands in
    // its destination folder. Force-refetch to bypass the freshness
    // window — this is a real mutation the user just made.
    void get().fetchStorageUsage();
    void useLibraryStore.getState().fetchLibrary(true);
  } catch (err) {
    fail(
      err instanceof Error ? err.message : "Upload failed unexpectedly.",
      "upload_failed",
    );
  }
}
