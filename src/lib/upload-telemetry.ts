import { supabase } from "./supabase";
import { isTauri } from "./tauri";

export type UploadAttemptStatus =
  | "accepted"
  | "rejected_unsupported_format"
  | "rejected_too_large"
  | "upload_failed"
  | "parse_failed";

export type FileFormatKind = "supported" | "known-unsupported" | "unknown";

const SUPPORTED_RE = /\.(pdf|epub|txt|md|markdown)$/i;
// Common book/document formats we don't render today. Listed
// explicitly so the telemetry separates "user tried a real book
// format we lack" from "user dropped a junk file".
const KNOWN_UNSUPPORTED_RE =
  /\.(mobi|azw|azw3|kfx|fb2|fb2\.zip|docx|doc|rtf|odt|cbz|cbr|cb7|djvu|djv|lit|chm|prc)$/i;

/** Classify a file by name to decide whether we route it through
 *  the normal opener or log it as a known-unsupported attempt. */
export function classifyFile(file: File): FileFormatKind {
  const name = file.name.toLowerCase();
  if (SUPPORTED_RE.test(name)) return "supported";
  if (KNOWN_UNSUPPORTED_RE.test(name)) return "known-unsupported";
  return "unknown";
}

/** Return the lowercased file extension with leading dot, or
 *  "" if the file has no extension. Strips multipart extensions
 *  like ".fb2.zip" down to ".zip" (the outermost only) so the
 *  telemetry aggregation stays sane. */
export function fileExtension(name: string): string {
  const lower = name.toLowerCase();
  const idx = lower.lastIndexOf(".");
  return idx === -1 ? "" : lower.slice(idx);
}

function detectClientPlatform(): string {
  if (!isTauri) return "web";
  // Tauri exposes `__TAURI_INTERNALS__.metadata.target` but it's
  // not part of the public TS surface. Cheap UA heuristic is good
  // enough for an aggregate breakdown.
  if (typeof navigator === "undefined") return "tauri";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("android")) return "tauri-android";
  if (ua.includes("iphone") || ua.includes("ipad")) return "tauri-ios";
  return "tauri-desktop";
}

export interface LogUploadAttemptOptions {
  file: File;
  status: UploadAttemptStatus;
  failureReason?: string | null;
}

/**
 * Fire-and-forget telemetry insert. Never throws, logging
 * failures must never break the upload flow. Returns a promise
 * so callers can `await` it during tests, but production callers
 * should ignore it.
 */
export async function logUploadAttempt({
  file,
  status,
  failureReason,
}: LogUploadAttemptOptions): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return; // anon users can't upload anyway; nothing to record

    await supabase.from("upload_attempts").insert({
      user_id: user.id,
      extension: fileExtension(file.name),
      mime_type: file.type || null,
      size_bytes: file.size,
      status,
      failure_reason: failureReason ?? null,
      client_platform: detectClientPlatform(),
    });
  } catch {
    // Swallow, never break the upload flow because telemetry
    // failed. There's nothing the user could do about it.
  }
}
