import { useCallback, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { useChatStore } from "@/stores/chat-store";
import { useBook } from "../BookPageContext";
import { LEARN_METHODS } from "../LEARN_METHODS";
import { COACH_SLUGS } from "./learn-coach-helpers";

interface CoachConfig {
  /** First-message framing the user can edit before sending. The
   *  AI sees this verbatim as the opening turn, so the methodology
   *  is established without us needing a per-conversation system
   *  prompt column on the DB — model picks up the persona from the
   *  user's framing and continues the role through the thread. */
  framing: (bookTitle: string) => string;
  /** Hint shown above the "Start" button so the user knows what
   *  to expect before they're dropped into a fresh conversation. */
  preview: string;
  /** Example to show in the body so the user has a sense of how to
   *  phrase their first explanation / question. */
  example: string;
}

const CONFIGS: Record<string, CoachConfig> = {
  feynman: {
    framing: (title) =>
      `[Feynman session — I'm going to teach you a concept from "${title}". Play a curious student: after each of my explanations, ask one specific clarifying question that probes the weakest part of what I just said. Keep it short — one question per turn.]\n\nI want to teach you about: `,
    preview:
      "You explain a concept; the AI plays a curious student who probes the weakest part.",
    example:
      "Tip: pick something from the book you almost get but not quite. The cracks are where the learning happens.",
  },
  socratic: {
    framing: (title) =>
      `[Socratic mode — instead of answering my question directly, ask me a single probing question that nudges me toward figuring it out myself. If I get stuck after two of your questions, then explain. Keep your questions short and specific. Use "${title}" as the source material.]\n\nMy question: `,
    preview:
      "The AI replies with questions, not answers — guiding you to the answer yourself.",
    example:
      "Tip: ask the question you'd normally Google. Socratic shines when there's something you don't fully grasp yet.",
  },
  eli5: {
    framing: (title) =>
      `[ELI5 mode — explain the following concept from "${title}" as if I were five years old. Use everyday analogies, avoid jargon, keep sentences short. After the explanation, give one tiny example a kid could relate to.]\n\nConcept: `,
    preview:
      "Get an explanation calibrated for a five-year-old — a quick check on whether you really got it.",
    example:
      "Tip: try a topic you can already explain to an adult. If the ELI5 version makes you laugh-cry, you've found a soft spot worth re-reading.",
  },
};

export function AiCoachMethodPage() {
  const navigate = useNavigate();
  const { bookId, methodSlug } = useParams<{
    bookId: string;
    methodSlug: string;
  }>();
  const book = useBook();
  const setPendingDraft = useChatStore((s) => s.setPendingDraft);

  const method = LEARN_METHODS.find((m) => m.slug === methodSlug);
  const config = methodSlug ? CONFIGS[methodSlug] : undefined;

  // The method picker on the right groups the three coach methods
  // together so users can switch without backing out to the hub —
  // the user explicitly asked for these three to feel grouped.
  const [hoverSlug, setHoverSlug] = useState<string | null>(null);

  const bookTitle =
    book.source === "catalog"
      ? book.book.title
      : book.book.title || "this book";
  const sourceDocId =
    book.source === "catalog" ? book.book.id : book.book.id;

  const handleStart = useCallback(() => {
    if (!config) return;
    setPendingDraft({
      text: config.framing(bookTitle),
      source: {
        docId: sourceDocId,
        docTitle: bookTitle,
        page: null,
      },
    });
    navigate("/chat");
  }, [config, bookTitle, sourceDocId, setPendingDraft, navigate]);

  if (!method || !config) {
    return (
      <div className="py-12 text-center">
        <p className="text-text-muted">Unknown learning method.</p>
        <Link
          to={`/books/${bookId}/learn`}
          className="mt-4 inline-flex items-center gap-2 text-sm text-accent-purple hover:underline"
        >
          <ArrowLeft size={14} />
          Back to Learn hub
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
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-purple/15 text-accent-purple">
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
        {config.preview}
      </p>

      <div className="rounded-xl border border-glass-border bg-glass-bg/40 p-4">
        <p className="text-xs leading-relaxed text-text-muted">
          {config.example}
        </p>
        <button
          type="button"
          onClick={handleStart}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent-purple px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-purple/90 cursor-pointer"
        >
          <MessagesSquare size={14} />
          Start in chat
        </button>
        <p className="mt-2 text-[10px] text-text-muted">
          Opens a fresh conversation tied to this book. The first
          message is pre-drafted with the methodology — you finish
          the sentence and hit send.
        </p>
      </div>

      {/* Quick-switch row for the three coaching styles. The user
          asked for these three to feel grouped together so flipping
          between them takes one click. */}
      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/20 p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">
          Other coaching styles
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Array.from(COACH_SLUGS)
            .filter((s) => s !== methodSlug)
            .map((slug) => {
              const m = LEARN_METHODS.find((mm) => mm.slug === slug);
              if (!m) return null;
              const MIcon = m.icon;
              return (
                <Link
                  key={slug}
                  to={`/books/${bookId}/learn/${slug}`}
                  onMouseEnter={() => setHoverSlug(slug)}
                  onMouseLeave={() => setHoverSlug(null)}
                  className="flex items-center gap-2 rounded-lg border border-glass-border bg-bg-primary/30 px-3 py-1.5 text-xs text-text-secondary transition-colors hover:border-accent-purple/40 hover:text-text-primary"
                >
                  <MIcon size={12} />
                  {m.label}
                  {hoverSlug === slug && (
                    <span className="text-[10px] text-text-muted">
                      — {m.tagline}
                    </span>
                  )}
                </Link>
              );
            })}
        </div>
      </div>
    </div>
  );
}
