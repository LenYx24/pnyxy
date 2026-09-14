import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { BookOpen, ArrowRight } from "lucide-react";
import { useLibraryStore } from "@/stores/library-store";
import type { OpenDocRef } from "@/lib/ai/extract-open-doc";

/**
 * Clickable card the AI appends to point the user at one of their own library
 * files (the onboarding guide, a note, a PDF). Validated against the live
 * library so a hallucinated id renders nothing rather than a dead link; only
 * uploaded files (which open in the reader at /reader/:id) are matched.
 */
export function InlineOpenDocCard({ doc }: { doc: OpenDocRef }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const books = useLibraryStore((s) => s.books);
  const match = books.find(
    (b) => b.source === "uploaded" && b.id === doc.docId,
  );
  if (!match || match.source !== "uploaded") return null;

  return (
    <button
      type="button"
      onClick={() => navigate(`/reader/${doc.docId}`)}
      className="group mt-2 flex w-full items-center gap-3 rounded-panel border border-glass-border bg-bg-tertiary px-4 py-3 text-left transition-colors hover:bg-surface-3"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        <BookOpen size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {match.book.title}
        </span>
        <span className="block text-xs text-text-muted">
          {t("chat.inlineOpenDoc.open")}
        </span>
      </span>
      <ArrowRight
        size={16}
        className="shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}
