// Shared auth helper: resolve the signed-in user from the Authorization
// header via supabase-js, or hand back a ready-made 401/500 Response.
import "./deno-shim.ts";
// Pinned to the exact version in package.json (@supabase/supabase-js)
// rather than a floating `@2` tag, so esm.sh can't serve a different
// build than the one this codebase is tested against.
// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

export interface AuthUser {
  id: string;
  email?: string | null;
}

// supabase-js from esm.sh is untyped here (the import resolves to `any`),
// so this alias is effectively `any` without spelling it out for the linter.
export type UserClient = ReturnType<typeof createClient>;

export type RequireUserResult =
  | { ok: true; user: AuthUser; client: UserClient }
  | { ok: false; response: Response };

export interface RequireUserOptions {
  /** Called to build the error Response so each function keeps its own
   *  error shape and status/code pairs. `reason` is one of
   *  "no_bearer" | "misconfigured" | "invalid". */
  onError: (reason: "no_bearer" | "misconfigured" | "invalid") => Response;
  /** Pass `{ persistSession: false }` where the original code did. */
  persistSession?: boolean;
}

/**
 * Validate the Bearer token in `req` and return the user plus a
 * user-scoped supabase client (RLS applies). On failure returns the
 * Response produced by `onError`, so callers can `return` it directly.
 */
export async function requireUser(
  req: Request,
  opts: RequireUserOptions,
): Promise<RequireUserResult> {
  const authHeader =
    req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ") || authHeader.length <= "Bearer ".length) {
    return { ok: false, response: opts.onError("no_bearer") };
  }
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return { ok: false, response: opts.onError("misconfigured") };
  }
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    ...(opts.persistSession === false ? { auth: { persistSession: false } } : {}),
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) {
    return { ok: false, response: opts.onError("invalid") };
  }
  return { ok: true, user: data.user as AuthUser, client };
}

/**
 * Service-role client (bypasses RLS): for RPCs and tables that are
 * intentionally not exposed to `authenticated`/`anon` (e.g.
 * `bump_rate_limit`, granted to `service_role` only). Returns `null`
 * when `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` aren't set so
 * callers can degrade instead of throwing.
 */
export function serviceClient(): UserClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey);
}
