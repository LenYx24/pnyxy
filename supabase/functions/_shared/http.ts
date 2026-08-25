// Shared HTTP helpers for the Pnyxy edge functions: CORS allow-list,
// JSON responses, preflight handling. See ../README.md for the
// ALLOWED_ORIGINS env var.
import "./deno-shim.ts";

const DEFAULT_ALLOWED_ORIGINS = [
  "https://pnyxy.com",
  "https://www.pnyxy.com",
  "http://localhost:5173",
  "http://localhost:4173",
  "tauri://localhost",
  "http://tauri.localhost",
];

function allowedOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS");
  if (!raw) return DEFAULT_ALLOWED_ORIGINS;
  const list = raw
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_ALLOWED_ORIGINS;
}

/**
 * CORS headers for a browser-facing function. The request Origin is
 * reflected only when it is on the allow-list; otherwise the
 * Access-Control-Allow-Origin header is omitted (the browser then
 * blocks the cross-origin read). `Vary: Origin` keeps caches honest.
 */
export function buildCorsHeaders(
  origin: string | null,
  methods = "POST, OPTIONS",
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": methods,
    Vary: "Origin",
  };
  if (origin && allowedOrigins().includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

/** Convenience: CORS headers for the given request. */
export function corsFor(req: Request, methods?: string): Record<string, string> {
  return buildCorsHeaders(req.headers.get("origin"), methods);
}

/** Preflight response. */
export function handleOptions(req: Request, methods?: string): Response {
  return new Response(null, { headers: corsFor(req, methods) });
}

/** JSON response with the given status and CORS headers merged in. */
export function json(
  status: number,
  body: unknown,
  cors: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/**
 * Error response in the `{ error: { code, message } }` shape (used by
 * ai-chat-proxy and send-feedback). Functions with a different error
 * shape build theirs on top of `json`.
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  cors: Record<string, string> = {},
): Response {
  return json(status, { error: { code, message } }, cors);
}
