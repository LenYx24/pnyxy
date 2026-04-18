import { useCallback, useEffect, useRef, useState } from "react";
import { useNoteStore } from "@/stores/note-store";

interface NoteEditorProps {
  noteId: string;
}

export function NoteEditor({ noteId }: NoteEditorProps) {
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);

  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync when note loads. We intentionally only re-run when noteId changes
  // — depending on `note` would reset local edits on every store update.
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const debouncedSave = useCallback(
    (patch: { title?: string; content?: string }) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateNote(noteId, patch);
      }, 500);
    },
    [noteId, updateNote],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => clearTimeout(saveTimerRef.current);
  }, []);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    debouncedSave({ title: val, content });
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    debouncedSave({ title, content: val });
  };

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-text-muted">
        Note not found
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      <input
        type="text"
        value={title}
        onChange={handleTitleChange}
        placeholder="Note title..."
        className="w-full bg-transparent border-b border-glass-border px-4 py-3 text-base font-medium text-text-primary outline-none placeholder:text-text-muted"
      />
      <textarea
        value={content}
        onChange={handleContentChange}
        placeholder="Start writing..."
        className="flex-1 w-full bg-transparent px-4 py-3 text-sm text-text-primary outline-none resize-none font-mono placeholder:text-text-muted"
      />
    </div>
  );
}
