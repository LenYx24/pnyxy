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
import { useUploadStore } from "@/stores/upload-store";
import { logError } from "@/lib/logger";
import { track } from "@/lib/telemetry";

const BUCKET = "space-files";
const COPY_MAP_KEY = "pnyxy:space-file-copies";

export interface SpaceFile {
  name: string;
  size: number | null;
  updatedAt: string | null;
}

// A folder with no objects (a course nobody has uploaded legacy files
// to yet) is not an error condition, `list()` on Storage already
// resolves that to an empty array (confirmed against both a real and a
// nonexistent bucket/prefix), so no special-casing is needed for it
// here. The error actually seen in the wild is a bare "Failed to
// fetch"/"NetworkError": a browser-level fetch() failure (dropped
// connection, an extension blocking the request, a CORS preflight
// that never completes), not an application or RLS bug, so it's not
// worth alarming the console on every single page load. Cap it to one
// logged occurrence per session and quietly keep showing
// content-registered files.
const NETWORK_ERROR_RE = /failed to fetch|network ?error|load failed/i;
let loggedNetworkErrorOnce = false;

export async function listSpaceFiles(spaceId: string): Promise<SpaceFile[]> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(spaceId, { limit: 200, sortBy: { column: "name", order: "asc" } });
  if (error) {
    if (NETWORK_ERROR_RE.test(error.message)) {
      if (!loggedNetworkErrorOnce) {
        loggedNetworkErrorOnce = true;
        logError(
          "space-files:list",
          `${error.message} (space ${spaceId}); falling back to content-registered files only for this session`,
        );
      }
    } else {
      logError("space-files:list", error.message);
    }
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
 * one, otherwise download, upload into the member's own library (in the
 * course folder when given), tag the copy with the course, and open the
 * reader. Non-PDF files fall back to a session-only local open.
 */
export async function openSpaceFile(
  spaceId: string,
  name: string,
  navigate: NavigateFunction,
  opts: { folderId?: string | null } = {},
): Promise<void> {
  track("course_file_open", { space: spaceId });
  const key = `${spaceId}/${name}`;
  const map = readCopyMap();
  if (map[key]) {
    navigate(routeForCopy(map[key]));
    return;
  }
  const { data, error } = await supabase.storage.from(BUCKET).download(key);
  if (error || !data) {
    logError("space-files:download", error?.message ?? "no data");
    throw new Error(error?.message ?? "download failed");
  }
  const isPdf = /\.pdf$/i.test(name) || data.type === "application/pdf";
  const file = new File([data], name, {
    type: data.type || (isPdf ? "application/pdf" : "application/octet-stream"),
  });
  if (!isPdf) {
    const localId = await openDocumentFromFile({ file, navigate });
    writeCopyMap({ ...map, [key]: localId });
    return;
  }
  const { bookId, error: upErr } = await useUploadStore
    .getState()
    .uploadPdf(file, opts.folderId ?? null);
  if (upErr || !bookId) {
    logError("space-files:upload-copy", upErr ?? "no book id");
    throw new Error(upErr ?? "upload failed");
  }
  writeCopyMap({ ...map, [key]: bookId });
  // provenance for per-course stats (books.source_space_id, 00065)
  const { error: tagErr } = await supabase
    .from("books")
    .update({ source_space_id: spaceId })
    .eq("id", bookId);
  if (tagErr) logError("space-files:tag", tagErr.message);
  navigate(routeForCopy(bookId));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Library copies (books.id) open on the book page, with `open=reader`
 *  so it auto-triggers the same "Open in Reader" action as the button
 *  on the Overview tab (see OverviewTab's UploadedOverview) instead of
 *  landing the reader an extra click away. Session-only local docs
 *  (content-hash ids from older copies) open straight in the bare
 *  reader, they have no book page. */
function routeForCopy(id: string): string {
  return UUID_RE.test(id) ? `/books/${id}?open=reader` : `/reader/${id}`;
}
