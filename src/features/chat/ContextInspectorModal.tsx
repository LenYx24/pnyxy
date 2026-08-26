/**
 * "What does the AI get?" inspector: shows the parts the next turn's
 * system prompt is assembled from (base prompt flavor, teacher mode,
 * the resolved AI-context preset, attached document context). A client
 * mirror of what the proxy builds server-side, so the user can audit
 * the context instead of guessing.
 */
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { TEACHER_GUARDRAIL, TEACHER_MODE_ENABLED } from "@/lib/ai/teacher-mode";
import { resolveAiContextForConversation } from "@/features/settings/ai-context/resolve-runtime";
import { cn } from "@/lib/cn";

interface ContextInspectorModalProps {
  open: boolean;
  onClose: () => void;
  docId: string | null;
  docTitle: string | null;
  /** Pages currently attached to the AI (reader selection). */
  selectedPages: number;
  conversationId: string | null;
}

function Section({
  title,
  chip,
  children,
}: {
  title: string;
  chip?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-2xs font-semibold uppercase tracking-[0.06em] text-text-muted-2">
          {title}
        </h3>
        {chip && (
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-2xs font-medium text-accent">
            {chip}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

const SOURCE_LABEL: Record<string, { key: string; fallback: string }> = {
  override: { key: "sourceOverride", fallback: "picked for this conversation" },
  book: { key: "sourceBook", fallback: "bound to this book" },
  folder: { key: "sourceFolder", fallback: "bound to its folder" },
  org: { key: "sourceOrg", fallback: "bound to the organization" },
  default: { key: "sourceDefault", fallback: "default preset" },
};

export function ContextInspectorModal({
  open,
  onClose,
  docId,
  docTitle,
  selectedPages,
  conversationId,
}: ContextInspectorModalProps) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const resolved = resolveAiContextForConversation({ docId, conversationId });
  const sourceMeta = resolved ? SOURCE_LABEL[resolved.source] : null;

  const preClass =
    "menu-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded-control bg-bg-secondary px-3 py-2 font-mono text-[11px] leading-relaxed text-text-secondary";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col rounded-page bg-bg-tertiary p-6 shadow-page">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            {t("chat.contextInspector.title", {
              defaultValue: "What does the AI get?",
            })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-control p-1 text-text-muted transition-colors hover:text-text-primary cursor-pointer"
            aria-label={t("common.close", { defaultValue: "Close" })}
          >
            <X size={18} strokeWidth={1.5} />
          </button>
        </div>
        <p className="mb-4 text-xs text-text-muted">
          {t("chat.contextInspector.intro", {
            defaultValue:
              "The next message's system prompt is assembled from these parts (the exact text is built on the server, this is its mirror).",
          })}
        </p>

        <div className="menu-scroll -mx-2 flex-1 space-y-5 overflow-y-auto px-2">
          <Section
            title={t("chat.contextInspector.base", { defaultValue: "Base prompt" })}
          >
            <p className="text-sm text-text-secondary">
              {docId
                ? t("chat.contextInspector.baseDoc", {
                    defaultValue:
                      "Document Q&A tutor: answers cite pages ([p.N]), markdown formatting, replies in your language.",
                  })
                : t("chat.contextInspector.baseChat", {
                    defaultValue:
                      "General study chat: markdown formatting, honesty rules, replies in your language.",
                  })}
            </p>
          </Section>

          <Section
            title={t("chat.contextInspector.teacher", { defaultValue: "Teacher mode" })}
            chip={
              TEACHER_MODE_ENABLED
                ? t("chat.contextInspector.active", { defaultValue: "Active" })
                : undefined
            }
          >
            <pre className={preClass}>{TEACHER_GUARDRAIL}</pre>
          </Section>

          <Section
            title={t("chat.contextInspector.preset", {
              defaultValue: "AI context preset",
            })}
            chip={
              resolved && sourceMeta
                ? t(`chat.contextInspector.${sourceMeta.key}`, {
                    defaultValue: sourceMeta.fallback,
                  })
                : undefined
            }
          >
            {resolved ? (
              <>
                <p className="text-sm font-medium text-text-primary">
                  {resolved.preset.name}
                </p>
                <pre className={preClass}>{resolved.preset.body}</pre>
              </>
            ) : (
              <p className="text-sm text-text-muted">
                {t("chat.contextInspector.noPreset", {
                  defaultValue: "No preset applies to this conversation.",
                })}
              </p>
            )}
          </Section>

          <Section
            title={t("chat.contextInspector.doc", {
              defaultValue: "Document context",
            })}
          >
            {docId ? (
              <p className="text-sm text-text-secondary">
                <span className={cn("font-medium text-text-primary")}>
                  {docTitle}
                </span>
                {" · "}
                {t("chat.contextInspector.pages", {
                  defaultValue: "{{count}} attached pages",
                  count: selectedPages,
                })}
              </p>
            ) : (
              <p className="text-sm text-text-muted">
                {t("chat.contextInspector.noDoc", {
                  defaultValue: "No document attached to this conversation.",
                })}
              </p>
            )}
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
