import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isDivider,
  useContextMenuStore,
  type ContextMenuEntry,
  type ContextMenuItem,
} from "@/stores/context-menu-store";

const MENU_MARGIN = 8;
// submenu overlaps its parent row a little so the pointer crosses no gap
const SUB_OVERLAP = 4;

interface OpenSub {
  id: string;
  items: ContextMenuEntry[];
  /** The parent row's rect, the submenu is placed against it. */
  anchor: DOMRect;
  /** Opened from the keyboard: focus its first row. */
  focus: boolean;
}

/** Focus the next/previous enabled row inside `menu`. */
function moveFocus(menu: HTMLElement | null, dir: 1 | -1) {
  if (!menu) return;
  const rows = Array.from(
    menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
  );
  if (rows.length === 0) return;
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next = at === -1 ? (dir === 1 ? 0 : rows.length - 1) : (at + dir + rows.length) % rows.length;
  rows[next].focus();
}

/**
 * Portal-rendered floating context menu. Reads its open state, position
 * and items from `useContextMenuStore`. Mount once at the app root
 * (AppLayout), `useContextMenu()` opens it from anywhere. Rows with
 * `children` open a submenu to the side (hover, click or ArrowRight);
 * arrows move between rows, ArrowLeft/Escape step back out.
 */
export function ContextMenu() {
  const { visible, x, y, items, close } = useContextMenuStore();
  const ref = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<OpenSub | null>(null);
  const [subPos, setSubPos] = useState<{ left: number; top: number } | null>(null);

  // Measure once after open and reposition so the menu fits inside the
  // viewport even when the click was near a screen edge.
  useLayoutEffect(() => {
    if (!visible) {
      setPos(null);
      setSub(null);
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

  // Submenu: right of its row, flipped to the left when it would overflow.
  useLayoutEffect(() => {
    if (!sub) {
      setSubPos(null);
      return;
    }
    const el = subRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = sub.anchor.right - SUB_OVERLAP;
    if (left + w + MENU_MARGIN > vw) left = sub.anchor.left - w + SUB_OVERLAP;
    let top = sub.anchor.top - 4;
    if (top + h + MENU_MARGIN > vh) top = vh - h - MENU_MARGIN;
    setSubPos({ left: Math.max(MENU_MARGIN, left), top: Math.max(MENU_MARGIN, top) });
    if (sub.focus) requestAnimationFrame(() => moveFocus(subRef.current, 1));
  }, [sub]);

  // Close on outside click, Escape, scroll, or window resize.
  useEffect(() => {
    if (!visible) return;
    const inside = (target: Node | null) =>
      !!target && (!!ref.current?.contains(target) || !!subRef.current?.contains(target));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape steps out of an open submenu first
      if (subRef.current?.contains(document.activeElement)) return;
      close();
    };
    // Ignore scrolls inside the menu itself; otherwise long menus
    // that need internal scrolling self-dismiss on the first wheel
    // tick, which reads to users as a phantom close.
    const onScroll = (e: Event) => {
      if (inside(e.target as Node | null)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [visible, close]);

  if (!visible) return null;
  if (typeof document === "undefined") return null;

  const openSub = (item: ContextMenuItem, row: HTMLElement, focus: boolean) => {
    if (!item.children || item.disabled) return;
    if (sub?.id === item.id && !focus) return;
    setSub({ id: item.id, items: item.children, anchor: row.getBoundingClientRect(), focus });
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, level: "root" | "sub") => {
    const menu = level === "root" ? ref.current : subRef.current;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(menu, e.key === "ArrowDown" ? 1 : -1);
    } else if (level === "sub" && (e.key === "ArrowLeft" || e.key === "Escape")) {
      e.preventDefault();
      e.stopPropagation();
      const parentId = sub?.id;
      setSub(null);
      ref.current
        ?.querySelector<HTMLButtonElement>(`[data-row-id="${parentId}"]`)
        ?.focus();
    }
  };

  const renderRows = (entries: ContextMenuEntry[], level: "root" | "sub") =>
    entries.map((entry) =>
      isDivider(entry) ? (
        <div key={entry.id} role="separator" className="my-1 h-px bg-surface-3" />
      ) : (
        <ContextMenuRow
          key={entry.id}
          item={entry}
          expanded={sub?.id === entry.id}
          onSelect={close}
          onHover={(row) => {
            if (level !== "root") return;
            if (entry.children) openSub(entry, row, false);
            else setSub(null);
          }}
          onOpenSub={(row, focus) => openSub(entry, row, focus)}
        />
      ),
    );

  return createPortal(
    <>
      <div
        ref={ref}
        role="menu"
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => onMenuKeyDown(e, "root")}
        className={cn(
          "fixed z-[100] min-w-[12rem] overflow-hidden rounded-panel bg-bg-tertiary py-1 shadow-page",
          pos && "pop-in origin-top-left",
        )}
        style={{
          // Render off-screen on the first paint, then `pos` settles after
          // measurement. Avoids flash at top-left.
          left: pos ? pos.left : -9999,
          top: pos ? pos.top : -9999,
        }}
      >
        {renderRows(items, "root")}
      </div>
      {sub && (
        <div
          ref={subRef}
          role="menu"
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={(e) => onMenuKeyDown(e, "sub")}
          className="fixed z-[101] min-w-[11rem] overflow-hidden rounded-panel bg-bg-tertiary py-1 shadow-page outline outline-1 outline-surface-3"
          style={{
            left: subPos ? subPos.left : -9999,
            top: subPos ? subPos.top : -9999,
          }}
        >
          {renderRows(sub.items, "sub")}
        </div>
      )}
    </>,
    document.body,
  );
}

function ContextMenuRow({
  item,
  expanded,
  onSelect,
  onHover,
  onOpenSub,
}: {
  item: ContextMenuItem;
  expanded: boolean;
  onSelect: () => void;
  onHover: (row: HTMLElement) => void;
  onOpenSub: (row: HTMLElement, focus: boolean) => void;
}) {
  const Icon = item.icon;
  const hasSub = !!item.children;
  return (
    <button
      type="button"
      role="menuitem"
      data-row-id={item.id}
      aria-haspopup={hasSub ? "menu" : undefined}
      aria-expanded={hasSub ? expanded : undefined}
      disabled={item.disabled}
      onMouseEnter={(e) => onHover(e.currentTarget)}
      onKeyDown={(e) => {
        if (hasSub && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpenSub(e.currentTarget, true);
        }
      }}
      onClick={(e) => {
        if (item.disabled) return;
        if (hasSub) {
          onOpenSub(e.currentTarget, false);
          return;
        }
        item.onClick();
        onSelect();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-sm outline-none transition-colors",
        item.disabled
          ? "cursor-not-allowed text-text-muted/50"
          : item.danger
            ? "text-danger hover:bg-danger/10 focus-visible:bg-danger/10 cursor-pointer"
            : cn(
                "text-text-secondary hover:bg-glass-hover hover:text-text-primary focus-visible:bg-glass-hover focus-visible:text-text-primary cursor-pointer",
                expanded && "bg-glass-hover text-text-primary",
              ),
      )}
    >
      {Icon && (
        <Icon size={14} className={cn("shrink-0", item.accent && !item.disabled && "text-accent")} />
      )}
      <span className="flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <span className="shrink-0 pl-3 font-mono text-2xs text-text-muted">{item.shortcut}</span>
      )}
      {hasSub && <ChevronRight size={14} className="shrink-0 text-text-muted" />}
    </button>
  );
}
