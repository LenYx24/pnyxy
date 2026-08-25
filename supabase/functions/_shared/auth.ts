// Shared auth helper: resolve the signed-in user from the Authorization
// header via supabase-js, or hand back a ready-made 401/500 Response.
import "./deno-shim.ts";
// @ts-expect-error Deno-only import
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthUser {
  id: string;
  email?: string | null;
}

// supabase-js from esm.sh is untyped here; expose just what callers use.
// deno-lint-ignore no-explicit-any
export type UserClient = any;

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
