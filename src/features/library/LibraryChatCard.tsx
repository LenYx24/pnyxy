import type { ChatConversation } from "@/types/chat";
import { EntityCard, type EntityCardProps } from "./entity/EntityCard";
import { useChatDescriptor } from "./entity/descriptors";

/** Grid card for an LLM conversation in the library filetree; see EntityCard. */
export function LibraryChatCard({
  conversation,
  ...props
}: EntityCardProps & { conversation: ChatConversation }) {
  return <EntityCard descriptor={useChatDescriptor(conversation)} {...props} />;
}
