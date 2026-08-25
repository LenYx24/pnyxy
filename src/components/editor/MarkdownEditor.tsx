/**
 * MarkdownEditor: the one rich-text surface shared by the app. A
 * toolbar-less TipTap editor (StarterKit input rules only: `#` headings,
 * `**bold**`, `-` / `1.` lists, `>` quotes, ``` code blocks) whose value
 * goes in and out as a Markdown string via tiptap-markdown, so the stored
 * format stays plain text. Styled as a Neutral `.field`-like block (surface-2,
 * rounded-panel, 1 px tone outline so it stays visible on surface-2 parents). `onChange` is debounced (300 ms default) so
 * persisted callers don't write on every keystroke; `flush` on blur makes
 * sure the last edit lands. Used by the AI context presets today and meant
 * to be reused by the TipTap-based note editor.
 */
import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Markdown } from "tiptap-markdown";
import { cn } from "@/lib/cn";
import "./markdown-editor.css";

export interface MarkdownEditorProps {
  /** Markdown source. The editor re-parses only when it differs from what it last emitted. */
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  /** Debounce for onChange, ms. 0 = immediate. */
  debounceMs?: number;
  /** Optional cap; typing past it is allowed but `onLengthChange` lets the caller show a count. */
  onLengthChange?: (chars: number) => void;
  /** Small "Markdown" hint chip in the bottom-right corner. */
  showMarkdownHint?: boolean;
  minHeight?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder,
  debounceMs = 300,
  onLengthChange,
  showMarkdownHint = true,
  minHeight = 160,
  disabled = false,
  autoFocus = false,
  className,
  id,
}: MarkdownEditorProps) {
  const lastEmitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onLengthRef = useRef(onLengthChange);
  onLengthRef.current = onLengthChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // keep the surface small: no links/underline auto-magic in a prompt editor
        link: false,
        underline: false,
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      Markdown.configure({
        html: false,
        tightLists: true,
        transformPastedText: true,
        transformCopiedText: true,
      }),
    ],
    content: value,
    editable: !disabled,
    autofocus: autoFocus ? "end" : false,
    editorProps: {
      attributes: {
        class: "md-editor__content",
        ...(id ? { id } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const md = (ed.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      onLengthRef.current?.(md.length);
      if (timer.current) clearTimeout(timer.current);
      const emit = () => {
        timer.current = null;
        if (md === lastEmitted.current) return;
        lastEmitted.current = md;
        onChangeRef.current(md);
      };
      if (debounceMs <= 0) emit();
      else timer.current = setTimeout(emit, debounceMs);
    },
    onBlur: () => {
      // flush a pending debounce so the last keystrokes are not lost on navigation
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      if (!editor) return;
      const md = (editor.storage as unknown as { markdown: { getMarkdown(): string } }).markdown.getMarkdown();
      if (md !== lastEmitted.current) {
        lastEmitted.current = md;
        onChangeRef.current(md);
      }
    },
  });

  // External value change (preset switch, remote hydrate): reload content.
  useEffect(() => {
    if (!editor) return;
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
    onLengthRef.current?.(value.length);
  }, [editor, value]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (!editor) return;
    onLengthRef.current?.(value.length);
    // initial count only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <div
      className={cn(
        "md-editor rounded-panel bg-bg-tertiary",
        disabled && "opacity-50",
        className,
      )}
      style={{ minHeight }}
      onClick={() => editor?.commands.focus()}
    >
      <EditorContent editor={editor} className="md-editor__scroll" />
      {showMarkdownHint && (
        <span className="md-editor__hint chip" aria-hidden>
          Markdown
        </span>
      )}
    </div>
  );
}
