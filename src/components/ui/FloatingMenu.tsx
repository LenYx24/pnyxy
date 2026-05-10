import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const MARGIN = 8;

interface FloatingMenuProps {
  open: boolean;
  /** Element the menu anchors to. The menu's right edge aligns with
   *  the anchor's right edge and it appears just below the anchor.
   *  When there's no room below, it flips above. */
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  children: ReactNode;
  /** Hover handlers forwarded to the menu container. Lets a
   *  hover-triggered parent track when the cursor enters/leaves the
   *  portaled menu (since it's not a DOM child of the anchor). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

/**
 * Portal-rendered floating menu — escapes any clipping ancestor
 * (`overflow-hidden`, `overflow-x-auto`, etc.) by rendering directly
 * into `document.body`. Position is computed in a layout effect from
 * the anchor's bounding rect so the menu visually feels attached to
 * the trigger.
 *
 * Uses the same close-on-outside-pointerdown / Escape / scroll /
 * resize semantics as the global `ContextMenu` so the two feel
 * identical to the user.
 */
export function FloatingMenu({
  open,
  anchorRef,
  onClose,
  className,
  children,
  onMouseEnter,
  onMouseLeave,
}: FloatingMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Position the menu relative to the anchor after both are mounted.
  // Render off-screen on the first paint so the un-positioned default
  // (top-left) doesn't briefly flash where the user isn't looking.
  // The menu unmounts when `open` flips to false (we return null
  // below), so leftover `pos` state doesn't matter — the next open
  // re-runs this effect synchronously before paint and overwrites it.
  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const a = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Right-align with the trigger and place just below.
    let left = a.right - m.width;
    let top = a.bottom + 4;

    // Clamp inside the viewport.
    if (left < MARGIN) left = MARGIN;
    if (left + m.width > vw - MARGIN) left = vw - m.width - MARGIN;

    // Flip above the trigger if the menu would otherwise overflow
    // the bottom edge — and only if there's actually room above.
    if (top + m.height > vh - MARGIN) {
      const above = a.top - m.height - 4;
      top = above >= MARGIN ? above : MARGIN;
    }

    setPos({ left, top });
  }, [open, anchorRef]);

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
    const onScroll = () => onClose();
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    // Scrolling any ancestor would dislodge the menu's anchor — easiest
    // to just close. Same for window resize.
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
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
        "fixed z-[100] min-w-[11rem] overflow-hidden rounded-lg border border-glass-border bg-bg-secondary/95 py-1 shadow-xl backdrop-blur-xl",
        className,
      )}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
