import type { Note } from "@/stores/note-store";
import { EntityRow, type EntityRowProps } from "../entity/EntityRow";
import { useNoteDescriptor } from "../entity/descriptors";

/** List-view row for a note; see EntityRow. */
export function NoteRow({
  note,
  ...props
}: EntityRowProps & { note: Note }) {
  return <EntityRow descriptor={useNoteDescriptor(note)} {...props} />;
}
