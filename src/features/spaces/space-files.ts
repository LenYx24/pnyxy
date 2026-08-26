/**
 * Shared course files ("space-files" bucket, path: <spaceId>/<fileName>).
 * The owner uploads, members read. Opening a file copies it into the
 * member's OWN library once (Nextcloud model: shared distribution,
 * personal working copy), so reading position, annotations, chat and
 * streaks all work unchanged. The copy remembers its course via
 * books.source_space_id (migration 00065) and a local map prevents
 * duplicate copies per device.
 */
import type { NavigateFunction } from "react-router";
import { supabase } from "@/lib/supabase";
import { openDocumentFromFile } from "@/lib/open-document";
import { logError } from "@/lib/logger";
import { track } from "@/lib/telemetry";

const BUCKET = "space-files";
const COPY_MAP_KEY = "pnyxy:space-file-copies";

export interface SpaceFile {
  name: string;
  size: number | null;
  updatedAt: string | null;
}

export async function listSpaceFiles(spaceId: string): Promise<SpaceFile[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(spaceId, { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) {
    logError("space-files:list", error.message);
    return [];
  }
  return (data ?? [])
    .filter((o) => o.name && !o.name.startsWith("."))
    .map((o) => ({
      name: o.name,
      size: (o.metadata as { size?: number } | null)?.size ?? null,
      updatedAt: o.updated_at ?? null,
    }));
}

export async function uploadSpaceFile(
  spaceId: string,
  file: File,
): Promise<string | null> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${spaceId}/${file.name}`, file, { upsert: true });
  if (error) {
    logError("space-files:upload", error.message);
    return error.message;
  }
  return null;
}

export async function deleteSpaceFile(
  spaceId: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET)
    .remove([`${spaceId}/${name}`]);
  if (error) logError("space-files:delete", error.message);
}

function readCopyMap(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(COPY_MAP_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function writeCopyMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(COPY_MAP_KEY, JSON.stringify(map));
  } catch {
    // private mode: worst case a re-download creates a second copy
  }
}

/**
 * Open a course file: reuse this device's earlier copy when there is
 * one, otherwise download, import into the member's library, tag the
 * copy with the course, and open the reader.
 */
export async function openSpaceFile(
  spaceId: string,
  name: string,
  navigate: NavigateFunction,
): Promise<void> {
  track("course_file_open", { space: spaceId });
  const key = `${spaceId}/${name}`;
  const map = readCopyMap();
  if (map[key]) {
    navigate(`/reader/${map[key]}`);
    return;
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) {
    logError("space-files:download", error?.message ?? "no data");
    throw new Error(error?.message ?? "download failed");
  }
  const file = new File([data], name, {
    type: data.type || "application/pdf",
  });
  const docId = await openDocumentFromFile({ file, navigate });
  writeCopyMap({ ...readCopyMap(), [key]: docId });
  // provenance for per-course stats; best-effort (column from 00065)
  const { error: tagErr } = await supabase
    .from("books")
    .update({ source_space_id: spaceId })
    .eq("id", docId);
  if (tagErr) logError("space-files:tag", tagErr.message);
}
