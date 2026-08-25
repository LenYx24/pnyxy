import type { Resource } from "@/types/resource";
import { EntityCard, type EntityCardProps } from "./entity/EntityCard";
import { useResourceDescriptor } from "./entity/descriptors";

/** Grid card for a saved web page / YouTube link (beta) in the library filetree; see EntityCard. */
export function LibraryResourceCard({
  resource,
  ...props
}: EntityCardProps & { resource: Resource }) {
  return <EntityCard descriptor={useResourceDescriptor(resource)} {...props} />;
}
