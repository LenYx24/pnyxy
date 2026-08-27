import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    // PKCE instead of the implicit flow (M5): the implicit flow puts
    // the access/refresh tokens directly in the URL fragment, where
    // they can leak via browser history, Referer headers on older
    // browsers, or any script that reads location.hash before the
    // SDK consumes it. PKCE exchanges a short-lived, single-use
    // `code` for the session server-side instead. `detectSessionInUrl`
    // stays on so both the OAuth callback (`?code=`) and the
    // password-recovery link are picked up automatically on load; see
    // the bootstrap in index.html and the PASSWORD_RECOVERY handling
    // in auth-store.ts for how the recovery hand-off stays correct
    // under this flow.
    flowType: "pkce",
    detectSessionInUrl: true,
  },
});

// exported so the upload store can hit the storage REST endpoint directly
// with a per-request AbortSignal (storage-js upload() can't thread one through)
export const SUPABASE_URL = supabaseUrl as string;
export const SUPABASE_ANON_KEY = supabaseKey as string;
