// Teacher mode ("Tanár mód") v1: Socratic guardrail appended to the
// DEFAULT chat system prompts, enforced server-side so pilot users
// can't bypass it. Never applied to `systemPromptOverride` flows
// (quiz generation, recommendations, roadmap agent). The text lives in
// chat-prompts.ts, shared with the browser.
//
// Escape hatch without a code change: `supabase secrets set TEACHER_MODE=off`.
import "./deno-shim.ts";
import { TEACHER_GUARDRAIL } from "./chat-prompts.ts";

export { TEACHER_GUARDRAIL };

/** Block to concatenate onto a default system prompt ("" when disabled). */
export function teacherBlock(): string {
  if (Deno.env.get("TEACHER_MODE") === "off") return "";
  return `\n\n${TEACHER_GUARDRAIL}`;
}
