// Token estimation and client-IP helpers for the anonymous AI quota path.
import "./deno-shim.ts";

/** Cheap token estimate: ~4 chars per token. Good enough for
 *  pre-flight quota checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Salted SHA-256 of an IP so the usage table never stores raw IPs.
 *  Salt comes from IP_HASH_SALT (see ../README.md). */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${ip}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Salt for hashIp: IP_HASH_SALT, falling back to the service-role key
 *  so nothing breaks before the dedicated secret is set. */
export function ipHashSalt(): string {
  return (
    Deno.env.get("IP_HASH_SALT") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  );
}

/**
 * Best-effort client IP. Prefers headers the edge/proxy layer sets
 * itself; for x-forwarded-for the LAST hop is the one appended by the
 * trusted proxy, the first element is client-supplied and spoofable.
 */
export function getClientIp(req: Request): string | null {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const parts = forwarded.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  const real = req.headers.get("x-real-ip")?.trim();
  return real || null;
}
