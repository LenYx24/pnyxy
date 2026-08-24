import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import {
  history,
  historyKeymap,
  defaultKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Code,
  List,
  Quote,
  Link as LinkIcon,
  Sparkles,
  BookmarkPlus,
} from "lucide-react";
import { useNoteStore } from "@/stores/note-store";
import { useActiveDocument } from "@/stores/reader-store";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { livePreview } from "./cm-live-preview";

/**
 * Obsidian-style markdown note editor (CodeMirror 6). The document is the
 * raw markdown, stored verbatim (so old notes + the offline sync queue
 * are unaffected), and `livePreview` renders it inline, revealing the
 * raw syntax only on the line the cursor is on.
 *
 * Two book-aware extras: insert a `[p. N](/reader/<id>?page=N)` citation
 * for the reader's current page, and send the selection to the AI chat.
 */
interface NoteEditorProps {
  noteId: string;
}

const cmTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "14px",
    color: "var(--color-text-primary)",
    backgroundColor: "transparent",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "1.65",
    overflow: "auto",
  },
  ".cm-content": { padding: "12px 16px", caretColor: "var(--color-accent)" },
  ".cm-line": { padding: "0 2px" },
  "&.cm-focused .cm-cursor": { borderLeftColor: "var(--color-accent)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-accent) 22%, transparent)",
  },
});

export function NoteEditor({ noteId }: NoteEditorProps) {
  const { t } = useTranslation();
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);
  const navigate = useNavigate();
  const activeDoc = useActiveDocument();

  const [title, setTitle] = useState(note?.title ?? "");
  // Sync the title once the note first resolves (it may load async after
  // the first render). In-render guard, so no setState-in-effect.
  const [titleSynced, setTitleSynced] = useState(false);
  if (note && !titleSynced) {
    setTitleSynced(true);
    setTitle(note.title);
  }
  const titleRef = useRef(title);
  titleRef.current = title;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const debouncedSave = useCallback(
    (patch: { title?: string; content?: string }) => {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => updateNote(noteId, patch), 500);
    },
    [noteId, updateNote],
  );
  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef(note?.content ?? "");
  contentRef.current = note?.content ?? contentRef.current;
  const loaded = !!note;

  // Build the editor once the note is available. Recreated only when the
  // note id changes, typing updates the store but not these deps, so the
  // CM instance (and cursor) survive re-renders.
  useEffect(() => {
    if (!containerRef.current || !loaded) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: contentRef.current,
        extensions: [
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          markdown({ base: markdownLanguage }),
          syntaxHighlighting(defaultHighlightStyle),
          livePreview,
          EditorView.lineWrapping,
          placeholder(t("notes.contentPlaceholder")),
          cmTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) {
              debouncedSave({
                title: titleRef.current,
                content: u.state.doc.toString(),
              });
            }
          }),
          EditorView.domEventHandlers({
            mousedown(e, view) {
              // click below the last line → put the cursor at the end
              // (so the whole panel height is clickable)
              if (view.posAtCoords({ x: e.clientX, y: e.clientY }) == null) {
                view.dispatch({ selection: { anchor: view.state.doc.length } });
                view.focus();
                return true;
              }
              return false;
            },
          }),
        ],
      }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, loaded]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setTitle(val);
    debouncedSave({ title: val });
  };

  const wrap = useCallback((before: string, after: string = before) => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const selected = view.state.sliceDoc(from, to);
    view.dispatch({
      changes: { from, to, insert: before + selected + after },
      selection: {
        anchor: from + before.length,
        head: from + before.length + selected.length,
      },
    });
    view.focus();
  }, []);

  const prefixLine = useCallback((prefix: string) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.lineAt(view.state.selection.main.from);
    view.dispatch({
      changes: { from: line.from, insert: prefix },
      selection: { anchor: view.state.selection.main.from + prefix.length },
    });
    view.focus();
  }, []);

  const handleInsertPageLink = useCallback(() => {
    const view = viewRef.current;
    if (!view || !activeDoc) return;
    const page = activeDoc.currentPage;
    const snippet = `[p. ${page}](/reader/${activeDoc.meta.id}?page=${page})`;
    const { from, to } = view.state.selection.main;
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: from + snippet.length },
    });
    view.focus();
  }, [activeDoc]);

  const handleLink = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const label = view.state.sliceDoc(from, to) || "text";
    const snippet = `[${label}](url)`;
    // drop the cursor on `url` so it can be typed over
    const urlFrom = from + label.length + 3;
    view.dispatch({
      changes: { from, to, insert: snippet },
      selection: { anchor: urlFrom, head: urlFrom + 3 },
    });
    view.focus();
  }, []);

  const handleSendToAi = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const snippet = view.state.sliceDoc(from, to).trim();
    if (!snippet) return;
    useChatStore.getState().setPendingDraft({
      text: `> ${snippet.replace(/\n/g, "\n> ")}\n\n`,
      source: activeDoc
        ? {
            docId: activeDoc.meta.id,
            docTitle: activeDoc.customTitle || activeDoc.meta.title || "Untitled",
            page: activeDoc.currentPage ?? null,
          }
        : null,
    });
    const openInReader = useUIStore.getState().openReaderAiChat;
    if (openInReader) openInReader();
    else navigate("/chat");
  }, [activeDoc, navigate]);

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        {t("notes.notFound")}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <input
        type="text"
        value={title}
        onChange={handleTitleChange}
        placeholder={t("notes.titlePlaceholder")}
        className="w-full border-b border-glass-border bg-transparent px-4 py-3 text-base font-medium text-text-primary outline-none placeholder:text-text-muted"
      />
      <div className="flex flex-wrap items-center gap-0.5 border-b border-glass-border px-2 py-1.5">
        <ToolBtn onClick={() => wrap("**")} label={t("notes.editor.bold", { defaultValue: "Bold" })}>
          <Bold size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => wrap("*")} label={t("notes.editor.italic", { defaultValue: "Italic" })}>
          <Italic size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => wrap("`")} label={t("notes.editor.code", { defaultValue: "Inline code" })}>
          <Code size={14} />
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={() => prefixLine("# ")} label={t("notes.editor.h1", { defaultValue: "Heading 1" })}>
          <Heading1 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => prefixLine("## ")} label={t("notes.editor.h2", { defaultValue: "Heading 2" })}>
          <Heading2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => prefixLine("- ")} label={t("notes.editor.bullet", { defaultValue: "Bullet list" })}>
          <List size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => prefixLine("> ")} label={t("notes.editor.quote", { defaultValue: "Blockquote" })}>
          <Quote size={14} />
        </ToolBtn>
        <Sep />
        <ToolBtn onClick={handleLink} label={t("notes.editor.link", { defaultValue: "Link" })}>
          <LinkIcon size={14} />
        </ToolBtn>
        {activeDoc && (
          <ToolBtn
            onClick={handleInsertPageLink}
            label={t("notes.editor.pageLink", {
              defaultValue: "Insert link to current PDF page",
            })}
          >
            <BookmarkPlus size={14} />
          </ToolBtn>
        )}
        <ToolBtn
          onClick={handleSendToAi}
          label={t("notes.editor.sendToAi", {
            defaultValue: "Send selection to AI chat",
          })}
        >
          <Sparkles size={14} />
        </ToolBtn>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}

function ToolBtn({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded p-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-glass-border" />;
}
