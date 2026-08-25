import type { Note } from "@/stores/note-store";
import { EntityCard, type EntityCardProps } from "./entity/EntityCard";
import { useNoteDescriptor } from "./entity/descriptors";

/** Grid card for a note in the library filetree; see EntityCard. */
export function LibraryNoteCard({
  note,
  ...props
}: EntityCardProps & { note: Note }) {
  return <EntityCard descriptor={useNoteDescriptor(note)} {...props} />;
}
