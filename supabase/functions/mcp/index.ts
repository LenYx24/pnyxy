// Pnyxy: remote MCP server (Streamable HTTP, stateless). Lets an AI agent
// such as claude.ai (custom connector) or ChatGPT use the caller's Pnyxy
// account with the same tools as the local stdio server in /mcp, whose
// tools.ts this function imports. See ../README.md.
//
// Auth is OAuth 2.1 with Supabase Auth as the authorization server: the
// agent discovers it from this function's protected-resource metadata
// (RFC 9728), the user signs in and approves on the app's /oauth/consent
// page, and every call carries the resulting user access token. Tools run
// with a client scoped to that token, so row-level security applies just as
// it does in the app. verify_jwt = false: an unauthenticated call must get
// this function's 401 + WWW-Authenticate challenge, not the gateway's.

import "../_shared/deno-shim.ts";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createClient } from "@supabase/supabase-js";
import { serviceClient } from "../_shared/auth.ts";
import { registerTools, SERVER_INSTRUCTIONS } from "../../../mcp/src/tools.ts";

const DAILY_CALL_LIMIT = 2000;

// The URL agents reach this project at. Hosted, SUPABASE_URL already is;
// the local stack hands functions an internal one (http://kong:8000), so
// local development sets MCP_PUBLIC_SUPABASE_URL.
function publicSupabaseUrl(): string {
  const url = Deno.env.get("MCP_PUBLIC_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
  return url.replace(/\/$/, "");
}

// Agents call from their own servers or local apps with a bearer token and
// no cookies, so a wildcard origin exposes nothing; it lets browser-based
// MCP clients (e.g. the MCP Inspector) connect too.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, content-type, mcp-protocol-version, mcp-session-id, last-event-id",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id, www-authenticate",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, ...extra, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const base = publicSupabaseUrl();
  const resource = `${base}/functions/v1/mcp`;
  const metadataUrl = `${resource}/.well-known/oauth-protected-resource`;
  const url = new URL(req.url);

  if (req.method === "GET" && url.pathname.endsWith("/.well-known/oauth-protected-resource")) {
    return jsonResponse(200, {
      resource,
      authorization_servers: [`${base}/auth/v1`],
      bearer_methods_supported: ["header"],
      resource_name: "Pnyxy",
      resource_documentation: "https://pnyxy.com/help",
    });
  }

  const challenge = (error?: string) =>
    jsonResponse(
      401,
      { error: error ?? "unauthorized", error_description: "Sign in to Pnyxy to use this server." },
      {
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}"${
          error ? `, error="${error}"` : ""
        }`,
      },
    );

  const authHeader = req.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/.test(authHeader)) return challenge();

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    console.error("mcp: SUPABASE_URL / SUPABASE_ANON_KEY missing");
    return jsonResponse(500, { error: "misconfigured" });
  }
  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth?.user) return challenge("invalid_token");
  const userId = auth.user.id;

  // Per-user daily cap (bump_rate_limit, migration 00073), counted per HTTP
  // request: a runaway agent loop can't hammer the database.
  const admin = serviceClient();
  if (admin) {
    const { data: withinLimit, error: rpcErr } = await admin.rpc("bump_rate_limit", {
      p_key: `mcp:${userId}`,
      p_limit: DAILY_CALL_LIMIT,
    });
    if (rpcErr) console.error("mcp: bump_rate_limit failed", rpcErr);
    else if (!withinLimit) {
      return jsonResponse(429, { error: "rate_limited", error_description: "Daily limit reached." });
    }
  }

  // Stateless: a fresh server per request, nothing kept between calls.
  const server = new McpServer(
    { name: "pnyxy", version: "0.2.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, { db, userId });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return withCors(await transport.handleRequest(req));
  } catch (err) {
    console.error("mcp: request failed", err);
    return jsonResponse(500, { error: "internal_error" });
  }
});
