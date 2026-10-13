import { useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, Check, ChevronDown, Loader2, X } from "lucide-react";
import type { AgentRef, AgentStep } from "@/lib/ai/agent-blocks";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { cn } from "@/lib/cn";
import { showToast } from "@/stores/toast-store";
import { REF_ICONS, performUndo, refHref } from "./agent-items";
import { FolderItemList } from "./MiniLibrary";

const KNOWN_OPS = new Set([
  "search_library",
  "create_folder",
  "move_item",
  "create_chat",
  "create_note",
  "web_search",
  "offer_whiteboard",
]);

/** Clickable library path; folders show their contents on hover. */
export function PathChip({ refItem }: { refItem: AgentRef }) {
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const [peek, setPeek] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const Icon = REF_ICONS[refItem.k];
  const href = refHref(refItem);
  const chip =
    "inline-flex h-6 max-w-full items-center gap-1.5 rounded-chip bg-bg-tertiary px-2.5 align-middle text-xs text-text-primary transition-colors hover:bg-surface-3";
  const inner = (
    <>
      <Icon size={13} strokeWidth={1.6} className="shrink-0 text-accent" />
      <span className="truncate">{refItem.label}</span>
    </>
  );
  if (!href) return <span className={chip}>{inner}</span>;
  if (refItem.k === "url") {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={chip}>
        {inner}
      </a>
    );
  }
  const open = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setPeek(true);
  };
  const close = () => {
    closeTimer.current = window.setTimeout(() => setPeek(false), 150);
  };
  return (
    <>
      <Link
        ref={anchorRef}
        to={href}
        className={chip}
        onMouseEnter={refItem.k === "folder" ? open : undefined}
        onMouseLeave={refItem.k === "folder" ? close : undefined}
      >
        {inner}
      </Link>
      {refItem.k === "folder" && (
        <FloatingMenu
          open={peek}
          anchorRef={anchorRef}
          onClose={() => setPeek(false)}
          onMouseEnter={open}
          onMouseLeave={close}
          className="w-72 p-2"
        >
          <FolderItemList folderId={refItem.id} max={8} />
        </FloatingMenu>
      )}
    </>
  );
}

function StepRow({
  step,
  onUndo,
}: {
  step: AgentStep;
  onUndo?: () => void;
}) {
  const { t } = useTranslation();
  const label = KNOWN_OPS.has(step.op)
    ? t(`chat.agent.steps.${step.op}`)
    : t("chat.agent.steps.generic", { op: step.op });
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm leading-6 text-text-secondary">
      <span
        className={cn(
          "mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full",
          step.run
            ? "bg-accent-soft text-accent"
            : step.ok
              ? "bg-success/15 text-success"
              : "bg-danger/15 text-danger",
        )}
      >
        {step.run ? (
          <Loader2 size={11} className="animate-spin" />
        ) : step.ok ? (
          <Check size={11} strokeWidth={3} />
        ) : (
          <X size={11} strokeWidth={3} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <span className={cn(step.undone && "line-through opacity-60")}>{label}</span>
        {step.q && step.op !== "search_library" && (
          <span className="text-text-muted">{`: „${step.q}”`}</span>
        )}
        {step.refs?.map((r) => (
          <span key={`${r.k}:${r.id}`} className="ml-1.5 inline-block">
            <PathChip refItem={r} />
          </span>
        ))}
        {step.undo && !step.undone && onUndo && (
          <button
            type="button"
            onClick={onUndo}
            className="ml-2 cursor-pointer text-xs text-accent hover:underline"
          >
            {t("chat.agent.undo")}
          </button>
        )}
        {step.undone && (
          <span className="ml-2 text-xs text-text-muted">{t("chat.agent.undone")}</span>
        )}
      </div>
    </li>
  );
}

/**
 * The agent's activity log ("munkanapló"): every tool step of the turn,
 * open while it runs, folded to one line once the turn is done.
 */
export function AgentLog({
  steps,
  isStreaming,
  onMarkUndone,
}: {
  steps: AgentStep[];
  isStreaming: boolean;
  /** Persists the undone flag on the message; absent = no undo links. */
  onMarkUndone?: (index: number) => void;
}) {
  const { t } = useTranslation();
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? isStreaming;
  const seconds = Math.max(
    1,
    Math.round(steps.reduce((sum, s) => sum + (s.ms ?? 0), 0) / 1000),
  );

  const undo = async (index: number) => {
    const u = steps[index]?.undo;
    if (!u) return;
    const ok = await performUndo(u).catch(() => false);
    if (!ok) {
      showToast(t("chat.agent.undoFailed"), "error");
      return;
    }
    onMarkUndone?.(index);
  };

  return (
    <div className="mb-3 rounded-panel bg-bg-secondary px-3.5 pb-1">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2 py-2.5 text-left text-sm font-medium text-text-secondary"
      >
        <Activity size={15} strokeWidth={1.6} className="shrink-0" />
        {t("chat.agent.log")}
        <span className="font-normal text-text-muted">
          {" · "}
          {t("chat.agent.stepCount", { count: steps.length })}
          {!isStreaming && ` · ${t("chat.agent.seconds", { count: seconds })}`}
        </span>
        <ChevronDown
          size={15}
          className={cn("ml-auto shrink-0 text-text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <ul className="border-t border-surface-3 pb-1.5 pt-1">
          {steps.map((s, i) => (
            <StepRow
              key={i}
              step={s}
              onUndo={onMarkUndone && !isStreaming ? () => void undo(i) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
