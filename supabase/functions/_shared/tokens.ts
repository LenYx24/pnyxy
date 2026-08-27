// Token estimation and client-IP helpers for the anonymous AI quota path.
import "./deno-shim.ts";

/** Cheap token estimate: ~4 chars per token. Good enough for
 *  pre-flight quota checks. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** HMAC-SHA256 of an IP so the usage table never stores raw IPs and
 *  the hash can't be reversed or dictionary-matched without the salt.
 *  Salt comes from IP_HASH_SALT (see ../README.md). Uses HMAC rather
 *  than salt-concatenation-then-hash: concatenation is length-extension
 *  and structurally weaker than a proper keyed MAC. */
export async function hashIp(ip: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Salt for hashIp: IP_HASH_SALT, required. Fails closed (throws)
 *  rather than falling back to the service-role key or an empty
 *  string, either of which would make the hash trivially reversible
 *  or reuse a sensitive secret outside its intended purpose. Set with
 *  `supabase secrets set IP_HASH_SALT=$(openssl rand -hex 32)`. */
export function ipHashSalt(): string {
  const salt = Deno.env.get("IP_HASH_SALT");
  if (!salt) {
    throw new Error("ip_hash_salt_unset");
  }
  return salt;
}

/**
 * Flat per-request token surcharge to bill when a chat request enables
 * server-side grounding (web search / retrieval): grounded calls cost
 * more upstream (search + extra context tokens) than the model's own
 * completion tokens reflect, so the quota RPC should add this on top
 * of the estimated prompt+completion tokens whenever grounding was
 * requested. Not applied anywhere in this file; the ai-chat-proxy
 * owner wires it into their token accounting.
 */
export const GROUNDED_REQUEST_SURCHARGE_TOKENS = 2000;

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
