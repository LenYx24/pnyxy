import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/** Thrown by requireUser when there is no signed-in Supabase session. */
export class NotSignedInError extends Error {
  constructor(message = "Sign in to use chat.") {
    super(message);
    this.name = "NotSignedInError";
  }
}

/** Current user or null. For code paths that bail out silently when signed out. */
export async function getUserOrNull(): Promise<User | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

/** Current user, or throws NotSignedInError. For code paths that must surface the failure. */
export async function requireUser(message?: string): Promise<User> {
  const user = await getUserOrNull();
  if (!user) throw new NotSignedInError(message);
  return user;
}
