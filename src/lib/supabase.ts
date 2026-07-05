import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY environment variables",
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);

// exported so the upload store can hit the storage REST endpoint directly
// with a per-request AbortSignal (storage-js upload() can't thread one through)
export const SUPABASE_URL = supabaseUrl as string;
export const SUPABASE_ANON_KEY = supabaseKey as string;
