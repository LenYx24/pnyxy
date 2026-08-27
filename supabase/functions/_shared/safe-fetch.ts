// SSRF-safe fetch helper. Any function that fetches a caller-supplied
// URL (fetch-url-proxy, catalog-fetch, ...) should go through this
// instead of a bare `fetch`, so a malicious URL can't be used to reach
// cloud metadata endpoints, internal services, or other private-network
// hosts via a public hostname, a raw private IP, or an open redirect.
//
// Two checks matter and both are covered:
//   1. The literal host in the URL (IP literal or hostname pattern).
//   2. Every DNS answer the hostname resolves to (DNS rebinding).
// The same check re-runs on every redirect hop.

import "./deno-shim.ts";

export class SafeFetchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

// ── IPv4 ──────────────────────────────────────────────────────────

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

// Every private / reserved IPv4 range that must never be reachable
// from a server-side fetch.
const V4_BLOCKED_RANGES: Array<[string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // RFC1918
  ["100.64.0.0", 10], // CGNAT (RFC6598)
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local
  ["172.16.0.0", 12], // RFC1918
  ["192.168.0.0", 16], // RFC1918
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

function v4Mask(bits: number): number {
  return bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
}

function isPrivateV4Int(intIp: number): boolean {
  return V4_BLOCKED_RANGES.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = v4Mask(bits);
    return (intIp & mask) === (baseInt & mask);
  });
}

// ── IPv6 ──────────────────────────────────────────────────────────

/** Parse an IPv6 literal (no brackets, zone id stripped by caller) into
 *  8 16-bit groups, or null if it isn't a valid IPv6 literal. Handles
 *  "::" compression and a trailing embedded IPv4 (e.g. "::ffff:1.2.3.4"). */
function parseIPv6(input: string): number[] | null {
  let s = input.trim();
  if (!s.includes(":")) return null;

  let v4Tail: number[] | null = null;
  const lastColon = s.lastIndexOf(":");
  const possibleV4 = s.slice(lastColon + 1);
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(possibleV4)) {
    const v4Int = ipv4ToInt(possibleV4);
    if (v4Int === null) return null;
    v4Tail = [(v4Int >>> 16) & 0xffff, v4Int & 0xffff];
    s = s.slice(0, lastColon);
  }

  let head: string[];
  let tail: string[];
  const dbl = s.split("::");
  if (dbl.length > 2) return null;
  if (dbl.length === 2) {
    head = dbl[0] ? dbl[0].split(":") : [];
    tail = dbl[1] ? dbl[1].split(":") : [];
  } else {
    head = s ? s.split(":") : [];
    tail = [];
  }

  const toNums = (parts: string[]): number[] | null => {
    const nums = parts.map((p) => (p === "" ? NaN : parseInt(p, 16)));
    if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
    return nums;
  };
  const headNums = toNums(head);
  const tailNums = toNums(tail);
  if (headNums === null || tailNums === null) return null;

  const v4Groups = v4Tail ? v4Tail.length : 0;
  const given = headNums.length + tailNums.length + v4Groups;
  if (dbl.length === 1) {
    if (given !== 8) return null;
    return [...headNums, ...tailNums, ...(v4Tail ?? [])];
  }
  const zerosNeeded = 8 - given;
  if (zerosNeeded < 0) return null;
  return [...headNums, ...new Array(zerosNeeded).fill(0), ...tailNums, ...(v4Tail ?? [])];
}

function isPrivateV6Groups(g: number[]): boolean {
  // :: (unspecified)
  if (g.every((n) => n === 0)) return true;
  // ::1 (loopback)
  if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return true;
  // fc00::/7 (unique local)
  if ((g[0] & 0xfe00) === 0xfc00) return true;
  // fe80::/10 (link-local)
  if ((g[0] & 0xffc0) === 0xfe80) return true;
  // ::ffff:0:0/96 (IPv4-mapped) -> apply the v4 rules to the mapped address
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const mapped = ((g[6] << 16) | g[7]) >>> 0;
    return isPrivateV4Int(mapped);
  }
  return false;
}

/** True if `ip` (an IPv4 or IPv6 literal, no brackets) is a private,
 *  loopback, link-local, multicast, reserved, or unspecified address.
 *  Returns false for anything that doesn't parse as an IP literal. */
export function isPrivateAddress(ip: string): boolean {
  const trimmed = ip.trim();
  const v4 = ipv4ToInt(trimmed);
  if (v4 !== null) return isPrivateV4Int(v4);
  const v6 = parseIPv6(trimmed);
  if (v6 !== null) return isPrivateV6Groups(v6);
  return false;
}

function isIpLiteral(host: string): boolean {
  return ipv4ToInt(host) !== null || parseIPv6(host) !== null;
}

function stripBrackets(hostname: string): string {
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    return hostname.slice(1, -1);
  }
  return hostname;
}

async function resolveAllAddrs(host: string): Promise<string[]> {
  const results = await Promise.allSettled([
    Deno.resolveDns(host, "A"),
    Deno.resolveDns(host, "AAAA"),
  ]);
  const addrs: string[] = [];
  let anySucceeded = false;
  for (const r of results) {
    if (r.status === "fulfilled") {
      anySucceeded = true;
      addrs.push(...r.value);
    }
  }
  if (!anySucceeded) {
    throw new SafeFetchError("dns_failed", "Could not resolve host.");
  }
  return addrs;
}

