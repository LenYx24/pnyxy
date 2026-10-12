// An AI agent's sign-in (OAuth consent at /oauth/consent) can be interrupted
// by the Pnyxy sign-in itself. Email sign-in returns via ?next=, but Google
// sign-in always lands on /auth/welcome, so the consent URL is also kept here
// for the welcome page to resume.

const KEY = "pnyxy.oauth.pendingConsent";

export const MCP_SERVER_URL = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/mcp`;

export function rememberPendingConsent(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // storage blocked: email sign-in still returns via ?next=
  }
}

/** The consent path waiting for a sign-in, if any. Does not clear it. */
export function peekPendingConsent(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    return path && path.startsWith("/oauth/consent") ? path : null;
  } catch {
    return null;
  }
}

export function clearPendingConsent(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nothing to clear
  }
}

// Dynamic client registration (what lets claude.ai connect without a pasted
// client id) lets anyone register a client under any name, so the name proves
// nothing: a phishing client can call itself "Claude". What can't be faked is
// where the authorization code goes, the redirect URI. Known agents are
// recognised by its host, a program on this computer by a loopback host, and
// anything else needs an explicit "I trust this app" before Allow works.
const KNOWN_AGENT_HOSTS: Record<string, string> = {
  "claude.ai": "Claude",
  "claude.com": "Claude",
  "chatgpt.com": "ChatGPT",
};
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

type RedirectKind =
  | { kind: "known"; agent: string; host: string }
  | { kind: "local"; host: string }
  | { kind: "unknown"; host: string };

export function classifyRedirect(uri: string): RedirectKind {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return { kind: "unknown", host: uri };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === "https:" && KNOWN_AGENT_HOSTS[host]) {
    return { kind: "known", agent: KNOWN_AGENT_HOSTS[host], host };
  }
  if (
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.has(host)
  ) {
    return { kind: "local", host: url.host };
  }
  // custom schemes (editor:// callbacks) have no host worth showing
  return { kind: "unknown", host: url.host || `${url.protocol}//` };
}
