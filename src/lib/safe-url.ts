/**
 * Shared guards for user/model-supplied URLs before they land in an
 * `href`, a `window.open`, or an in-app `navigate()`. Anything that
 * doesn't pass should be rendered as plain text instead of a link.
 */

/** True only for a well-formed absolute http(s) URL. */
export function isSafeExternalUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * True only for a root-relative in-app path: starts with a single `/`,
 * has no scheme, and isn't protocol-relative (`//host/...`, which the
 * browser treats as an external navigation).
 */
export function safeInternalPath(url: string | null | undefined): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("/")) return false;
  if (trimmed.startsWith("//")) return false;
  // Reject anything that looks like it carries a scheme (`/\evil.com`,
  // `javascript:...` smuggled after a leading slash gets caught by the
  // startsWith check above already, this catches backslash tricks some
  // browsers still normalize into `//`).
  if (/^\/\\+/.test(trimmed)) return false;
  return true;
}
