import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import type { ResourceRef, Roadmap } from "@/types/roadmap";

/**
 * Auto-progress for a roadmap node: take any matched book reference
 * that includes a `pageRange`, fetch the user's current page in
 * `book_resume_state` for that book, and lerp linearly between
 * `from` and `to` to a 0–100 percent.
 *
 * Composition vs manual progress is the caller's job — typically
 * `displayProgress = max(manualProgress, autoProgress)`. We never
 * persist auto-progress; recomputing on demand keeps the data layer
 * single-source-of-truth (the resume state is the only thing that
 * needs to round-trip with the cloud).
 *
 * References without a pageRange contribute 0 to auto-progress —
 * chapter/section-only citations can't be mapped to a page-precise
 * read position without TOC matching, which is a separate feature.
 */

interface ResumeStateRow {
  doc_id: string;
  page: number;
}

/** @internal — exported for unit tests. Pure lerp from current page
 *  into a node's [from, to] range, clamped to 0–100. */
export function nodePctFromPage(
  page: number,
  range: { from: number; to: number },
): number {
  if (range.to <= range.from) return page >= range.from ? 100 : 0;
  if (page <= range.from) return 0;
  if (page >= range.to) return 100;
  const frac = (page - range.from) / (range.to - range.from);
  return Math.round(frac * 100);
}

function refsOf(node: Roadmap["nodes"][number]): ResourceRef[] {
  return (node.payload?.references as ResourceRef[] | undefined) ?? [];
}

/**
 * Fetch resume states for every matched book referenced by the
 * roadmap, then compute a `nodeId → 0..100` auto-progress map.
 *
 * Network shape: one Supabase query, batched by `in (doc_id ...)`.
 * Empty roadmap or no matched refs → empty map (and no network).
 */
export async function fetchAutoProgressMap(
  roadmap: Roadmap,
): Promise<Record<string, number>> {
  const docIds = new Set<string>();
  for (const n of roadmap.nodes) {
    for (const r of refsOf(n)) {
      if (
        r.pageRange &&
        r.match &&
        (r.match.source === "library" || r.match.source === "catalog")
      ) {
        docIds.add(r.match.docId);
      }
    }
  }
  if (docIds.size === 0) return {};

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return {};

  const { data, error } = await supabase
    .from("book_resume_state")
    .select("doc_id, page")
    .eq("user_id", user.id)
    .in("doc_id", Array.from(docIds));

  if (error) {
    logError("roadmap-auto-progress:fetch", error);
    return {};
  }

  const pageByDoc = new Map<string, number>();
  for (const row of (data ?? []) as ResumeStateRow[]) {
    pageByDoc.set(row.doc_id, row.page);
  }

  const out: Record<string, number> = {};
  for (const n of roadmap.nodes) {
    let best = 0;
    for (const r of refsOf(n)) {
      if (!r.pageRange) continue;
      if (
        !r.match ||
        (r.match.source !== "library" && r.match.source !== "catalog")
      )
        continue;
      const page = pageByDoc.get(r.match.docId);
      if (page === undefined) continue;
      const pct = nodePctFromPage(page, r.pageRange);
      if (pct > best) best = pct;
    }
    if (best > 0) out[n.id] = best;
  }
  return out;
}

/** Compose manual + auto into a single display percent. */
export function displayProgressPct(
  manualPct: number,
  autoPct: number,
): number {
  return Math.max(manualPct, autoPct);
}
