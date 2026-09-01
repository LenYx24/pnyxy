// Feature gating for the pilot: the app ships with only the core loop
// visible (reader + AI chat + streaks + library) and every other surface
// behind a flag that can be unlocked per user.
//
// Resolution order for a key (first hit wins):
//   1. local override from the settings store (admin/dev toggles)
//   2. admin "show everything" switch
//   3. server-side unlock list in profiles.preferences.features
//   4. DEFAULT_FEATURES (all false in the pilot)
//
// Unlocking for a pilot user is a one-liner in SQL:
//   update profiles set preferences = preferences || '{"features":["notes"]}'
//   where id = '...';

export const FEATURE_KEYS = [
  "notes",
  "whiteboard",
  "quizzes",
  "flashcards",
  "learnHub",
  "forum",
  "roadmaps",
  "vocabulary",
  "spaces",
  "comments",
  "graph",
  "leaderboards",
  "multiDoc",
  "plugins",
  "bookmarks",
  "readProgress",
  "catalog",
  "readingPlans",
  "graphWidget",
  "webArticles",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureSet = Readonly<Record<FeatureKey, boolean>>;

export const DEFAULT_FEATURES: FeatureSet = {
  notes: false,
  whiteboard: false,
  quizzes: false,
  flashcards: false,
  learnHub: false,
  forum: false,
  roadmaps: false,
  vocabulary: false,
  // Greenlit for the pilot: the course/spaces flow is the pilot's core.
  spaces: true,
  comments: false,
  graph: false,
  leaderboards: false,
  multiDoc: false,
  plugins: false,
  bookmarks: false,
  readProgress: false,
  catalog: false,
  readingPlans: false,
  graphWidget: false,
  webArticles: false,
};

// TODO(library agent): gate the library empty-state "Browse catalog"
// action on `catalog` as well (src/features/library/AllBooksTab.tsx,
// the `navigate("/browse")` Button in the empty state).

/** Human labels for the admin toggle list (settings). Not translated on
 *  purpose: the list is admin-only and the keys are what you type in SQL. */
export const FEATURE_META: Record<FeatureKey, { label: string; hint: string }> = {
  notes: { label: "Notes", hint: "Note editor, library notes, reader notes tab" },
  whiteboard: { label: "Whiteboard and drawing", hint: "Whiteboards, draw-on-page, quick draw" },
  quizzes: { label: "Quizzes", hint: "Quiz list, editor, review, book exams tab" },
  flashcards: { label: "Flashcards", hint: "Flashcard learn method, save-as-flashcards" },
  learnHub: { label: "Learn hub", hint: "Book page Learn tab with the method list" },
  forum: { label: "Forum", hint: "Forum, communities, book discuss tab" },
  roadmaps: { label: "Roadmaps", hint: "Roadmap list, editor, chat roadmap skill" },
  vocabulary: { label: "Vocabulary", hint: "Vocabulary page" },
  spaces: { label: "Spaces", hint: "Spaces, prompt gallery" },
  comments: { label: "Comments", hint: "Annotation comments sidebar" },
  graph: { label: "Conversation graph", hint: "Graph tab in the reader tools panel" },
  webArticles: { label: "Web pages + extension", hint: "Save non-YouTube links to the library and use the browser extension's side-panel chat (YouTube links are always allowed)" },
  graphWidget: { label: "Graph widget (AI)", hint: "```graph blocks in replies render as an editable diagram; spec added to the chat prompt" },
  leaderboards: { label: "Leaderboards", hint: "Streak leaderboards page" },
  plugins: { label: "Plugins", hint: "Plugin system: settings tab and every enabled plugin (all unloaded when off)" },
  bookmarks: { label: "Bookmarks", hint: "Bookmark button, Ctrl+B, sidebar bookmarks tab, book bookmarks tab" },
  readProgress: { label: "Read progress strip", hint: "Thin overlay over the reader scrollbar showing how far you have read" },
  multiDoc: { label: "Multiple open documents", hint: "Reader document tabs; off = opening a book replaces the current one" },
  catalog: { label: "Catalog", hint: "Public catalog / Browse: off = bring your own books" },
  readingPlans: { label: "Reading plans", hint: "Reading plans on the streaks page" },
};

export function isFeatureKey(v: unknown): v is FeatureKey {
  return typeof v === "string" && (FEATURE_KEYS as readonly string[]).includes(v);
}

/** Parse the `features` entry of profiles.preferences (string[] of keys). */
export function serverUnlockedFeatures(
  preferences: Record<string, unknown> | null | undefined,
): FeatureKey[] {
  const raw = preferences?.features;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isFeatureKey);
}

export function resolveFeatures(input: {
  serverUnlocked: readonly FeatureKey[];
  localOverrides: Partial<Record<FeatureKey, boolean>>;
  showAll: boolean;
}): FeatureSet {
  const out = { ...DEFAULT_FEATURES } as Record<FeatureKey, boolean>;
  for (const key of FEATURE_KEYS) {
    const local = input.localOverrides[key];
    if (typeof local === "boolean") {
      out[key] = local;
    } else if (input.showAll) {
      out[key] = true;
    } else if (input.serverUnlocked.includes(key)) {
      out[key] = true;
    }
  }
  return out;
}
