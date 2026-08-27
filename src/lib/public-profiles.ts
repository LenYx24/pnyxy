import { supabase } from "@/lib/supabase";

/**
 * Public-facing profile columns of OTHER users.
 *
 * Since migration 00072 `profiles` is readable only by its owner and
 * admins; everyone else goes through the `public_profiles` view
 * (id, display_name, avatar_url, created_at). PostgREST cannot embed a
 * view through a foreign key, so callers that used to write
 * `author:profiles!author_id(...)` fetch the rows first and attach the
 * profiles with these helpers.
 */
export interface PublicProfile {
  display_name: string | null;
  avatar_url: string | null;
}

export async function fetchPublicProfiles(
  ids: Iterable<string | null | undefined>,
): Promise<Map<string, PublicProfile>> {
  const unique = Array.from(
    new Set(Array.from(ids).filter((id): id is string => !!id)),
  );
  const map = new Map<string, PublicProfile>();
  if (unique.length === 0) return map;
  const { data, error } = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .in("id", unique);
  if (error) throw error;
  for (const row of (data ?? []) as Array<
    { id: string } & PublicProfile
  >) {
    map.set(row.id, {
      display_name: row.display_name,
      avatar_url: row.avatar_url,
    });
  }
  return map;
}

/** Attach `author` to rows that carry an `author_id`. Best-effort: a
 *  failed profile lookup leaves `author` undefined (UI shows "Unknown"). */
export async function attachAuthors<T extends { author_id: string }>(
  rows: T[],
): Promise<Array<T & { author?: PublicProfile }>> {
  if (rows.length === 0) return rows;
  try {
    const profiles = await fetchPublicProfiles(rows.map((r) => r.author_id));
    return rows.map((r) => ({ ...r, author: profiles.get(r.author_id) }));
  } catch {
    return rows;
  }
}
