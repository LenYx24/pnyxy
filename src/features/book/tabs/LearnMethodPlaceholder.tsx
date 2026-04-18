import { Link, useParams } from "react-router";
import { ArrowLeft, Clock } from "lucide-react";
import { LEARN_METHODS } from "../LEARN_METHODS";

export function LearnMethodPlaceholder() {
  const { bookId, methodSlug } = useParams<{
    bookId: string;
    methodSlug: string;
  }>();
  const method = LEARN_METHODS.find((m) => m.slug === methodSlug);

  if (!method) {
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
        {method.description}
      </p>

      <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
        <Clock size={24} className="mx-auto mb-2 text-text-muted" />
        <p className="text-sm font-medium text-text-primary">Coming soon</p>
        <p className="mt-1 text-xs text-text-muted">
          Launching in Phase 1 of the learning-tools rollout.
        </p>
      </div>
    </div>
  );
}
