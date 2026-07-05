import { useRef, useState, type ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Paperclip } from "lucide-react";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import { useLibraryStore } from "@/stores/library-store";
import { createPdfAdapter } from "@/features/reader/adapters/pdf-adapter";

interface AttachFileButtonProps {
  bookId: string;
  onAttached?: () => void;
}

const MAX_BYTES = 100 * 1024 * 1024;

/**
 * Attaches a real PDF to an existing placeholder book, the
 * upload-then-link path used after the user accepted an AI
 * recommendation as a metadata-only book and later got their hands
 * on the file.
 *
 * Pipeline mirrors the relevant slice of `runUploadJob` (hash via
 * pdf adapter, upload to `book-files`, insert `book_files` row,
 * patch `books.file_hash` + `page_count`) but skips the new-book
 * insert. Storage path is the canonical
 * `${user_id}/${org_id}/${file_hash}.pdf` so dedup-by-hash still
 * works across orgs.
 */
export function AttachFileButton({ bookId, onAttached }: AttachFileButtonProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const fetchLibrary = useLibraryStore((s) => s.fetchLibrary);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePick = () => inputRef.current?.click();

  const handleFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (
      file.type !== "application/pdf" &&
      !file.name.toLowerCase().endsWith(".pdf")
    ) {
      setError(
        t("book.attach.errorPdfOnly", {
          defaultValue: "Only PDF files are supported.",
        }),
      );
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(
        t("book.attach.errorTooLarge", {
          defaultValue: "PDF is larger than 100 MB.",
        }),
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const orgId = useOrgStore.getState().currentOrgId;
      if (!orgId) {
        throw new Error(
          t("book.attach.noActiveOrg", {
            defaultValue: "No active workspace.",
          }),
        );
      }

      // 1. Hash + page count via the PDF adapter.
      const adapter = createPdfAdapter();
      let pageCount: number;
      let fileHash: string;
      try {
        const meta = await adapter.load(file);
        pageCount = meta.totalPages;
        fileHash = meta.id;
      } finally {
        adapter.dispose();
      }

      const storagePath = `${user.id}/${orgId}/${fileHash}.pdf`;

      // 2. Upload bytes. `upsert: false`, if the same hash already
      //    sits in storage (e.g. user uploaded the same file before
      //    and is just reattaching), the storage call errors and we
      //    accept the existing object.
      const { error: uploadError } = await supabase.storage
        .from("book-files")
        .upload(storagePath, file, {
          contentType: "application/pdf",
          upsert: false,
        });
      // Ignore "already exists", we'll reuse the existing object.
      if (
        uploadError &&
        !uploadError.message.toLowerCase().includes("exists") &&
        !uploadError.message.toLowerCase().includes("duplicate")
      ) {
        throw uploadError;
      }

      // 3. Patch the books row so the rest of the app treats this
      //    placeholder as a real PDF-backed book.
      const { error: updateError } = await supabase
        .from("books")
        .update({
          file_hash: fileHash,
          page_count: pageCount,
          format: "pdf",
        })
        .eq("id", bookId);
      if (updateError) throw updateError;

      // 4. Link the file. The book_files row is what the reader
      //    looks at to find storage_path, so this is the actual
      //    "now openable" moment.
      const { error: fileInsertError } = await supabase
        .from("book_files")
        .insert({
          book_id: bookId,
          storage_path: storagePath,
          file_name: file.name,
          mime_type: "application/pdf",
          size_bytes: file.size,
        });
      if (fileInsertError) throw fileInsertError;

      await fetchLibrary(true);
      onAttached?.();
    } catch (err) {
      logError("AttachFileButton:attach", err);
      setError(
        err instanceof Error
          ? err.message
          : t("book.attach.failed", { defaultValue: "Attach failed." }),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="secondary" onClick={handlePick} disabled={busy || !user}>
        {busy ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Paperclip size={14} />
        )}
        {t("book.attach.button", { defaultValue: "Attach PDF" })}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,application/pdf"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="text-2xs text-danger">{error}</p>}
    </div>
  );
}
