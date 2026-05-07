// Shared helpers for the AI-coaching learn methods (Feynman, ELI5,
// Socratic). Kept in a separate file so AiCoachMethodPage can stay a
// pure component module — react-refresh refuses to hot-reload modules
// that mix component and non-component exports.

export const COACH_SLUGS = new Set(["feynman", "eli5", "socratic"]);

export function isAiCoachSlug(slug: string | undefined): boolean {
  return !!slug && COACH_SLUGS.has(slug);
}
