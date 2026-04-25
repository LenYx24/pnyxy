import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { containsProfanity } from "@/lib/profanity-filter";
import { logError } from "@/lib/logger";
import type { Profile, UserBan } from "@/types/database";

/**
 * Pull any per-user Supabase-backed state that lives in other
 * stores. Called after we detect a signed-in session — lets
 * returning users see their cloud-synced whiteboards / vocab / etc
 * on a fresh device without having to navigate to each feature
 * before it hydrates. Each call is fire-and-forget so one slow
 * fetch doesn't block the others or the auth flow.
 */
async function hydrateSyncedStores() {
  try {
    // Dynamic import keeps this off the critical path; the
    // whiteboard-store module pulls in IndexedDB + PDF rendering
    // plumbing that's heavy at app boot.
    const { useWhiteboardStore } = await import("./whiteboard-store");
    useWhiteboardStore.getState().syncFromCloud();
  } catch (err) {
    logError("auth-store:hydrateSyncedStores", err);
  }
}

const AVATAR_BUCKET = "avatars";
const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

interface AuthState {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  isBanned: boolean;
  banInfo: UserBan | null;

  initialize: () => () => void;
  signUp: (email: string, password: string, displayName?: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<Profile, "display_name" | "avatar_url">>) => Promise<void>;
  uploadAvatar: (file: File) => Promise<void>;
  removeAvatar: () => Promise<void>;
  checkBanStatus: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  loading: true,
  error: null,
  isBanned: false,
  banInfo: null,

  initialize: () => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      set({ session, user: session?.user ?? null, loading: false });
      if (session?.user) {
        get().fetchProfile();
        get().checkBanStatus();
        hydrateSyncedStores();
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
      if (session?.user) {
        get().fetchProfile();
        get().checkBanStatus();
        hydrateSyncedStores();
      } else {
        set({ profile: null, isBanned: false, banInfo: null });
      }
    });

    return () => subscription.unsubscribe();
  },

  signUp: async (email, password, displayName) => {
    set({ error: null });
    if (displayName && containsProfanity(displayName)) {
      const err = new Error(
        "Display name contains disallowed language. Please choose another.",
      );
      set({ error: err.message });
      throw err;
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: displayName ? { display_name: displayName } : undefined,
        emailRedirectTo: `${window.location.origin}/auth/welcome`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signIn: async (email, password) => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signInWithGoogle: async () => {
    set({ error: null });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/library`,
      },
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  requestPasswordReset: async (email) => {
    set({ error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  updatePassword: async (newPassword) => {
    set({ error: null });
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      set({ error: error.message });
      throw error;
    }
  },

  signOut: async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ error: error.message });
      throw error;
    }
    set({ user: null, session: null, profile: null, isBanned: false, banInfo: null });
  },

  fetchProfile: async () => {
    const user = get().user;
    if (!user) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (error) {
      console.error("Failed to fetch profile:", error.message);
      return;
    }
    set({ profile: data });
  },

  updateProfile: async (updates) => {
    const user = get().user;
    if (!user) return;

    if (
      updates.display_name !== undefined &&
      updates.display_name !== null &&
      containsProfanity(updates.display_name)
    ) {
      const err = new Error(
        "Display name contains disallowed language. Please choose another.",
      );
      set({ error: err.message });
      throw err;
    }

    const { error } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user.id);

    if (error) {
      set({ error: error.message });
      throw error;
    }
    set((state) => ({
      profile: state.profile ? { ...state.profile, ...updates } : null,
    }));
  },

  uploadAvatar: async (file) => {
    const user = get().user;
    if (!user) throw new Error("You must be signed in to upload an avatar.");

    if (file.size > AVATAR_MAX_BYTES) {
      const err = new Error("Avatar must be 5 MB or smaller.");
      set({ error: err.message });
      throw err;
    }

    const ext = AVATAR_ALLOWED_MIME[file.type];
    if (!ext) {
      const err = new Error("Avatar must be a JPEG, PNG, WebP, or GIF image.");
      set({ error: err.message });
      throw err;
    }

    set({ error: null });

    const path = `${user.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
      set({ error: uploadError.message });
      throw uploadError;
    }

    const { data: publicUrlData } = supabase.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path);

    const cacheBustedUrl = `${publicUrlData.publicUrl}?v=${Date.now()}`;
    await get().updateProfile({ avatar_url: cacheBustedUrl });
  },

  removeAvatar: async () => {
    const user = get().user;
    if (!user) throw new Error("You must be signed in to remove your avatar.");

    set({ error: null });

    const { data: files, error: listError } = await supabase.storage
      .from(AVATAR_BUCKET)
      .list(user.id);

    if (listError) {
      set({ error: listError.message });
      throw listError;
    }

    if (files && files.length > 0) {
      const paths = files.map((f) => `${user.id}/${f.name}`);
      const { error: removeError } = await supabase.storage
        .from(AVATAR_BUCKET)
        .remove(paths);
      if (removeError) {
        set({ error: removeError.message });
        throw removeError;
      }
    }

    await get().updateProfile({ avatar_url: null });
  },

  checkBanStatus: async () => {
    const user = get().user;
    if (!user) return;

    const { data, error } = await supabase
      .from("user_bans")
      .select("*")
      .eq("user_id", user.id)
      .or("banned_until.is.null,banned_until.gt.now()")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("Failed to check ban status:", error.message);
      return;
    }

    set({ isBanned: !!data, banInfo: data });
  },
}));

export const useIsAdmin = () =>
  useAuthStore((s) => s.profile?.role === "admin");
