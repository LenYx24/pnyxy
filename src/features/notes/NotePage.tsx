import { useEffect } from "react";
import { useParams, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { useNoteStore } from "@/stores/note-store";
import { NoteEditor } from "./NoteEditor";

/**
 * Standalone full-page note view, reached from the library filetree at
 * `/notes/:noteId`. Notes used to only be editable inside a book's
 * Notes tab or the Workspace list; opening one as its own "file" is
 * what makes the library-as-filetree model feel right.
 *
 * Thin wrapper: ensure the local note list is hydrated from IndexedDB
 * (the user may deep-link / refresh straight onto this route), give the
 * editor a height-bearing container + a back affordance, and delegate
 * the rest to the shared NoteEditor.
 */
export function NotePage() {
  const { noteId } = useParams<{ noteId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const notes = useNoteStore((s) => s.notes);
  const loadNotes = useNoteStore((s) => s.loadNotes);

  // Hydrate once if the store is empty, a direct navigation / refresh
  // onto this route won't have gone through any page that loads notes.
  useEffect(() => {
    if (notes.length === 0) void loadNotes();
  }, [notes.length, loadNotes]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-glass-border px-3 py-2">
        <button
          type="button"
          onClick={() => navigate("/library")}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
        >
          <ArrowLeft size={16} />
          {t("notes.backToLibrary", { defaultValue: "Library" })}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {noteId && <NoteEditor noteId={noteId} />}
      </div>
    </div>
  );
}
