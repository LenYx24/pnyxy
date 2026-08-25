import type { WhiteboardData } from "@/types/whiteboard";
import { EntityCard, type EntityCardProps } from "./entity/EntityCard";
import { useWhiteboardDescriptor } from "./entity/descriptors";

/** Grid card for a whiteboard in the library filetree; see EntityCard. */
export function LibraryWhiteboardCard({
  whiteboard,
  ...props
}: EntityCardProps & { whiteboard: WhiteboardData }) {
  return <EntityCard descriptor={useWhiteboardDescriptor(whiteboard)} {...props} />;
}
