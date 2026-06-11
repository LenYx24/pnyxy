import { useEffect, useState } from "react";
import { Loader2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAdminStore } from "@/stores/admin-store";

export function CatalogModerationTab() {
  const { pendingBooks, catalogLoading, fetchPendingBooks, approveBook, rejectBook } =
    useAdminStore();
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    fetchPendingBooks();
  }, [fetchPendingBooks]);

  const handleApprove = async (id: string) => {
    setActing(id);
    try {
      await approveBook(id);
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (id: string) => {
    setActing(id);
    try {
      await rejectBook(id);
    } finally {
      setActing(null);
    }
  };

  if (catalogLoading && pendingBooks.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (pendingBooks.length === 0) {
    return (
      <p className="py-12 text-center text-text-muted">
        No pending books to review.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {pendingBooks.map((book) => (
        <div
          key={book.id}
          className="flex items-center gap-4 rounded-xl border border-glass-border bg-glass-bg p-4 backdrop-blur-md"
        >
          {book.cover_url ? (
            <img
              src={book.cover_url}
              alt={book.title}
              className="h-16 w-11 shrink-0 rounded-md object-cover"
            />
          ) : (
            <div className="flex h-16 w-11 shrink-0 items-center justify-center rounded-md bg-glass-hover text-text-muted">
              <span className="text-xs">N/A</span>
            </div>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-text-primary">
              {book.title}
            </p>
            <p className="truncate text-sm text-text-secondary">
              {book.authors.join(", ") || "Unknown author"}
            </p>
            <p className="text-xs text-text-muted">
              Source: {book.source}
              {book.submitted_by && ` | Submitted by: ${book.submitted_by}`}
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <Button
              variant="ghost"
              disabled={acting === book.id}
              onClick={() => handleApprove(book.id)}
            >
              <Check size={16} className="text-success" />
              Approve
            </Button>
            <Button
              variant="ghost"
              disabled={acting === book.id}
              onClick={() => handleReject(book.id)}
            >
              <X size={16} className="text-danger" />
              Reject
            </Button>
            {acting === book.id && (
              <Loader2 size={16} className="animate-spin text-accent" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
