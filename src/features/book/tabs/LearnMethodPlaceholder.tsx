import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, Clock, Loader2, Sparkles, BookMarked } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LEARN_METHODS } from "../LEARN_METHODS";
import { BookQuizzesList } from "@/features/quizzes/QuizzesPage";
import { Button } from "@/components/ui";
import { useQuizStore } from "@/stores/quiz-store";
import { useBook } from "../BookPageContext";
import { AiCoachMethodPage } from "./AiCoachMethodPage";
import { isAiCoachSlug } from "./learn-coach-helpers";

export function LearnMethodPlaceholder() {
  const { bookId, methodSlug } = useParams<{
    bookId: string;
    methodSlug: string;
  }>();
  const book = useBook();
  const { t } = useTranslation();
  const method = LEARN_METHODS.find((m) => m.slug === methodSlug);

  // The three AI-coaching styles (Feynman / ELI5 / Socratic) all
  // share a single component, they only differ in the framing
  // string used to seed the chat draft.
  if (isAiCoachSlug(methodSlug)) {
    return <AiCoachMethodPage />;
  }

  // Flashcards slug is live: reuse the short-answer quiz pipeline for
  // book-scoped Q/A cards, plus a shortcut to the FSRS vocabulary deck.
  if (methodSlug === "flashcards" && method) {
    return <FlashcardsMethodPage method={method} />;
  }

  // Quiz slug is live, render the book-scoped quiz list instead of
  // the "coming soon" placeholder.
  if (methodSlug === "quiz" && method) {
    const Icon = method.icon;
    return (
      <div className="space-y-4">
        <Link
          to={`/books/${bookId}/learn`}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          <ArrowLeft size={12} />
          {t("learnHub.backToHub", { defaultValue: "Learn hub" })}
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Icon size={20} />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-text-primary">
              {method.label}
            </h2>
            <p className="text-xs text-text-muted">{method.tagline}</p>
          </div>
        </div>

        <BookQuizzesList
          catalogBookId={book.source === "catalog" ? book.book.id : undefined}
          uploadedBookId={book.source === "uploaded" ? book.book.id : undefined}
        />
      </div>
    );
  }

  if (!method) {
    return (
      <div className="py-12 text-center">
        <p className="text-text-muted">
          {t("learnHub.unknownMethod", {
            defaultValue: "Unknown learning method.",
          })}
        </p>
        <Link
          to={`/books/${bookId}/learn`}
          className="mt-4 inline-flex items-center gap-2 text-sm text-accent hover:underline"
        >
          <ArrowLeft size={14} />
          {t("learnHub.backToHub", { defaultValue: "Learn hub" })}
        </Link>
      </div>
    );
  }

  const Icon = method.icon;

  return (
    <div className="space-y-4">
      <Link
        to={`/books/${bookId}/learn`}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={12} />
        Learn hub
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {method.label}
          </h2>
          <p className="text-xs text-text-muted">{method.tagline}</p>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-text-secondary">
        {method.description}
      </p>

      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
        <Clock size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">
          {t("learnHub.methodComingSoonTitle", { defaultValue: "Coming soon" })}
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {t("learnHub.methodComingSoon", {
            defaultValue: "This learning tool is coming soon.",
          })}
        </p>
      </div>
    </div>
  );
}

/**
 * Book-scoped flashcards. There's no separate FSRS store for book
 * cards, so we lean on the existing short-answer quiz pipeline (Q/A
 * pairs) for generation + review, and surface the app's real FSRS
 * flashcard deck (the vocabulary page) as a shortcut for anyone who
 * wants dictionary-style spaced repetition.
 */
function FlashcardsMethodPage({
  method,
}: {
  method: (typeof LEARN_METHODS)[number];
}) {
  const { t } = useTranslation();
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const book = useBook();
  const createQuiz = useQuizStore((s) => s.createQuiz);
  const [creating, setCreating] = useState(false);
  const Icon = method.icon;

  const handleGenerate = async () => {
    if (creating) return;
    setCreating(true);
    const isUploaded = book.source === "uploaded";
    const title = book.book.title
      ? t("book.overview.generate.defaultFlashTitle", { book: book.book.title })
      : t("book.overview.generate.defaultFlashTitleNoBook");
    const id = await createQuiz({
      title,
      description: null,
      visibility: "private",
      uploaded_book_id: isUploaded ? book.book.id : null,
      catalog_book_id: !isUploaded ? book.book.id : null,
      questions: [],
    });
    setCreating(false);
    if (id) navigate(`/quizzes/${id}/edit?aiOpen=1&kind=short_answer`);
  };

  return (
    <div className="space-y-4">
      <Link
        to={`/books/${bookId}/learn`}
        className="inline-flex items-center gap-1.5 text-xs text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft size={12} />
        {t("learnHub.backToHub", { defaultValue: "Learn hub" })}
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon size={20} />
        </div>
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {method.label}
          </h2>
          <p className="text-xs text-text-muted">{method.tagline}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={handleGenerate} disabled={creating}>
          {creating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Sparkles size={16} />
          )}
          {t("learnHub.flashcards.generate", {
            defaultValue: "Generate flashcards with AI",
          })}
        </Button>
        <Button variant="secondary" onClick={() => navigate("/vocabulary")}>
          <BookMarked size={16} />
          {t("learnHub.flashcards.vocabDeck", {
            defaultValue: "Vocabulary deck",
          })}
        </Button>
      </div>

      <p className="text-xs text-text-muted">
        {t("learnHub.flashcards.hint", {
          defaultValue:
            "Flashcards are saved as short-answer quizzes below. Open one to review its cards.",
        })}
      </p>

      <BookQuizzesList
        catalogBookId={book.source === "catalog" ? book.book.id : undefined}
        uploadedBookId={book.source === "uploaded" ? book.book.id : undefined}
      />
    </div>
  );
}
