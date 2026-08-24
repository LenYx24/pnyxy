import type { TFunction } from "i18next";

interface ConfirmOptions {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/**
 * Show the "verify this AI-suggested URL before opening" confirmation
 * dialog. Surfaces the actual href so the user can spot obvious
 * problems (typosquats, unrelated domains, suspicious paths) before
 * any navigation happens. Used by both the ChatPage and the reader's
 * AiChatPanel, each passes their own `confirm` handle from
 * `useConfirm()` and their own `t` from `useTranslation()`.
 */
export async function promptOpenAiLink(
  url: string,
  confirm: ConfirmFn,
  t: TFunction,
): Promise<void> {
  const ok = await confirm({
    title: t("chat.linkWarning.title", { defaultValue: "Open this link?" }),
    body: (
      <div className="space-y-3 text-sm text-text-secondary">
        <p>
          {t("chat.linkWarning.body", {
            defaultValue:
              "The AI suggested this URL. AI models can hallucinate links, verify the domain looks right before opening.",
          })}
        </p>
        <p className="break-all rounded bg-bg-primary/40 p-2 font-mono text-xs text-text-primary">
          {url}
        </p>
      </div>
    ),
    confirmLabel: t("chat.linkWarning.open", {
      defaultValue: "Open in new tab",
    }),
  });
  if (ok) {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
