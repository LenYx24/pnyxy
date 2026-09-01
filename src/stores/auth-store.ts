import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { containsProfanity } from "@/lib/profanity-filter";
import { logError } from "@/lib/logger";
import type { Profile, UserBan } from "@/types/database";

/**
 * Pull any per-user Supabase-backed state that lives in other
 * stores. Called after we detect a signed-in session, lets
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
  try {
    const { useOrgStore } = await import("./org-store");
    void useOrgStore.getState().fetchMine();
  } catch (err) {
    logError("auth-store:hydrateOrgs", err);
  }
}

/** localStorage key: the signup form stashes the consent-checkbox moment
 *  here (the profile row may not exist yet, or the Google redirect loses
 *  the in-memory form state) so it can be drained once a profile is loaded. */
export const PENDING_CONSENT_KEY = "pnyxy:pendingConsentResearch";

/** localStorage key: the OPTIONAL "allow my conversations to be reviewed"
 *  signup checkbox stashes its moment here, drained the same way as the
 *  required research consent into `profiles.preferences.consent_content_at`.
 *  Only ever written when the user ticks the optional box. */
export const PENDING_CONTENT_CONSENT_KEY = "pnyxy:pendingConsentContent";

/** sessionStorage key: set right before the hard `window.location.replace`
 *  that follows a successful self-service account deletion, so the fresh
 *  `/auth` load (a full document reload, no in-memory React state survives
 *  it) can still show a farewell toast. sessionStorage rather than
 *  localStorage: it should only ever fire once, for the tab that just did
 *  the deleting, never resurface on a later unrelated sign-in. */
export const ACCOUNT_DELETED_KEY = "pnyxy:accountDeleted";

/**
 * Drains locally-stashed signup consent timestamps into
 * `profiles.preferences`: the required research consent into
 * `consent_research_at`, and the optional conversation-review opt-in into
 * `consent_content_at`. Best-effort and idempotent: a missing/blank stash
 * or an already-persisted timestamp is a no-op for that key. Both stashes
 * are drained in a single profile update so a survived-email-confirmation
 * or OAuth-redirect signup persists whatever the user ticked.
 */
async function persistPendingConsent(profile: Profile) {
  let pendingResearch: string | null = null;
  let pendingContent: string | null = null;
  try {
    pendingResearch = localStorage.getItem(PENDING_CONSENT_KEY);
    pendingContent = localStorage.getItem(PENDING_CONTENT_CONSENT_KEY);
  } catch {
    return;
  }
  if (!pendingResearch && !pendingContent) return;

  const existing = (profile.preferences ?? {}) as Record<string, unknown>;

  // Only write keys that are both pending and not already persisted.
  const updates: Record<string, unknown> = {};
  if (pendingResearch && !existing.consent_research_at) {
    updates.consent_research_at = pendingResearch;
  }
  if (pendingContent && !existing.consent_content_at) {
    updates.consent_content_at = pendingContent;
  }

  const clearStashes = () => {
    try {
      localStorage.removeItem(PENDING_CONSENT_KEY);
      localStorage.removeItem(PENDING_CONTENT_CONSENT_KEY);
    } catch {
      // ignore
    }
  };

  // Nothing new to persist (already drained on a prior load): just clear.
  if (Object.keys(updates).length === 0) {
    clearStashes();
    return;
  }

  try {
    const { error } = await supabase
      .from("profiles")
      // omit `features` (server-owned unlock list, see migration 00072)
      .update({
        preferences: {
          ...Object.fromEntries(
            Object.entries(existing).filter(([k]) => k !== "features"),
          ),
          ...updates,
        },
      })
      .eq("id", profile.id);
    if (error) throw error;
    clearStashes();
  } catch (err) {
    logError("auth-store:persistPendingConsent", err);
  }
}

/**
 * Wipe per-user local caches on sign-out so a previous account's
 * highlights/notes/whiteboards can't leak onto the next account that
 * signs in on the same browser. Only clears the pnyxy-annotations
 * IndexedDB; the pnyxy-sync mutation queue is left untouched so
 * pending offline writes survive. Dynamic imports keep IndexedDB
 * plumbing off the auth-store's boot path.
 */
