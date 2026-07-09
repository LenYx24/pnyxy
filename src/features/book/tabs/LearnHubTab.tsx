import { Link, useParams } from "react-router";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { LEARN_METHODS } from "../LEARN_METHODS";

export function LearnHubTab() {
  const { bookId } = useParams<{ bookId: string }>();
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Sparkles size={14} />
          {t("learnHub.eyebrow", { defaultValue: "Learning tools" })}
        </div>
        <h2 className="mt-1 text-xl font-semibold text-text-primary">
          {t("learnHub.title", { defaultValue: "Practice what you've read" })}
        </h2>
        <p className="mt-1 text-sm text-text-secondary">
          {t("learnHub.subtitle", {
            defaultValue:
              "Choose a study method to review and reinforce this book.",
          })}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LEARN_METHODS.map((m) => (
          <Link
            key={m.slug}
            to={`/books/${bookId}/learn/${m.slug}`}
            className="group relative overflow-hidden rounded-xl border border-glass-border bg-glass-bg/50 p-4 transition-all hover:border-accent/50 hover:bg-glass-hover"
          >
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/15 text-accent">
                <m.icon size={18} />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-text-primary">
                  {m.label}
                </h3>
                <p className="truncate text-xs text-text-muted">{m.tagline}</p>
              </div>
              {m.status === "stub" && (
                <span className="ml-auto shrink-0 rounded-full bg-glass-bg px-2 py-0.5 text-2xs font-medium text-text-muted">
                  Soon
                </span>
              )}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-text-secondary">
              {m.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
