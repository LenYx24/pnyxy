import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { getCatalogShortcut, type ShortcutSpec } from "@/lib/keyboard-shortcuts";
import { assignRef } from "./assign-ref";
import { Kbd } from "./Kbd";

type Side = "right" | "top" | "bottom" | "left";

interface TooltipProps {
  /** Tooltip text. When empty the child renders without a tooltip. */
  label: string;
  /** Which side of the trigger the bubble sits on. */
  side?: Side;
  /** Hover / focus delay before the bubble appears (ms). */
  delay?: number;
  /** Optional keyboard hint rendered as <Kbd> chips after the label.
   *  Either a catalog id ("app:new-chat") or an explicit spec. Hidden
   *  on touch / mobile (Kbd handles that). */
  shortcut?: string | ShortcutSpec;
  /** The trigger. Must accept a ref and DOM event props (any element
   *  or a component that forwards them, e.g. NavLink / button). */
  children: ReactElement<TriggerProps>;
}

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
  "aria-describedby"?: string;
}

const GAP = 8;
const SHOW_DELAY = 350;
const ANIM_MS = 120;

/**
 * Replacement for the native `title` attribute (UI v2). Portaled to
 * <body>, positioned next to the trigger with an 8 px gap, appears
 * after a short hover / focus delay and fades + slides in 4 px. The
 * bubble is announced via aria-describedby, and keyboard focus shows
 * it too. Honors prefers-reduced-motion (no slide, instant fade).
 */
export function Tooltip({
  label,
  side = "right",
  delay = SHOW_DELAY,
  shortcut,
  children,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // mounted: in the DOM; shown: the enter transition has been applied
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const open = useCallback(() => {
    clear();
    timer.current = setTimeout(() => setMounted(true), delay);
  }, [delay]);

  const close = useCallback(() => {
    clear();
    setShown(false);
    setMounted(false);
  }, []);

  // unmount safety
  useEffect(() => clear, []);

  // measure once mounted, then flip `shown` on the next frame so the
  // transition runs from the initial (hidden) state
  useLayoutEffect(() => {
    if (!mounted) return;
    const el = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!el || !bubble) return;
    const r = el.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    let left = 0;
    let top = 0;
    if (side === "right") {
      left = r.right + GAP;
      top = r.top + r.height / 2 - b.height / 2;
    } else if (side === "left") {
      left = r.left - GAP - b.width;
      top = r.top + r.height / 2 - b.height / 2;
    } else if (side === "top") {
      left = r.left + r.width / 2 - b.width / 2;
      top = r.top - GAP - b.height;
    } else {
      left = r.left + r.width / 2 - b.width / 2;
      top = r.bottom + GAP;
    }
    // keep inside the viewport
    left = Math.max(4, Math.min(left, window.innerWidth - b.width - 4));
    top = Math.max(4, Math.min(top, window.innerHeight - b.height - 4));
    setPos({ left, top });
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [mounted, side]);

  // hide on Escape and on scroll (the anchor moves)
  useEffect(() => {
    if (!mounted) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [mounted, close]);

  const shortcutSpec: ShortcutSpec | undefined =
    typeof shortcut === "string" ? getCatalogShortcut(shortcut) : shortcut;

  if (!label) return children;

  const childProps = children.props;
  // the child's own ref is only touched inside the ref callback, not in render
  // eslint-disable-next-line react-hooks/refs
  const trigger = cloneElement(children, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      assignRef(childProps.ref, node);
    },
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      open();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      close();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      open();
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      close();
    },
    onPointerDown: (e: React.PointerEvent) => {
      childProps.onPointerDown?.(e);
      close();
    },
    "aria-describedby": mounted ? id : childProps["aria-describedby"],
  });

  const slide =
    side === "right"
      ? "-translate-x-1"
      : side === "left"
        ? "translate-x-1"
        : side === "top"
          ? "translate-y-1"
          : "-translate-y-1";

  return (
    <>
      {trigger}
      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            style={{
              left: pos?.left ?? -9999,
              top: pos?.top ?? -9999,
              transitionDuration: `${ANIM_MS}ms`,
            }}
            className={cn(
              "pointer-events-none fixed z-[110] flex max-w-[16rem] items-center gap-2 whitespace-nowrap rounded-control bg-bg-tertiary px-2.5 py-1.5 text-xs font-medium text-text-primary shadow-page",
              "transition-[opacity,transform] ease-out motion-reduce:transition-none motion-reduce:transform-none",
              shown
                ? "opacity-100 translate-x-0 translate-y-0"
                : cn("opacity-0", slide),
            )}
          >
            <span>{label}</span>
            {shortcutSpec && <Kbd shortcut={shortcutSpec} variant="chips" />}
          </div>,
          document.body,
        )}
    </>
  );
}
