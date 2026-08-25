import type { Quiz } from "@/types/quiz";
import { EntityRow, type EntityRowProps } from "../entity/EntityRow";
import { useQuizDescriptor } from "../entity/descriptors";

/** List-view row for a quiz; see EntityRow. */
export function QuizRow({
  quiz,
  ...props
}: EntityRowProps & { quiz: Quiz }) {
  return <EntityRow descriptor={useQuizDescriptor(quiz)} {...props} />;
}
