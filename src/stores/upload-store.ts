import { create } from "zustand";
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase";
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
  id: string;
  fileName: string;
  fileSize: number;
  /** null = org root */
  folderId: string | null;
  status: "uploading" | "success" | "error";
  /** 0-100, resets to 0 on retry */
  progress: number;
  error: string | null;
  /** set on success; lets the ghost card navigate to /reader/<id> before fetchLibrary lands */
  bookId: string | null;
  createdAt: number;
  /** kept until success/dismiss so failed uploads can retry without re-picking */
  file: File;
}

interface UploadState {
  uploads: Map<string, UploadJob>;
  storageUsage: StorageUsage | null;

  fetchStorageUsage: () => Promise<void>;

  /** Enqueue a PDF for background upload, returns the job id synchronously. Watch uploads.get(id) for status/progress. */
  enqueueUpload: (file: File, folderId?: string | null) => string;

  /** Drop a finished/errored job from the queue. Does not touch the books row. */
  dismissUpload: (id: string) => void;

  /** Abort an in-flight job and drop it. Treated as cancelled, not failed: no error toast, no telemetry. */
  cancelUpload: (id: string) => void;

  /** Retry a failed job in place, reusing the same id so the ghost card doesn't blink. */
  retryUpload: (id: string) => void;

  /** enqueue + await completion, for callers that need to wait (open-in-reader, batch import). Prefer enqueueUpload. */
  uploadPdf: (
    file: File,
    folderId?: string | null,
  ) => Promise<{ bookId: string | null; error: string | null }>;
}

// per-job AbortControllers, keyed by job id. NOT in zustand state: not
// serializable and must never persist. Lives for the job's network life only.
const uploadControllers = new Map<string, AbortController>();

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

  cancelUpload: (id) => {
    // abort the network transfer, then drop the job. runUploadJob swallows
    // the resulting AbortError so it never surfaces as an error/telemetry.
    const controller = uploadControllers.get(id);
    if (controller) controller.abort();
    uploadControllers.delete(id);
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
    // subscribe once for the terminal state
    return new Promise<{ bookId: string | null; error: string | null }>(
      (resolve) => {
        const unsubscribe = useUploadStore.subscribe((s) => {
          const job = s.uploads.get(id);
          if (!job) {
            // dismissed before completion, treat as cancelled
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

/** True for aborts triggered by cancelUpload, so callers can skip the failure path. */
function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

/**
 * Upload bytes straight to the storage REST endpoint so we can pass an
 * AbortSignal. storage-js's upload() builds its own fetch call and never
 * threads a signal through, so we replicate its request here: multipart
 * FormData body with a "cacheControl" field, x-upsert header, bearer auth.
 * Throws AbortError if the signal fires mid-transfer.
 */
async function uploadBytes(
  storagePath: string,
  file: File,
  signal: AbortSignal,
): Promise<{ error: string | null }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token ?? SUPABASE_ANON_KEY;

  const form = new FormData();
  form.append("cacheControl", "3600");
  // storage-js appends the Blob under the empty field name
  form.append("", file);

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/book-files/${storagePath}`,
    {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        // upsert:false, matches the store's original upload() options
        "x-upsert": "false",
      },
      body: form,
      signal,
    },
  );

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // non-JSON error body, keep the status-code message
    }
    return { error: message };
  }
  return { error: null };
}

/** Background runner for one job's lifecycle. Patches the job row as it progresses. */
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

  // one controller per run; cancelUpload aborts it. retry gets a fresh one.
  const controller = new AbortController();
  uploadControllers.set(id, controller);

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

    // 1. extract metadata
    const adapter = createPdfAdapter();
    let title: string;
    let authors: string[];
    let author: string | null;
    let pageCount: number | null;
    let fileHash: string;
    try {
      const meta = await adapter.load(file);
      // prefer filename over embedded PDF Title, which is often missing or generic
      title = file.name.replace(/\.pdf$/i, "").trim() || meta.title;
      // ";" is the multi-author separator (comma clashes with "Last, First")
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

    // 2. duplicate check, scoped to org so the same PDF can live in two orgs
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

    // 3. upload bytes. path includes org id so per-org deletes don't cross-contaminate.
    // uploadBytes threads the abort signal so cancel actually stops the transfer.
    const storagePath = `${user.id}/${orgId}/${fileHash}.pdf`;
    const { error: uploadError } = await uploadBytes(
      storagePath,
      file,
      controller.signal,
    );
    if (uploadError) {
      fail(`Upload failed: ${uploadError}`);
      return;
    }

    // cancelled between the byte upload landing and the row inserts: clean up
    // the orphaned bytes and bail without creating a book.
    if (controller.signal.aborted) {
      await supabase.storage.from("book-files").remove([storagePath]);
      return;
    }

    bump(70);

    // 4. insert books row
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
      // clean up orphaned bytes; retry's duplicate check covers failures here
      await supabase.storage.from("book-files").remove([storagePath]);
      fail(`Failed to save book: ${bookError?.message ?? "unknown"}`);
      return;
    }

    bump(85);

    // 5. insert book_files row; server-side trigger enforces the storage-tier limit here
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

    // force-refetch to bypass the freshness window
    void get().fetchStorageUsage();
    void useLibraryStore.getState().fetchLibrary(true);
  } catch (err) {
    // cancelUpload aborted the transfer: not a failure, don't toast or log.
    // the job row is already gone, so fail() would no-op anyway.
    if (isAbortError(err) || controller.signal.aborted) return;
    fail(
      err instanceof Error ? err.message : "Upload failed unexpectedly.",
      "upload_failed",
    );
  } finally {
    uploadControllers.delete(id);
  }
}
