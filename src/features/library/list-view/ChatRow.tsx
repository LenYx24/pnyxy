import type { ChatConversation } from "@/types/chat";
import { EntityRow, type EntityRowProps } from "../entity/EntityRow";
import { useChatDescriptor } from "../entity/descriptors";

/** List-view row for an LLM conversation; see EntityRow. */
export function ChatRow({
  conversation,
  ...props
}: EntityRowProps & { conversation: ChatConversation }) {
  return <EntityRow descriptor={useChatDescriptor(conversation)} {...props} />;
}
