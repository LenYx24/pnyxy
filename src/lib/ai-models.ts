/**
 * Single source of truth for the LLM choices the user can pick from
 * in the chat composer's ModelPicker. Drives both the dropdown and
 * the in-app help modal.
 *
 * Adding a new model means: extend `AI_MODEL_CATALOG`, then ensure
 * the matching provider key is wired up in `ai-client.ts`. Today
 * each provider is mapped to a single deployed model — multi-model
 * selection per provider is a planned next iteration.
 */

import type { AiProvider } from "@/stores/settings-store";

export interface ModelInfo {
  /** Provider identifier — drives routing through `ai-client.ts`. */
  provider: AiProvider;
  /** Human-readable model name shown in dropdown + modal. */
  displayName: string;
  /** Underlying API model id (informational only — used for the
   *  "Model id" line in the help modal so users can verify what's
   *  actually being called). */
  modelId: string;
  /** One-paragraph description: what kind of model is it, what's its
   *  niche, and any notable trait. Plain prose, no headings. */
  description: string;
  /** Two-three concrete use cases the user will recognise.
   *  Concise — they go into a bullet list under the description. */
  bestFor: string[];
  /** Subjective speed (relative to the other entries here). */
  speed: "fast" | "medium" | "slow";
  /** Subjective capability tier. */
  power: "basic" | "balanced" | "powerful";
  /** Average tokens an in-app turn spends — informational, helps the
   *  user estimate how many chats fit in the daily quota. */
  estimatedTokensPerTurn: {
    input: number;
    output: number;
    total: number;
  };
  /** Free-form note about cost / billing path. */
  costNotes: string;
  /** Marketing-grade context window (e.g. "200k tokens"). */
  contextWindow: string;
  /** Where requests are routed — surfaced in the dropdown's subtitle. */
  routingNote: string;
}

/**
 * Pnyxy daily free quota (per signed-in user). Sourced from
 * `supabase/migrations/00008_ai_usage.sql`. If the migration changes
 * these numbers, mirror them here so the modal stays accurate.
 */
export const PNYXY_DAILY_TOKEN_QUOTA = 50_000;
export const PNYXY_DAILY_REQUEST_QUOTA = 200;

/**
 * Token-cost estimates for a *typical* reader-context turn:
 *  - system prompt: ~400 tokens
 *  - book/page RAG context: ~800–1500 tokens
 *  - user message: ~30–100 tokens
 *  - prior conversation: ~500–2000 tokens (grows over time)
 *  - assistant output: ~300 tokens (short explanation), up to ~1000
 *
 * The "average" we surface (~2500–3000 total) is a reasonable midpoint
 * for "I quoted a paragraph and asked one follow-up." Long roleplays
 * and code generation can go several times higher; short clarifying
 * questions can be half this.
 */
const TYPICAL_INPUT = 2200;
const TYPICAL_OUTPUT = 350;

export const AI_MODEL_CATALOG: ModelInfo[] = [
  {
    provider: "pnyxy",
    displayName: "Claude Haiku 4.5",
    modelId: "claude-haiku-4-5",
    description:
      "Anthropic gyors, hatékony modellje. A Pnyxy ingyenes proxyján keresztül elérhető — nem kell saját API-kulcs, viszont napi kvóta korlátozza. Idézet-alapú olvasói chathez, gyors kérdés-válaszhoz, flashcard-kinyeréshez bőven elég.",
    bestFor: [
      "Olvasás közbeni gyors kérdések",
      "Fogalom-magyarázat egy kijelölt szakaszra",
      "Flashcard- és kvíz-generálás kötött kontextusból",
    ],
    speed: "fast",
    power: "basic",
    estimatedTokensPerTurn: {
      input: TYPICAL_INPUT,
      output: TYPICAL_OUTPUT,
      total: TYPICAL_INPUT + TYPICAL_OUTPUT,
    },
    costNotes: `Ingyenes a Pnyxy szerverén keresztül. Napi limit: ${PNYXY_DAILY_TOKEN_QUOTA.toLocaleString()} token / ${PNYXY_DAILY_REQUEST_QUOTA} kérés (≈ ${Math.floor(
      PNYXY_DAILY_TOKEN_QUOTA / (TYPICAL_INPUT + TYPICAL_OUTPUT),
    )} átlagos chat-fordulóra elég naponta).`,
    contextWindow: "200k token",
    routingNote: "Pnyxy ingyenes kvóta",
  },
  {
    provider: "anthropic",
    displayName: "Claude Sonnet 4.5",
    modelId: "claude-sonnet-4-5-20250929",
    description:
      "Anthropic erősebb, kiegyensúlyozott modellje. Mélyebb gondolkodást, hosszabb és pontosabb válaszokat ad, jó komplex könyv-szakaszok megértésében és roadmap-szerű tervezésben. Saját Anthropic API-kulcsot igényel.",
    bestFor: [
      "Hosszú, komplex szakaszok elemzése",
      "Strukturált roadmap-, kvíz-, esszé-vázlat generálás",
      "Tool-use (a Pnyxy-ben kvíz/roadmap entitások létrehozása)",
    ],
    speed: "medium",
    power: "balanced",
    estimatedTokensPerTurn: {
      input: TYPICAL_INPUT,
      output: TYPICAL_OUTPUT * 2,
      total: TYPICAL_INPUT + TYPICAL_OUTPUT * 2,
    },
    costNotes:
      "Saját Anthropic kulcsról fizet. Tájékoztató ár (2026): ≈ $3 / 1M input token, $15 / 1M output token. Egy átlagos chat-forduló nagyjából $0,015–0,02-be kerül.",
    contextWindow: "200k token",
    routingNote: "Saját Anthropic kulcs",
  },
  {
    provider: "openai",
    displayName: "GPT-4o mini",
    modelId: "gpt-4o-mini",
    description:
      "OpenAI olcsó, gyors modellje — a GPT-4 család könnyű változata. Általános chat-feladatokra elég, magyar nyelvi pontossága jó, költsége alacsony. Saját OpenAI API-kulcsot igényel.",
    bestFor: [
      "Általános gyors válaszok",
      "Egyszerűbb kérdés-felelet, fordítás",
      "Backup/fallback ha a Claude éppen elérhetetlen",
    ],
    speed: "fast",
    power: "basic",
    estimatedTokensPerTurn: {
      input: TYPICAL_INPUT,
      output: TYPICAL_OUTPUT,
      total: TYPICAL_INPUT + TYPICAL_OUTPUT,
    },
    costNotes:
      "Saját OpenAI kulcsról fizet. Tájékoztató ár (2026): ≈ $0,15 / 1M input token, $0,60 / 1M output token. Egy átlagos forduló ≈ $0,001 — gyakorlatilag fillérek.",
    contextWindow: "128k token",
    routingNote: "Saját OpenAI kulcs",
  },
];

/** Lookup by provider key. Fast path for the dropdown + modal. */
export const MODEL_BY_PROVIDER: Record<AiProvider, ModelInfo> =
  AI_MODEL_CATALOG.reduce(
    (acc, m) => {
      acc[m.provider] = m;
      return acc;
    },
    {} as Record<AiProvider, ModelInfo>,
  );
