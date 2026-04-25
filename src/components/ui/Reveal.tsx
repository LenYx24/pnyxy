import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface RevealProps {
  children: ReactNode;
  /** Delay before the animation starts, in ms. Useful for staggered reveals. */
  delay?: number;
  /** Duration in ms. Default 600. */
  duration?: number;
  /** Direction the content slides in from. Default "up". */
  direction?: "up" | "down" | "left" | "right" | "none";
  className?: string;
  /** Threshold passed to IntersectionObserver. */
  threshold?: number;
}

const SHIFT = "1.25rem";

/**
 * Reveals its children with a fade + slide animation when it enters the
 * viewport. Pure CSS — no animation library, just IntersectionObserver
 * triggering a one-shot transition.
 *
 * Falls back to "always visible" when IntersectionObserver isn't
 * available (very old browsers) and when prefers-reduced-motion is set.
 */
function shouldStartVisible(): boolean {
  if (typeof window === "undefined") return true;
  if (!("IntersectionObserver" in window)) return true;
  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return true;
  }
  return false;
}

export function Reveal({
  children,
  delay = 0,
  duration = 600,
  direction = "up",
  className,
  threshold = 0.15,
}: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Initialise from a synchronous capability check so the effect doesn't
  // need to flip state on mount in the fallback paths (no-op observer
  // environments + users who prefer reduced motion).
  const [visible, setVisible] = useState(shouldStartVisible);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true);
            observer.disconnect();
            break;
          }
        }
      },
      { threshold, rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, visible]);

  const initialTransform =
    direction === "up"
      ? `translateY(${SHIFT})`
      : direction === "down"
        ? `translateY(-${SHIFT})`
        : direction === "left"
          ? `translateX(${SHIFT})`
          : direction === "right"
            ? `translateX(-${SHIFT})`
            : "none";

  const style: CSSProperties = {
    transitionProperty: "opacity, transform",
    transitionDuration: `${duration}ms`,
    transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)",
    transitionDelay: `${delay}ms`,
    opacity: visible ? 1 : 0,
    transform: visible ? "none" : initialTransform,
    willChange: "opacity, transform",
  };

  return (
    <div ref={ref} className={cn(className)} style={style}>
      {children}
    </div>
  );
}
