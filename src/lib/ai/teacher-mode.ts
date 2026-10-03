/**
 * Teacher mode ("Tanár mód") v1: a Socratic guardrail appended to the
 * DEFAULT chat system prompts. It never applies to functional flows
 * that pass `systemPromptOverride` (quiz generation, recommendations,
 * title autogen, roadmap agent).
 *
 * Always on during the pilot; `TEACHER_MODE_ENABLED` is the code-level
 * switch. The Pnyxy proxy enforces the same block server-side
 * (supabase/functions/_shared/teacher-mode.ts); the text itself lives in
 * the shared chat-prompts module, this switch covers the BYOK/local paths.
 */

import { TEACHER_GUARDRAIL } from "./chat-prompts";

export { TEACHER_GUARDRAIL };

export const TEACHER_MODE_ENABLED = true;

/** Block to concatenate onto a default system prompt ("" when disabled). */
export function teacherBlock(): string {
  return TEACHER_MODE_ENABLED ? `\n\n${TEACHER_GUARDRAIL}` : "";
}