/**
 * Throws a SafeFetchError when `url` must not be fetched server-side:
 * non-http(s) scheme, a blocked hostname pattern (localhost / .local /
 * .internal / .localhost), a private/loopback/link-local IP literal, or
 * a hostname where ANY DNS answer (A or AAAA) lands in a private range
 * (defeats DNS rebinding). Resolves silently when the URL is safe.
 */
export async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("bad_scheme", "Only http(s) URLs are allowed.");
  }

  const host = stripBrackets(url.hostname);
  const lower = host.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".localhost") ||
    lower.endsWith(".internal") ||
    lower.endsWith(".local")
  ) {
    throw new SafeFetchError("blocked_host", "That host is not allowed.");
  }

  if (isIpLiteral(host)) {
    if (isPrivateAddress(host)) {
      throw new SafeFetchError("blocked_host", "That host is not allowed.");
    }
    return;
  }

  // Hostname: check every DNS answer, not just the first, to defeat
  // DNS rebinding (a name that resolves to a public IP at request time
  // but a private one when the actual fetch happens, or vice versa).
  let addrs: string[];
  try {
    addrs = await resolveAllAddrs(host);
  } catch (err) {
    if (err instanceof SafeFetchError) throw err;
    throw new SafeFetchError("dns_failed", "Could not resolve host.");
  }
  for (const addr of addrs) {
    if (isPrivateAddress(addr)) {
      throw new SafeFetchError("blocked_host", "That host is not allowed.");
    }
  }
}

// ── safeFetch ─────────────────────────────────────────────────────

export interface SafeFetchInit extends RequestInit {
  /** Hard cap on the response body size, enforced while streaming. */
  maxBytes: number;
  /** Cap covering both the initial response (headers) and reading the
   *  full body. */
  timeoutMs: number;
  /** Max redirect hops to follow (default 5). Each hop re-runs the
   *  full SSRF check on the resolved Location URL. */
  maxRedirects?: number;
  /** Extra host allow-list check, applied on the initial URL and on
   *  every redirect hop, in addition to the private-IP checks. */
  allowHosts?: (host: string) => boolean;
}

/** A TransformStream that counts bytes passing through and aborts
 *  `controller` (which the caller's fetch is wired to) once more than
 *  `maxBytes` have passed. `onDone` fires once the stream finishes
 *  normally or trips the size limit, so the caller can clear its
 *  timeout. (Transformer has no `cancel` hook in the streams spec: if
 *  the consumer cancels the readable side without reading it to the
 *  end, `onDone` simply never fires and the timer is left to expire
 *  on its own, a harmless no-op if the request is already finished.) */
function countingStream(
  maxBytes: number,
  controller: AbortController,
  onDone: () => void,
): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onDone();
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, tc) {
      seen += chunk.byteLength;
      if (seen > maxBytes) {
        controller.abort();
        finish();
        tc.error(new SafeFetchError("too_large", "Response exceeded the size limit."));
        return;
      }
      tc.enqueue(chunk);
    },
    flush() {
      finish();
    },
  });
}

function checkAllowHosts(url: URL, allowHosts?: (host: string) => boolean): void {
  if (allowHosts && !allowHosts(url.hostname)) {
    throw new SafeFetchError("blocked_host", "That host is not allowed.");
  }
}

/**
 * SSRF-safe fetch with redirect handling, a byte cap enforced on the
 * streamed body (not just Content-Length, which an upstream can lie
 * about), and a single timeout covering the whole operation (initial
 * response + reading the body).
 *
 * Returns a Response whose body is the size-checked stream; read it
 * with `.arrayBuffer()` / `.text()` / etc. as usual. Throws
 * SafeFetchError on any SSRF violation, timeout, or size violation.
 */
export async function safeFetch(url: string, init: SafeFetchInit): Promise<Response> {
  const { maxBytes, timeoutMs, maxRedirects = 5, allowHosts, ...rest } = init;

  let current = new URL(url);
  await assertPublicHttpUrl(current);
  checkAllowHosts(current, allowHosts);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const clear = () => clearTimeout(timer);

  // The timer is cleared either here (on any error, or a bodiless
  // response) or by countingStream's onDone once the body has been
  // fully read / cancelled / tripped the size limit, so timeoutMs
  // covers both the initial response and reading the whole body.
  try {
    for (let hop = 0; ; hop++) {
      let res: Response;
      try {
        res = await fetch(current.toString(), {
          ...rest,
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") {
          throw new SafeFetchError("timeout", "The request timed out.");
        }
        throw new SafeFetchError("fetch_failed", "Could not reach the URL.");
      }

      const isRedirect = res.status >= 300 && res.status < 400;
      if (isRedirect) {
        const location = res.headers.get("location");
        if (!location) {
          throw new SafeFetchError("redirect_without_location", "Redirect without a Location header.");
        }
        if (hop >= maxRedirects) {
          throw new SafeFetchError("too_many_redirects", "Too many redirects.");
        }
        // Drain the (empty) body of the redirect response before
        // following, so the connection can be reused / doesn't hang.
        await res.body?.cancel().catch(() => {});
        const next = new URL(location, current);
        await assertPublicHttpUrl(next);
        checkAllowHosts(next, allowHosts);
        current = next;
        continue;
      }

      if (!res.body) {
        clear();
        return res;
      }
      const stream = countingStream(maxBytes, controller, clear);
      const counted = res.body.pipeThrough(stream);
      return new Response(counted, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    }
  } catch (err) {
    clear();
    throw err;
  }
}
