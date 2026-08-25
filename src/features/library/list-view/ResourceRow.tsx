import type { Resource } from "@/types/resource";
import { EntityRow, type EntityRowProps } from "../entity/EntityRow";
import { useResourceDescriptor } from "../entity/descriptors";

/** List-view row for a saved web page / YouTube link (beta); see EntityRow. */
export function ResourceRow({
  resource,
  ...props
}: EntityRowProps & { resource: Resource }) {
  return <EntityRow descriptor={useResourceDescriptor(resource)} {...props} />;
}
