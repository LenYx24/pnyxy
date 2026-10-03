// Browser entry to the shared prompt module; the proxy imports the same file
// directly, so the BYOK and Pnyxy routes always send identical prompts.
export * from "../../../supabase/functions/_shared/chat-prompts.ts";
