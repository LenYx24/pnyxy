import { useLibraryStore } from "@/stores/library-store";
import { useResourceStore } from "@/stores/resource-store";
import { detectResourceKind, displayHost, normalizeUrl, parseYouTubeId } from "@/lib/resource-url";

/** Library folders saved items land in (created on first use). */
export const WEB_FOLDER_NAME = "Web";
export const YOUTUBE_FOLDER_NAME = "YouTube";

/** https://www.youtube.com/watch?v=ID, nothing else (t=, list=, hash). */
export function canonicalYouTubeUrl(raw: string): string {
  const id = parseYouTubeId(raw);
  return id ? `https://www.youtube.com/watch?v=${id}` : normalizeUrl(raw);
}

export interface SaveUrlInput {
  url: string;
  title?: string;
  /** Pre-extracted page text (browser extension). Ignored for videos. */
  content?: string | null;
}

/**
 * Find-or-create the library resource for a URL. Videos go to the
 * "YouTube" folder through the ingest function (title, thumbnail,
 * captions); pages go to "Web" with the given text as the AI context.
 * Returns the resource id and whether it was just created.
 */
export async function saveUrlAsResource(
  input: SaveUrlInput,
): Promise<{ id: string; created: boolean; folder: string }> {
  const isVideo = detectResourceKind(input.url) === "youtube";
  const key = isVideo
    ? canonicalYouTubeUrl(input.url)
    : normalizeUrl(input.url).replace(/#.*$/, "");
  const resources = useResourceStore.getState();
  if (resources.resources.length === 0) await resources.fetchResources();
  const folder = isVideo ? YOUTUBE_FOLDER_NAME : WEB_FOLDER_NAME;
  const existing = useResourceStore.getState().findByUrl(key);
  if (existing) return { id: existing.id, created: false, folder };

  const lib = useLibraryStore.getState();
  await lib.fetchFolders();
  const folderRow = await lib.createFolderPath(folder, null);
  const title = (input.title ?? "").replace(/ - YouTube$/, "").trim();
  const id = await useResourceStore.getState().createResource(
    isVideo
      ? { url: key, folderId: folderRow?.id ?? null, title: title || undefined }
      : {
          url: key,
          folderId: folderRow?.id ?? null,
          title: title || displayHost(input.url),
          content: input.content ?? null,
          skipIngest: true,
        },
  );
  if (!id) throw new Error("Could not save the link.");
  return { id, created: true, folder };
}
