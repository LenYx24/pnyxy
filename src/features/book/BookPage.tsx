import { Outlet, useNavigate, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui";
import { BookPageContext } from "./BookPageContext";
import { BookPageSidebar } from "./BookPageSidebar";
import { useBookData } from "./useBookData";

export function BookPage() {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { data, loading, notFound } = useBookData(bookId);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={32} className="animate-spin text-text-muted" />
      </div>
    );
  }

  if (notFound || !data || !bookId) {
    return (
      <div className="py-20 text-center">
        <p className="text-text-muted">{t("book.notFound")}</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {t("book.goBack")}
        </Button>
      </div>
    );
  }

  const title = data.book.title;
  const unknownAuthor = t("book.unknownAuthor");
  const authors =
    data.source === "catalog"
      ? data.book.authors.join(", ") || unknownAuthor
      : data.book.author || unknownAuthor;
  const coverUrl = data.book.cover_url;

  return (
    <BookPageContext.Provider value={data}>
      <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft size={16} />
          {t("book.back")}
        </button>

        <div className="flex items-start gap-4">
          <div className="shrink-0">
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                className="h-24 w-16 rounded-lg object-cover shadow-md sm:h-32 sm:w-20"
              />
            ) : (
              <div className="flex h-24 w-16 items-center justify-center rounded-lg bg-gradient-to-br from-accent-purple/30 to-accent-blue/30 shadow-md sm:h-32 sm:w-20">
                <BookOpen size={24} className="text-white/20" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
            <p className="text-sm text-text-secondary">{authors}</p>
            {data.source === "uploaded" && (
              <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-accent-purple/15 px-2 py-0.5 text-[10px] font-semibold text-accent-purple">
                {t("book.uploadedBadge")}
              </span>
            )}
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <BookPageSidebar bookId={bookId} />
          <div className="min-w-0">
            <Outlet />
          </div>
        </div>
      </div>
    </BookPageContext.Provider>
  );
}
