import { readFileSync } from "node:fs";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Reads KEY=VALUE lines. Values never reach stdout: on stdio the protocol owns it.
function readEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function loadConfig() {
  const env: Record<string, string | undefined> = { ...process.env };
  // PNYXY_ENV_FILES=a.env,b.env lets the repo's own env files supply the values
  for (const file of (process.env.PNYXY_ENV_FILES ?? "").split(",").filter(Boolean)) {
    Object.assign(env, readEnvFile(file.trim()), process.env);
  }
  const url = env.PNYXY_SUPABASE_URL ?? env.VITE_SUPABASE_URL;
  const key = env.PNYXY_SUPABASE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const email = env.PNYXY_EMAIL ?? env.TEST_USER_EMAIL;
  const password = env.PNYXY_PASSWORD ?? env.TEST_USER_PASSWORD;
  if (!url || !key || !email || !password) {
    throw new Error(
      "Missing config: set PNYXY_SUPABASE_URL, PNYXY_SUPABASE_KEY, PNYXY_EMAIL, PNYXY_PASSWORD (or PNYXY_ENV_FILES).",
    );
  }
  return { url, key, email, password };
}

export interface Session {
  db: SupabaseClient;
  userId: string;
}

/** Signs in as the user, so every query runs under their row-level security. */
export async function openSession(): Promise<Session> {
  const cfg = loadConfig();
  const db = createClient(cfg.url, cfg.key, {
    auth: { persistSession: false, autoRefreshToken: true },
  });
  const { data, error } = await db.auth.signInWithPassword({
    email: cfg.email,
    password: cfg.password,
  });
  if (error || !data.user) throw new Error(`Sign-in failed: ${error?.message ?? "no user"}`);
  return { db, userId: data.user.id };
}
