import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { createPdfAdapter } from "@/features/reader/adapters/pdf-adapter";
import { useOrgStore } from "./org-store";
import type { StorageTier } from "@/types/database";

interface StorageUsage {
  usedBytes: number;
  limitBytes: number;
  tier: StorageTier;
}

interface UploadState {
  isUploading: boolean;
  uploadProgress: number;
  error: string | null;
  storageUsage: StorageUsage | null;

  fetchStorageUsage: () => Promise<void>;
  /** Upload a PDF and create the corresponding `books` row. The
   *  optional `folderId` lands the new book in that folder — used
   *  by the library's drag-drop / upload-from-folder flows so an
   *  upload "lands where you are" instead of jumping back to root. */
  uploadPdf: (file: File, folderId?: string | null) => Promise<string | null>;
  clearError: () => void;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  isUploading: false,
  uploadProgress: 0,
  error: null,
  storageUsage: null,

  clearError: () => set({ error: null }),

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

  uploadPdf: async (file: File, folderId?: string | null) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      set({ error: "You must be signed in to upload files." });
      return null;
    }

    const orgId = useOrgStore.getState().currentOrgId;
    if (!orgId) {
      set({
        error: "No active organization. Pick one from the sidebar.",
      });
      return null;
    }

    set({ isUploading: true, uploadProgress: 0, error: null });

    try {
      // 1. Fetch current storage usage
      await get().fetchStorageUsage();
      const usage = get().storageUsage;
      if (usage && usage.usedBytes + file.size > usage.limitBytes) {
        set({
          error: `Upload would exceed your storage limit. You have ${formatBytes(usage.limitBytes - usage.usedBytes)} remaining.`,
          isUploading: false,
        });
        return null;
      }

      set({ uploadProgress: 10 });

      // 2. Extract metadata via PDF adapter
      const adapter = createPdfAdapter();
      let title: string;
      let author: string | null;
      let pageCount: number | null;
      let fileHash: string;

      try {
        const meta = await adapter.load(file);
        title = meta.title;
        author = meta.author || null;
        pageCount = meta.totalPages;
        fileHash = meta.id; // pdf-adapter uses file hash as id
      } finally {
        adapter.dispose();
      }

      set({ uploadProgress: 30 });

      // 3. Duplicate check, scoped to the current org so the same
      // PDF can live in multiple workspaces (e.g. "Personal" and
      // "School") if the user wants. The storage path embeds the
      // org id so each upload gets its own file.
      const { data: existing } = await supabase
        .from("books")
        .select("id")
        .eq("user_id", user.id)
        .eq("org_id", orgId)
        .eq("file_hash", fileHash)
        .maybeSingle();

      if (existing) {
        set({
          error: "This PDF is already in this organization's library.",
          isUploading: false,
        });
        return null;
      }

      set({ uploadProgress: 40 });

      // 4. Upload to Supabase Storage. Path includes org id so the
      // same PDF in two orgs gets two distinct storage files —
      // deleting one org's copy doesn't break the other's.
      const storagePath = `${user.id}/${orgId}/${fileHash}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("book-files")
        .upload(storagePath, file, {
          contentType: "application/pdf",
          upsert: false,
        });

      if (uploadError) {
        set({ error: `Upload failed: ${uploadError.message}`, isUploading: false });
        return null;
      }

      set({ uploadProgress: 70 });

      // 5. Insert books row
      const { data: bookRow, error: bookError } = await supabase
        .from("books")
        .insert({
          user_id: user.id,
          org_id: orgId,
          title,
          author,
          format: "pdf" as const,
          page_count: pageCount,
          file_hash: fileHash,
          folder_id: folderId ?? null,
        })
        .select("id")
        .single();

      if (bookError || !bookRow) {
        // Cleanup storage on failure
        await supabase.storage.from("book-files").remove([storagePath]);
        set({ error: `Failed to save book: ${bookError?.message}`, isUploading: false });
        return null;
      }

      set({ uploadProgress: 85 });

      // 6. Insert book_files row (trigger enforces storage limit)
      const { error: fileError } = await supabase.from("book_files").insert({
        book_id: bookRow.id,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: "application/pdf",
        size_bytes: file.size,
      });

      if (fileError) {
        // Cleanup both storage and books row
        await supabase.storage.from("book-files").remove([storagePath]);
        await supabase.from("books").delete().eq("id", bookRow.id);
        set({
          error: fileError.message.includes("Storage limit")
            ? "Storage limit exceeded. Upgrade to Premium for more space."
            : `Failed to save file record: ${fileError.message}`,
          isUploading: false,
        });
        return null;
      }

      set({ uploadProgress: 100 });

      // Refresh storage usage
      await get().fetchStorageUsage();

      set({ isUploading: false });
      return bookRow.id;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Upload failed unexpectedly.",
        isUploading: false,
      });
      return null;
    }
  },
}));

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}
