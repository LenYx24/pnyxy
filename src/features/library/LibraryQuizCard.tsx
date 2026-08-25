import type { Quiz } from "@/types/quiz";
import { EntityCard, type EntityCardProps } from "./entity/EntityCard";
import { useQuizDescriptor } from "./entity/descriptors";

/** Grid card for a quiz in the library filetree; see EntityCard. */
export function LibraryQuizCard({
  quiz,
  ...props
}: EntityCardProps & { quiz: Quiz }) {
  return <EntityCard descriptor={useQuizDescriptor(quiz)} {...props} />;
}
