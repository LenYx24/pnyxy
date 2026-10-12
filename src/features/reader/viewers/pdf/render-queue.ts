// Admission control for page renders. The pdf.js worker runs requests one
// after another and keeps working on a page after its render is cancelled
// (its GetOperatorList handler has no cancel path), so every page mounted
// during a fast scrollbar drag was fully rendered in the worker even after
// it unmounted. On a 1000+ page scanned book that was ~300 pages x ~100 ms
// of backlog in front of the page the user actually stopped on. Like the
// pdf.js viewer's own rendering queue, only a few pages may render at once,
// the next slot goes to the page nearest the viewport, and a page has to
// stay mounted briefly before it is admitted at all.

export const MAX_CONCURRENT_RENDERS = 2;
// A slot mounted for less than this (a fast drag sweeps past a page in a
// frame or two) never reaches the worker.
const ADMIT_DELAY_MS = 120;
// An admitted page that unmounts mid-render is still being processed by the
// worker, so its slot stays taken for roughly one page's worth of work.
const ABANDONED_HOLD_MS = 150;
// A render that never reports back (lost callback, stuck page) must not
// hold its slot forever and stall every page after it.
const SLOT_TIMEOUT_MS = 4000;

export interface RenderQueue {
  /** Ask to render `pageNum`; `grant` runs once a slot is free. Returns a
   *  release function: `finished` true when the render completed, false
   *  when the page went away. Safe to call more than once. */
  request: (pageNum: number, grant: () => void) => (finished: boolean) => void;
  /** Source of the page the viewport is on, read whenever a slot frees. */
  setFocus: (focusPage: () => number) => void;
}

interface Entry {
  pageNum: number;
  grant: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  released: boolean;
}

export function createRenderQueue(
  maxConcurrent = MAX_CONCURRENT_RENDERS,
): RenderQueue {
  let focusPage = () => 1;
  const pending = new Set<Entry>();
  const waiting = new Set<Entry>();
  const active = new Set<Entry>();

  function freeSlot(entry: Entry) {
    if (!active.delete(entry)) return;
    if (entry.timer) clearTimeout(entry.timer);
    pump();
  }

  function release(entry: Entry, finished: boolean) {
    if (entry.released) return;
    entry.released = true;
    if (pending.delete(entry) || waiting.delete(entry)) {
      if (entry.timer) clearTimeout(entry.timer);
      return;
    }
    if (!active.has(entry)) return;
    if (finished) {
      freeSlot(entry);
      return;
    }
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => freeSlot(entry), ABANDONED_HOLD_MS);
  }

  function pump() {
    while (active.size < maxConcurrent && waiting.size > 0) {
      const focus = focusPage();
      let next: Entry | null = null;
      for (const e of waiting) {
        if (
          !next ||
          Math.abs(e.pageNum - focus) < Math.abs(next.pageNum - focus)
        ) {
          next = e;
        }
      }
      if (!next) return;
      const entry = next;
      waiting.delete(entry);
      active.add(entry);
      entry.timer = setTimeout(() => freeSlot(entry), SLOT_TIMEOUT_MS);
      entry.grant();
    }
  }

  return {
    request(pageNum, grant) {
      const entry: Entry = { pageNum, grant, timer: null, released: false };
      pending.add(entry);
      entry.timer = setTimeout(() => {
        if (!pending.delete(entry)) return;
        entry.timer = null;
        waiting.add(entry);
        pump();
      }, ADMIT_DELAY_MS);
      return (finished) => release(entry, finished);
    },
    setFocus(fn) {
      focusPage = fn;
    },
  };
}
