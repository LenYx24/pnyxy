import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const MARGIN = 8;

interface FloatingMenuProps {
  open: boolean;
  /** Right-aligned to this element, placed below (flips above when no room). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  /** Forwarded to the menu container so hover-triggered parents can track the portaled menu. */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  /** "bottom" (default): dropdown below the anchor. "right": side flyout
   *  to the right of the anchor, top-aligned, used by the collapsed
   *  sidebar rail, where a dropdown would have no width. Both flip to the
   *  opposite side when the viewport has no room. */
  placement?: "bottom" | "right";
}

/** Menu rendered into document.body to escape clipping ancestors; positioned from the anchor rect. */
export function FloatingMenu({
  open,
  anchorRef,
  onClose,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
  placement = "bottom",
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  // Render off-screen until positioned so the top-left default doesn't flash.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Side flyout: sit to the right of the anchor, top-aligned. Flip to the
    // left when the right side would overflow; clamp/cap vertically so a tall
    // menu scrolls instead of running off-screen.
    if (placement === "right") {
      let left = a.right + 4;
      if (left + m.width > vw - MARGIN) {
        const leftSide = a.left - m.width - 4;
        left = leftSide >= MARGIN ? leftSide : Math.max(MARGIN, vw - m.width - MARGIN);
      }
      let top = a.top;
      let maxHeight = m.height;
      if (m.height > vh - 2 * MARGIN) {
        top = MARGIN;
        maxHeight = vh - 2 * MARGIN;
      } else if (top + m.height > vh - MARGIN) {
        top = vh - m.height - MARGIN;
      }
      setPos({ left, top, maxHeight });
      return;
    }

    // right-align with trigger, place below
    let left = a.right - m.width;
    let top = a.bottom + 4;

    // clamp inside viewport
    if (left < MARGIN) left = MARGIN;
    if (left + m.width > vw - MARGIN) left = vw - m.width - MARGIN;

    // pick the side with more room; cap height there so tall menus scroll instead of clipping
    const spaceBelow = vh - a.bottom - 4 - MARGIN;
    const spaceAbove = a.top - 4 - MARGIN;
    let maxHeight: number;
    if (m.height <= spaceBelow) {
      maxHeight = m.height;
    } else if (m.height <= spaceAbove) {
      top = a.top - m.height - 4;
      maxHeight = m.height;
    } else if (spaceBelow >= spaceAbove) {
      maxHeight = Math.max(spaceBelow, 120);
    } else {
      top = MARGIN;
      maxHeight = Math.max(spaceAbove, 120);
    }

    setPos({ left, top, maxHeight });
  }, [open, anchorRef, placement]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // close on ancestor scroll, but ignore scrolls inside the menu so tall menus can scroll internally
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      onClose();
    };
    const onResize = () => onClose();
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
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      onContextMenu={(e) => e.preventDefault()}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        // overflow-y-auto + maxHeight lets tall menus scroll instead of clipping
        "fixed z-[100] min-w-[11rem] overflow-x-hidden overflow-y-auto rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-xl backdrop-blur-xl",
        className,
      )}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        maxHeight: pos?.maxHeight,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
