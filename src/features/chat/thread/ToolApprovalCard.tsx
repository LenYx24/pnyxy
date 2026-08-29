import { useTranslation } from "react-i18next";
import { FolderPlus, FolderInput, MessageSquarePlus, ShieldCheck, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui";
import { useToolApprovalStore } from "@/stores/tool-approval-store";

const TOOL_ICONS: Record<string, LucideIcon> = {
  create_folder: FolderPlus,
  move_item: FolderInput,
  create_chat: MessageSquarePlus,
};

/**
 * The "may I?" card for the library tool loop. Rendered at the bottom of
 * the thread while a write tool waits on the user; Apply / Apply-all /
 * Skip resolve the pending promise in tool-approval-store.
 */
export function ToolApprovalCard() {
  const { t } = useTranslation();
  const pending = useToolApprovalStore((s) => s.pending);
  const approve = useToolApprovalStore((s) => s.approve);
  const reject = useToolApprovalStore((s) => s.reject);
  if (!pending) return null;
  const Icon = TOOL_ICONS[pending.tool] ?? ShieldCheck;
  const toolLabel = t(`chat.toolApproval.tool_${pending.tool}`, {
    defaultValue: pending.tool,
  });
  return (
    <div
      role="alertdialog"
      aria-live="polite"
      className="mr-auto flex w-full max-w-[520px] items-start gap-3 rounded-panel border border-accent/30 bg-bg-tertiary px-3.5 py-3 shadow-page"
    >
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-accent/15 text-accent">
        <Icon size={16} strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-2xs font-semibold uppercase tracking-wide text-text-muted">
          {t("chat.toolApproval.title")} · {toolLabel}
        </p>
        <p className="mt-1 text-sm font-medium text-text-primary">{pending.summary}</p>
        {pending.details && pending.details.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-xs text-text-secondary">
            {pending.details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => approve(false)} autoFocus>
            {t("chat.toolApproval.approve")}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => approve(true)}>
            {t("chat.toolApproval.approveAll")}
          </Button>
          <Button size="sm" variant="ghost" onClick={reject}>
            {t("chat.toolApproval.reject")}
          </Button>
        </div>
      </div>
    </div>
  );
}
