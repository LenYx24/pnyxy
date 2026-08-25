import { useEffect, useState } from "react";
import { fetchResumeState } from "@/lib/resume-state";

export interface ResumePage {
  page: number;
  updatedAt: string;
}

/** Resume page per doc id, filled lazily when a book row expands so the
 *  row's progress bar can show a real percentage afterwards. Module-level
 *  so it survives collapse / re-expand and folder navigation. */
const cache = new Map<string, ResumePage>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

/** Fetch (once) the cloud resume state for a doc and notify subscribers. */
export async function loadResumePage(docId: string): Promise<void> {
  if (cache.has(docId) || pending.has(docId)) return;
  pending.add(docId);
  try {
    const state = await fetchResumeState(docId);
    if (!state) return;
    cache.set(docId, { page: state.page, updatedAt: state.updated_at });
    for (const cb of listeners) cb();
  } finally {
    pending.delete(docId);
  }
}

/** Subscribe to the cached resume page of a doc (null until loaded). */
export function useResumePage(docId: string): ResumePage | null {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return cache.get(docId) ?? null;
}
