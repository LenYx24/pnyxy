import { useEffect, useRef } from "react";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  PROACTIVE_RULES,
  normalizeProactiveLevel,
  useTutorNudgeStore,
} from "@/stores/tutor-nudge-store";

const TICK_MS = 5_000;
// The "stuck" clock only runs while the user is around: no input for this
// long and the time stops counting (reading is quiet, but not this quiet).
const IDLE_AFTER_MS = 3 * 60_000;
// A resume offer only makes sense with real progress behind it.
const RESUME_MIN_PAGE = 6;

/**
 * Decides when the reader's tutor speaks up uninvited. Pure rules on the
 * client: time spent on one page and the gap since the last read session.
 * The nudge itself is rendered by the AI chat panel.
 */
export function useTutorNudges(): void {
  const level = normalizeProactiveLevel(
    useSettingsStore((s) => s.aiProactiveLevel),
  );
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const currentPage = useReaderStore((s) =>
    s.activeDocumentId
      ? (s.documents.get(s.activeDocumentId)?.currentPage ?? null)
      : null,
  );
  const lastReadAt = useReaderStore((s) =>
    s.activeDocumentId
      ? (s.documents.get(s.activeDocumentId)?.lastReadAt ?? null)
      : null,
  );

  // one offer of each kind per page / per document visit
  const stuckOfferedRef = useRef(new Set<string>());
  const resumeOfferedRef = useRef(new Set<string>());

  useEffect(() => {
    if (level === "off") useTutorNudgeStore.getState().clear();
  }, [level]);

  // a nudge about another book is stale once the user switches
  useEffect(() => {
    const { nudge, clear } = useTutorNudgeStore.getState();
    if (nudge && nudge.docId !== activeDocumentId) clear();
  }, [activeDocumentId]);

  // resume: offered once when a book is reopened after a break
  useEffect(() => {
    if (level === "off" || !activeDocumentId || !lastReadAt) return;
    if (currentPage === null || currentPage < RESUME_MIN_PAGE) return;
    if (resumeOfferedRef.current.has(activeDocumentId)) return;
    const rules = PROACTIVE_RULES[level];
    const daysAgo = (Date.now() - new Date(lastReadAt).getTime()) / 86_400_000;
    if (!(daysAgo >= rules.resumeAfterDays)) return;
    resumeOfferedRef.current.add(activeDocumentId);
    const store = useTutorNudgeStore.getState();
    if (store.nudge || !store.canNudge(rules)) return;
    store.show({ kind: "resume", docId: activeDocumentId, page: currentPage });
    // currentPage is read once at open on purpose: paging must not re-offer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, activeDocumentId, lastReadAt]);

  // stuck: visible, active time on the same page
  useEffect(() => {
    if (level === "off" || !activeDocumentId || currentPage === null) return;
    const key = `${activeDocumentId}:${currentPage}`;
    if (stuckOfferedRef.current.has(key)) return;
    const rules = PROACTIVE_RULES[level];

    let onPageMs = 0;
    let lastInput = Date.now();
    const markActive = () => {
      lastInput = Date.now();
    };
    const events = ["pointermove", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, markActive, { passive: true });

    const interval = setInterval(() => {
      if (document.hidden || Date.now() - lastInput > IDLE_AFTER_MS) return;
      onPageMs += TICK_MS;
      if (onPageMs < rules.stuckAfterMs) return;
      clearInterval(interval);
      stuckOfferedRef.current.add(key);
      const store = useTutorNudgeStore.getState();
      if (store.nudge || !store.canNudge(rules)) return;
      store.show({ kind: "stuck", docId: activeDocumentId, page: currentPage });
    }, TICK_MS);

    return () => {
      clearInterval(interval);
      for (const e of events) window.removeEventListener(e, markActive);
    };
  }, [level, activeDocumentId, currentPage]);
}
