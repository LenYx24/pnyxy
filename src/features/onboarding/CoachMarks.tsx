/**
 * Coach-mark tour: spotlights real UI elements and points a card + arrow at
 * each, instead of a context-free modal carousel. Steps target elements by a
 * `data-tour="<id>"` attribute, so they survive refactors as long as the
 * attribute stays. A step whose target isn't on the page is skipped, so the
 * same tour is safe across layouts (a control hidden on mobile just drops out).
 */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";

export interface CoachStep {
  /** Matches a `data-tour="<target>"` attribute on the element to highlight. */
  target: string;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const CARD_WIDTH = 300;
const CARD_EST_HEIGHT = 170;
const GAP = 12;
const PAD = 6;

function rectOf(target: string): Rect | null {
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function CoachMarks({
  steps,
  open,
  onDone,
}: {
  steps: CoachStep[];
  open: boolean;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const step = steps[index];

  // Resolve the current target's rect; retry briefly since the page may still
  // be settling when the tour opens. If it never appears, skip the step.
  useLayoutEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    let tries = 0;
    const tick = () => {
      const r = rectOf(step.target);
      if (r) {
        setRect(r);
        return;
      }
      if (tries++ > 30) {
        // target not on this page: drop the step
        setRect(null);
        setIndex((i) => (i + 1 < steps.length ? i + 1 : i));
        if (index + 1 >= steps.length) onDone();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, step?.target]);

  // Keep the spotlight glued to the target through scroll / resize.
  useEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    const reflow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = rectOf(step.target);
        if (r) setRect(r);
      });
    };
    window.addEventListener("resize", reflow);
    window.addEventListener("scroll", reflow, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reflow);
      window.removeEventListener("scroll", reflow, true);
    };
  }, [open, step]);

  const finish = useCallback(() => {
    setIndex(0);
    onDone();
  }, [onDone]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish]);

  if (!open || !step || typeof document === "undefined") return null;

  const isLast = index === steps.length - 1;
  const next = () => (isLast ? finish() : setIndex((i) => i + 1));

  // Card placement: below the target when there's room, else above; centered
  // on the target and clamped to the viewport.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let cardTop = vh / 2 - CARD_EST_HEIGHT / 2;
  let cardLeft = vw / 2 - CARD_WIDTH / 2;
  let arrow: "up" | "down" | null = null;
  if (rect) {
    const below = rect.top + rect.height + GAP;
    const roomBelow = vh - below >= CARD_EST_HEIGHT + GAP;
    if (roomBelow) {
      cardTop = below + PAD;
      arrow = "up";
    } else {
      cardTop = rect.top - GAP - CARD_EST_HEIGHT;
      arrow = "down";
    }
    cardLeft = rect.left + rect.width / 2 - CARD_WIDTH / 2;
    cardLeft = Math.max(8, Math.min(cardLeft, vw - CARD_WIDTH - 8));
    cardTop = Math.max(8, Math.min(cardTop, vh - CARD_EST_HEIGHT - 8));
  }

  return createPortal(
    <div className="fixed inset-0 z-[60]">
      {/* click-catcher so page clicks don't fight the tour */}
      <div className="absolute inset-0" onClick={finish} />

      {/* spotlight: a transparent hole over the target, everything else dimmed
          via a huge box-shadow */}
      {rect && (
        <div
          className="pointer-events-none absolute rounded-lg"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
            outline: "2px solid var(--color-accent, #6aa9ff)",
            outlineOffset: "2px",
            transition: "top 0.15s, left 0.15s, width 0.15s, height 0.15s",
          }}
        />
      )}
      {/* full dim when no target resolved yet (keeps the screen from flashing) */}
      {!rect && <div className="absolute inset-0 bg-black/60" />}

      {/* the card */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="coach-title"
        onClick={(e) => e.stopPropagation()}
        className="absolute w-[300px] rounded-xl border border-glass-border bg-bg-secondary/95 p-4 shadow-page backdrop-blur-xl"
        style={{ top: cardTop, left: cardLeft }}
      >
        {arrow && (
          <span
            aria-hidden
            className="absolute left-1/2 size-3 -translate-x-1/2 rotate-45 border-glass-border bg-bg-secondary"
            style={
              arrow === "up"
                ? { top: -6, borderTopWidth: 1, borderLeftWidth: 1 }
                : { bottom: -6, borderBottomWidth: 1, borderRightWidth: 1 }
            }
          />
        )}
        <button
          type="button"
          onClick={finish}
          aria-label={t("common.close")}
          className="absolute right-2.5 top-2.5 cursor-pointer rounded-md p-1 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
        >
          <X size={15} />
        </button>

        <h3
          id="coach-title"
          className="mb-1.5 pr-6 text-sm font-semibold text-text-primary"
        >
          {step.title}
        </h3>
        <p className="text-xs leading-relaxed text-text-muted">{step.body}</p>

        <div className="mt-3 flex items-center gap-1">
          {steps.map((_, i) => (
            <span
              key={i}
              className={
                i === index
                  ? "h-1.5 w-4 rounded-full bg-accent transition-all"
                  : "h-1.5 w-1.5 rounded-full bg-glass-border transition-all"
              }
            />
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={finish}
            className="cursor-pointer text-xs font-medium text-text-muted transition-colors hover:text-text-primary"
          >
            {t("onboarding.skip")}
          </button>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIndex((i) => i - 1)}
              >
                {t("onboarding.back")}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={next}>
              {isLast ? t("onboarding.done") : t("onboarding.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
