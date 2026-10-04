/**
 * Runs a ```pnyxy-sim document from an AI reply. The code lives in a
 * sandboxed iframe (scripts only: opaque origin, so no cookies, storage,
 * app DOM or same-origin requests) served from /sim-runner.html, whose own
 * CSP also blocks network access. The runner announces itself, then gets
 * the HTML by postMessage.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Code2, Maximize2, Minimize2, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { InlineSim } from "@/lib/ai/extract-sim";

export function InlineSimCard({ sim }: { sim: InlineSim }) {
  const { t } = useTranslation();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [runKey, setRunKey] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || e.source !== frame.contentWindow) return;
      if ((e.data as { type?: string })?.type !== "pnyxy-sim-ready") return;
      frame.contentWindow?.postMessage({ type: "pnyxy-sim", html: sim.html }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [sim.html, runKey]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const iconBtn =
    "flex h-7 w-7 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer";

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-panel bg-bg-tertiary",
        expanded && "fixed inset-4 z-50 shadow-page",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <Play size={13} strokeWidth={1.5} className="shrink-0 text-text-muted" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary">
          {sim.title || t("chat.inlineSim.title")}
        </span>
        <button
          type="button"
          className={iconBtn}
          onClick={() => setRunKey((k) => k + 1)}
          title={t("chat.inlineSim.restart")}
          aria-label={t("chat.inlineSim.restart")}
        >
          <RotateCcw size={14} />
        </button>
        <button
          type="button"
          className={cn(iconBtn, showCode && "text-text-primary")}
          onClick={() => setShowCode((v) => !v)}
          title={t("chat.inlineSim.code")}
          aria-label={t("chat.inlineSim.code")}
          aria-pressed={showCode}
        >
          <Code2 size={14} />
        </button>
        <button
          type="button"
          className={iconBtn}
          onClick={() => setExpanded((v) => !v)}
          title={t(expanded ? "chat.inlineSim.collapse" : "chat.inlineSim.expand")}
          aria-label={t(expanded ? "chat.inlineSim.collapse" : "chat.inlineSim.expand")}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>
      {showCode ? (
        <pre className="max-h-[440px] overflow-auto bg-bg-secondary px-3 py-2 text-2xs leading-relaxed text-text-secondary">
          <code>{sim.html}</code>
        </pre>
      ) : (
        <iframe
          key={runKey}
          ref={frameRef}
          src="/sim-runner.html"
          sandbox="allow-scripts"
          title={sim.title || t("chat.inlineSim.title")}
          className={cn("w-full border-0 bg-white", expanded ? "flex-1" : "h-[440px]")}
        />
      )}
    </div>
  );
}
