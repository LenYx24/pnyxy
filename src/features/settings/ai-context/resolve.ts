import type { AiContextBindings, AiContextPreset } from "./types";

export interface AiContextResolveState {
  aiContexts: readonly AiContextPreset[];
  aiDefaultContextId: string | null;
  aiContextBindings: AiContextBindings;
}

export interface AiContextScope {
  bookId?: string | null;
  folderId?: string | null;
  orgId?: string | null;
  /** Explicit per-conversation pick (session override). Beats everything. */
  overridePresetId?: string | null;
}

export type AiContextSource = "override" | "book" | "folder" | "org" | "default";

export interface ResolvedAiContext {
  preset: AiContextPreset;
  source: AiContextSource;
}

/**
 * Pick the preset that applies to a scope. Precedence:
 * override > book > folder > org > default. A binding that points at a
 * deleted preset is skipped so the next level still gets a chance.
 * Pure: no store access, safe to unit test.
 */
export function resolveAiContext(
  state: AiContextResolveState,
  scope: AiContextScope = {},
): ResolvedAiContext | null {
  const byId = new Map(state.aiContexts.map((p) => [p.id, p]));
  const pick = (
    id: string | null | undefined,
    source: AiContextSource,
  ): ResolvedAiContext | null => {
    if (!id) return null;
    const preset = byId.get(id);
    return preset ? { preset, source } : null;
  };
  const { books, folders, orgs } = state.aiContextBindings;
  return (
    pick(scope.overridePresetId, "override") ??
    pick(scope.bookId ? books[scope.bookId] : null, "book") ??
    pick(scope.folderId ? folders[scope.folderId] : null, "folder") ??
    pick(scope.orgId ? orgs[scope.orgId] : null, "org") ??
    pick(state.aiDefaultContextId, "default")
  );
}

/** The markdown body to inject, or "" when nothing applies / body is blank. */
export function resolveAiContextBody(
  state: AiContextResolveState,
  scope: AiContextScope = {},
): string {
  return resolveAiContext(state, scope)?.preset.body.trim() ?? "";
}