async function clearLocalCachesOnSignOut() {
  try {
    const { clearAllLocalData } = await import("@/lib/annotation-storage");
    await clearAllLocalData();
  } catch (err) {
    logError("auth-store:clearAllLocalData", err);
  }
  try {
    const { useWhiteboardStore } = await import("./whiteboard-store");
    useWhiteboardStore.getState().clearLocal();
  } catch (err) {
    logError("auth-store:clearWhiteboards", err);
  }
  try {
    const { clearOfflineBooks } = await import("@/lib/offline-books");
    await clearOfflineBooks();
  } catch (err) {
    logError("auth-store:clearOfflineBooks", err);
  }
  try {
    const { useNoteStore } = await import("./note-store");
    useNoteStore.getState().clearLocal();
  } catch (err) {
    logError("auth-store:clearNotes", err);
  }
  try {
    // BYOK keys (Anthropic/OpenAI/local) are memory-only, but a stale
    // value would otherwise survive in memory across accounts on a
    // shared browser until the next reload.
    const { useSettingsStore } = await import("./settings-store");
    useSettingsStore.getState().clearSensitive();
  } catch (err) {
    logError("auth-store:clearSensitiveSettings", err);
  }
  try {
    const { useChatStore } = await import("./chat-store");
    useChatStore.getState().reset();
  } catch (err) {
    logError("auth-store:clearChat", err);
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
  markOnboarded: () => Promise<void>;
  /** Turn the optional "allow my conversations to be reviewed for the
   *  thesis research" consent on (stamp `consent_content_at`) or off
   *  (null) in profiles.preferences. Writable by the user: the 00072
   *  trigger only guards preferences.features, not other keys. */
  setContentConsent: (enabled: boolean) => Promise<void>;
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
    } = supabase.auth.onAuthStateChange((event, session) => {
      set({ session, user: session?.user ?? null });
      // Belt-and-braces for the password-reset flow. The inline
      // script in index.html catches the common case (recovery tokens
      // in the URL hash on the wrong path) before the SDK consumes
      // them. This handles the edge case where the SDK still
      // classifies the event as PASSWORD_RECOVERY without the
      // characteristic hash, force the user onto the reset form
      // regardless of where they were heading.
      if (
        event === "PASSWORD_RECOVERY" &&
        typeof window !== "undefined" &&
        window.location.pathname !== "/auth/reset-password"
      ) {
        window.location.replace("/auth/reset-password");
        return;
      }
      if (session?.user) {
        get().fetchProfile();
        get().checkBanStatus();
        hydrateSyncedStores();
      } else {
        set({ profile: null, isBanned: false, banInfo: null });
        // Drop org state on sign-out so the next user (or anonymous
        // session) doesn't see the previous user's switcher contents.
        void import("./org-store").then(({ useOrgStore }) =>
          useOrgStore.getState().reset(),
        );
        // Wipe local caches only on a real sign-out, not the anonymous
        // INITIAL_SESSION that fires on a fresh load with no user.
        // Hooked here rather than in signOut() so it also runs on
        // cross-tab sign-out and server-side session revocation.
        if (event === "SIGNED_OUT") {
          void clearLocalCachesOnSignOut();
        }
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
        redirectTo: `${window.location.origin}/auth/welcome`,
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
    // Awaited (rather than left to the SIGNED_OUT listener) so the IndexedDB/
    // BYOK-key/chat-store wipe finishes before we throw the whole JS
    // context away. The hard replace (not navigate()) is deliberate: every
    // store, including ones with no reset() of their own, reinitialises
    // from its module-level defaults on the fresh load instead of
    // potentially keeping stale in-memory state from the signed-out account.
    await clearLocalCachesOnSignOut();
    if (typeof window !== "undefined") {
      window.location.replace("/auth");
    }
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
    void persistPendingConsent(data as Profile);
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

  markOnboarded: async () => {
    const user = get().user;
    if (!user) return;
    if (get().profile?.onboarded) return;

    const { error } = await supabase
      .from("profiles")
      .update({ onboarded: true })
      .eq("id", user.id);

    if (error) {
      logError("auth-store:markOnboarded", error);
      return;
    }
    set((state) => ({
      profile: state.profile ? { ...state.profile, onboarded: true } : null,
    }));
  },

  setContentConsent: async (enabled) => {
    const user = get().user;
    const profile = get().profile;
    if (!user || !profile) return;

    const existing = (profile.preferences ?? {}) as Record<string, unknown>;
    // omit `features` (server-owned unlock list, see migration 00072); the
    // trigger keeps its own value even when the payload drops the key.
    const nextPreferences: Record<string, unknown> = {
      ...Object.fromEntries(
        Object.entries(existing).filter(([k]) => k !== "features"),
      ),
      consent_content_at: enabled ? new Date().toISOString() : null,
    };

    const { error } = await supabase
      .from("profiles")
      .update({ preferences: nextPreferences })
      .eq("id", user.id);

    if (error) {
      set({ error: error.message });
      throw error;
    }
    set((state) => ({
      profile: state.profile
        ? { ...state.profile, preferences: nextPreferences }
        : null,
    }));
  },
}));

export const useIsAdmin = () =>
  useAuthStore((s) => s.profile?.role === "admin");
