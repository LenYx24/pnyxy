import type { WhiteboardData } from "@/types/whiteboard";
import { EntityRow, type EntityRowProps } from "../entity/EntityRow";
import { useWhiteboardDescriptor } from "../entity/descriptors";

/** List-view row for a whiteboard; see EntityRow. */
export function WhiteboardRow({
  whiteboard,
  ...props
}: EntityRowProps & { whiteboard: WhiteboardData }) {
  return <EntityRow descriptor={useWhiteboardDescriptor(whiteboard)} {...props} />;
}
