import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  FilePlus,
  Globe,
  Library,
  Loader2,
  ScanLine,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui";
import { LibraryPickerModal } from "./popovers/LibraryPickerModal";
import { OpenFromUrlModal } from "@/features/library/modals/OpenFromUrlModal";
import { UploadPdfModal } from "@/features/library/modals/UploadPdfModal";
import { DeviceBookScanModal } from "@/features/library/modals/DeviceBookScanModal";
import { useOpenDocument } from "@/hooks/use-open-document";
import { useOpenUploadedDocument } from "@/hooks/use-open-uploaded-document";
import { useOpenCatalogBook } from "@/hooks/use-open-catalog-book";
import { useLibraryStore } from "@/stores/library-store";
import { loadLastOpenedBook } from "@/lib/last-opened-book";
import type {
  CatalogLibraryItem,
  UploadedLibraryItem,
} from "@/types/catalog";

/** Shown in the reader when no document is open: resume, open, import. */
export function ReaderEmptyState() {
  const { t } = useTranslation();
  const { fileInputRef, triggerFilePicker, handleFileSelect, openFile } =
    useOpenDocument();
  const { openUploadedBook } = useOpenUploadedDocument();
  const { openCatalogBook } = useOpenCatalogBook();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [urlOpen, setUrlOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  // read once; a device only remembers its own last-opened book
  const [lastOpened] = useState(loadLastOpenedBook);
  const [resuming, setResuming] = useState(false);

  // Re-resolve the remembered book from the library and re-open it. The
  // page position then restores from the cross-device resume state, so
  // this continues where any device left off.
  const handleResume = async () => {
    if (!lastOpened || resuming) return;
    setResuming(true);
    try {
      await useLibraryStore.getState().fetchLibrary();
      const books = useLibraryStore.getState().books;
      if (lastOpened.source === "uploaded") {
        const entry = books.find(
          (e): e is UploadedLibraryItem =>
            e.source === "uploaded" && e.id === lastOpened.id,
        );
        if (entry) await openUploadedBook(entry);
      } else {
        const entry = books.find(
          (e): e is CatalogLibraryItem =>
            e.source === "catalog" && e.catalog_book.id === lastOpened.id,
        );
        if (entry) await openCatalogBook(entry.catalog_book);
      }
    } finally {
      setResuming(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-glass-bg">
        <BookOpen size={32} className="text-text-muted" />
      </div>
      <h2 className="mb-2 text-xl font-semibold text-text-primary">
        {t("reader.empty.title", { defaultValue: "No book open" })}
      </h2>
      <p className="mb-6 max-w-sm text-sm text-text-secondary">
        {t("reader.empty.body", {
          defaultValue:
            "Upload a book or open a file to start reading, anything you open shows up in your library.",
        })}
      </p>

      {/* resume the last book this device had open */}
      {lastOpened && (
        <button
          type="button"
          onClick={handleResume}
          disabled={resuming}
          className="mb-6 flex w-full max-w-sm items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-3 text-left transition-colors hover:bg-accent/15 disabled:opacity-60 cursor-pointer"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/20 text-accent">
            {resuming ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <BookOpen size={18} />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-medium text-accent">
              {t("reader.empty.continue", { defaultValue: "Continue reading" })}
            </span>
            <span className="block truncate text-sm font-semibold text-text-primary">
              {lastOpened.title}
            </span>
          </span>
        </button>
      )}

      {/* primary: get a book open right now */}
      <div className="flex w-full max-w-sm flex-col gap-2">
        <Button variant="primary" onClick={triggerFilePicker}>
          <FilePlus size={18} />
          {t("reader.empty.openFile", { defaultValue: "Open a file" })}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => setPickerOpen(true)}>
            <Library size={16} />
            {t("reader.empty.fromLibrary", { defaultValue: "From library" })}
          </Button>
          <Button variant="secondary" onClick={() => setUrlOpen(true)}>
            <Globe size={16} />
            {t("library.actions.fromUrl", { defaultValue: "From URL" })}
          </Button>
        </div>
      </div>

      {/* secondary: bring more books into the library */}
      <div className="mt-5 flex items-center gap-4 text-xs">
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <Upload size={14} />
          {t("library.actions.upload", { defaultValue: "Upload to library" })}
        </button>
        <button
          type="button"
          onClick={() => setScanOpen(true)}
          className="flex items-center gap-1.5 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <ScanLine size={14} />
          {t("library.actions.scan", { defaultValue: "Scan device" })}
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.epub,.txt,.md,.markdown"
        className="hidden"
        onChange={handleFileSelect}
      />

      {pickerOpen && <LibraryPickerModal onClose={() => setPickerOpen(false)} />}
      <OpenFromUrlModal
        open={urlOpen}
        onClose={() => setUrlOpen(false)}
        onFile={(file) => {
          setUrlOpen(false);
          void openFile(file);
        }}
      />
      <UploadPdfModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <DeviceBookScanModal open={scanOpen} onClose={() => setScanOpen(false)} />
    </div>
  );
}
