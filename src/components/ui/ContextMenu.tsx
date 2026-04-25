import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  isDivider,
  useContextMenuStore,
  type ContextMenuItem,
} from "@/stores/context-menu-store";

const MENU_MARGIN = 8;

/**
 * Portal-rendered floating context menu. Reads its open state, position
 * and items from `useContextMenuStore`. Mount once at the app root
 * (AppLayout) — `useContextMenu()` opens it from anywhere.
 */
export function ContextMenu() {
  const { visible, x, y, items, close } = useContextMenuStore();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Measure once after open and reposition so the menu fits inside the
  // viewport even when the click was near a screen edge.
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + MENU_MARGIN > vw) left = vw - rect.width - MENU_MARGIN;
    if (top + rect.height + MENU_MARGIN > vh) top = vh - rect.height - MENU_MARGIN;
    if (left < MENU_MARGIN) left = MENU_MARGIN;
    if (top < MENU_MARGIN) top = MENU_MARGIN;
    setPos({ left, top });
  }, [visible, x, y]);

  // Close on outside click, Escape, scroll, or window resize.
  useEffect(() => {
    if (!visible) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible, close]);

  if (!visible) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[100] min-w-[12rem] overflow-hidden rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-xl backdrop-blur-xl"
      style={{
        // Render off-screen on the first paint, then `pos` settles after
        // measurement. Avoids flash at top-left.
        left: pos ? pos.left : -9999,
        top: pos ? pos.top : -9999,
      }}
    >
      {items.map((entry) =>
        isDivider(entry) ? (
          <div
            key={entry.id}
            role="separator"
            className="my-1 h-px bg-glass-border"
          />
        ) : (
          <ContextMenuRow key={entry.id} item={entry} onSelect={close} />
        ),
      )}
    </div>,
    document.body,
  );
}

function ContextMenuRow({
  item,
  onSelect,
}: {
  item: ContextMenuItem;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onClick={() => {
        if (item.disabled) return;
        item.onClick();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
        item.disabled
          ? "cursor-not-allowed text-text-muted/50"
          : item.danger
            ? "text-red-400 hover:bg-red-500/10 cursor-pointer"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary cursor-pointer",
      )}
    >
      {Icon && <Icon size={14} className="shrink-0" />}
      <span className="flex-1 truncate">{item.label}</span>
    </button>
  );
}
