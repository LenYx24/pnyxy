import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bold,
  Italic,
  Heading1,
  Heading2,
  Code,
  List,
  ListOrdered,
  Quote,
  Link as LinkIcon,
  Sparkles,
  BookmarkPlus,
  Eye,
  Pencil,
  Columns2,
} from "lucide-react";
import { useNoteStore } from "@/stores/note-store";
import { useActiveDocument } from "@/stores/reader-store";
import { useChatStore } from "@/stores/chat-store";
import { useUIStore } from "@/stores/ui-store";
import { renderMarkdown, handleCodeBlockCopy } from "@/lib/ai/markdown-message";
import { useIsDesktop } from "@/hooks/use-media-query";
import { usePageCitationDispatch } from "@/hooks/use-page-citation";
import { cn } from "@/lib/cn";

/**
 * Markdown note editor.
 *
 * Layout:
 *   - Desktop & wider tablet: split pane — textarea on the left,
 *     rendered preview on the right. Both scroll independently.
 *   - Narrow / mobile: single pane that toggles between edit and
 *     preview via the same view-mode segmented control.
 *
 * Formatting toolbar at the top with the conventional keyboard
 * shortcuts (Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+1/2 / Ctrl+E / Ctrl+L).
 * Insertion lives in plain string manipulation against the textarea
 * — no CodeMirror / Tiptap dependency, since the bar is for "I want
 * to format this quickly" not full IDE-grade editing.
 *
 * Two book-aware extras:
 *   - "Insert PDF page link": when a doc is active in the reader,
 *     inserts a `[p. N](/reader/<id>?page=N)` citation. Renders as
 *     clickable in the preview AND in other views that use
 *     `renderMarkdown` (chat, etc.).
 *   - "Send selection to AI": stashes the selected text + book
 *     context into `chat-store.pendingDraft` and asks the reader's
 *     AI chat panel to open — same pipeline the highlight context
 *     menu uses.
 */
interface NoteEditorProps {
  noteId: string;
}

type ViewMode = "edit" | "preview" | "split";

export function NoteEditor({ noteId }: NoteEditorProps) {
  const { t } = useTranslation();
  const note = useNoteStore((s) => s.notes.find((n) => n.id === noteId));
  const updateNote = useNoteStore((s) => s.updateNote);
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const activeDoc = useActiveDocument();
  const handleCitationClick = usePageCitationDispatch();

  const [title, setTitle] = useState(note?.title ?? "");
  const [content, setContent] = useState(note?.content ?? "");
  const [viewMode, setViewMode] = useState<ViewMode>(
    isDesktop ? "split" : "edit",
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Switch the default split→edit when the viewport drops to mobile
  // and back. Doesn't fight an explicit user pick — once you've
  // chosen, your pick sticks for the rest of the session.
  const explicitViewMode = useRef(false);
  useEffect(() => {
    if (explicitViewMode.current) return;
    setViewMode(isDesktop ? "split" : "edit");
  }, [isDesktop]);

  // Sync local state when switching to a different note. Don't depend
  // on `note` directly — that would clobber unsaved edits on every
  // store ping.
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

  useEffect(() => () => clearTimeout(saveTimerRef.current), []);

  // ─── Formatting primitives ─────────────────────────────────────

  const applyChange = useCallback(
    (newContent: string, nextSelectionStart: number, nextSelectionEnd: number) => {
      setContent(newContent);
      debouncedSave({ title, content: newContent });
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.selectionStart = nextSelectionStart;
        ta.selectionEnd = nextSelectionEnd;
      });
    },
    [title, debouncedSave],
  );

  /** Wrap the selection with `before` / `after`. If nothing is
   *  selected, drops the wrap at the cursor and places the cursor
   *  between the markers. Toggles off when the selection is already
   *  wrapped (so Ctrl+B on a bold word un-bolds it). */
  const wrapSelection = useCallback(
    (before: string, after: string = before) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const selected = content.slice(start, end);

      // Toggle: if selection already starts/ends with the markers,
      // strip them.
      if (
        selected.length >= before.length + after.length &&
        selected.startsWith(before) &&
        selected.endsWith(after)
      ) {
        const stripped = selected.slice(
          before.length,
          selected.length - after.length,
        );
        const newContent =
          content.slice(0, start) + stripped + content.slice(end);
        applyChange(newContent, start, start + stripped.length);
        return;
      }

      const newContent =
        content.slice(0, start) +
        before +
        selected +
        after +
        content.slice(end);
      applyChange(
        newContent,
        start + before.length,
        end + before.length,
      );
    },
    [content, applyChange],
  );

  /** Toggle a line-prefix marker (`# `, `- `, `> `, etc.) on the
   *  current cursor line. Works against the whole selection — if you
   *  select 3 lines and hit list, all three get bulleted. */
  const togglePrefix = useCallback(
    (prefix: string) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const selStart = ta.selectionStart;
      const selEnd = ta.selectionEnd;
      const lineStart = content.lastIndexOf("\n", selStart - 1) + 1;
      const lineEnd =
        content.indexOf("\n", selEnd) === -1
          ? content.length
          : content.indexOf("\n", selEnd);
      const block = content.slice(lineStart, lineEnd);
      const lines = block.split("\n");
      const allPrefixed = lines.every((l) => l.startsWith(prefix));
      const newLines = lines.map((l) =>
        allPrefixed ? l.slice(prefix.length) : prefix + l,
      );
      const newBlock = newLines.join("\n");
      const newContent =
        content.slice(0, lineStart) + newBlock + content.slice(lineEnd);
      const delta = (allPrefixed ? -1 : 1) * prefix.length * lines.length;
      applyChange(
        newContent,
        Math.max(lineStart, selStart + (allPrefixed ? -prefix.length : prefix.length)),
        selEnd + delta,
      );
    },
    [content, applyChange],
  );

  const insertAtCursor = useCallback(
    (text: string, cursorOffsetFromEnd = 0) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newContent =
        content.slice(0, start) + text + content.slice(end);
      const cursorPos = start + text.length - cursorOffsetFromEnd;
      applyChange(newContent, cursorPos, cursorPos);
    },
    [content, applyChange],
  );

  const handleInsertLink = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const label = selected || t("notes.editor.linkLabel", { defaultValue: "text" });
    const snippet = `[${label}](url)`;
    const newContent =
      content.slice(0, start) + snippet + content.slice(end);
    // Drop the cursor on the placeholder URL so the user can type
    // over it immediately.
    const urlStart = start + label.length + 3; // after `[label](`
    const urlEnd = urlStart + 3; // covers `url`
    applyChange(newContent, urlStart, urlEnd);
  }, [content, applyChange, t]);

  // ─── Book-aware extras ─────────────────────────────────────────

  const handleInsertPageLink = useCallback(() => {
    if (!activeDoc) return;
    const page = activeDoc.currentPage;
    const docId = activeDoc.meta.id;
    const snippet = `[p. ${page}](/reader/${docId}?page=${page})`;
    insertAtCursor(snippet);
  }, [activeDoc, insertAtCursor]);

  const handleSendToAi = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const snippet = content.slice(start, end).trim();
    if (!snippet) return;

    useChatStore.getState().setPendingDraft({
      text: `> ${snippet.replace(/\n/g, "\n> ")}\n\n`,
      source: activeDoc
        ? {
            docId: activeDoc.meta.id,
            docTitle:
              activeDoc.customTitle || activeDoc.meta.title || "Untitled",
            page: activeDoc.currentPage ?? null,
          }
        : null,
    });
    const openInReader = useUIStore.getState().openReaderAiChat;
    if (openInReader) openInReader();
    else navigate("/chat");
  }, [content, activeDoc, navigate]);

  // ─── Keyboard shortcuts ────────────────────────────────────────

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      // Avoid swallowing the standard browser shortcuts (Cmd+C, Cmd+V,
      // Cmd+A, Cmd+Z) by only handling the keys we map here.
      switch (e.key.toLowerCase()) {
        case "b":
          e.preventDefault();
          wrapSelection("**");
          break;
        case "i":
          e.preventDefault();
          wrapSelection("*");
          break;
        case "e":
          e.preventDefault();
          wrapSelection("`");
          break;
        case "k":
          e.preventDefault();
          handleInsertLink();
          break;
        case "1":
          e.preventDefault();
          togglePrefix("# ");
          break;
        case "2":
          e.preventDefault();
          togglePrefix("## ");
          break;
        case "l":
          e.preventDefault();
          togglePrefix("- ");
          break;
      }
    },
    [wrapSelection, togglePrefix, handleInsertLink],
  );

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

  const rendered = useMemo(
    () => renderMarkdown(content, activeDoc?.meta.id ?? null),
    [content, activeDoc?.meta.id],
  );

  const pickView = (mode: ViewMode) => {
    explicitViewMode.current = true;
    setViewMode(mode);
  };

  if (!note) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        {t("notes.notFound")}
      </div>
    );
  }

  const showEditor = viewMode !== "preview";
  const showPreview = viewMode !== "edit";

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      <input
        type="text"
        value={title}
        onChange={handleTitleChange}
        placeholder={t("notes.titlePlaceholder")}
        className="w-full border-b border-glass-border bg-transparent px-4 py-3 text-base font-medium text-text-primary outline-none placeholder:text-text-muted"
      />
      <Toolbar
        onBold={() => wrapSelection("**")}
        onItalic={() => wrapSelection("*")}
        onCode={() => wrapSelection("`")}
        onH1={() => togglePrefix("# ")}
        onH2={() => togglePrefix("## ")}
        onBullet={() => togglePrefix("- ")}
        onOrdered={() => togglePrefix("1. ")}
        onQuote={() => togglePrefix("> ")}
        onLink={handleInsertLink}
        onInsertPageLink={activeDoc ? handleInsertPageLink : null}
        onSendToAi={handleSendToAi}
        viewMode={viewMode}
        onPickView={pickView}
        isDesktop={isDesktop}
      />
      <div className="flex min-h-0 flex-1">
        {showEditor && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            onKeyDown={handleKeyDown}
            placeholder={t("notes.contentPlaceholder")}
            className={cn(
              "min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-sm text-text-primary outline-none placeholder:text-text-muted",
              showPreview && "border-r border-glass-border",
            )}
            spellCheck
          />
        )}
        {showPreview && (
          <div
            className="ai-message min-h-0 flex-1 overflow-y-auto px-4 py-3 text-sm text-text-primary"
            onClick={(e) => {
              handleCodeBlockCopy(e);
              if (e.defaultPrevented) return;
              handleCitationClick(e);
            }}
            dangerouslySetInnerHTML={{ __html: rendered }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Toolbar ─────────────────────────────────────────────────────

interface ToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onCode: () => void;
  onH1: () => void;
  onH2: () => void;
  onBullet: () => void;
  onOrdered: () => void;
  onQuote: () => void;
  onLink: () => void;
  /** Null when there's no active reader doc to link to. */
  onInsertPageLink: (() => void) | null;
  onSendToAi: () => void;
  viewMode: ViewMode;
  onPickView: (mode: ViewMode) => void;
  isDesktop: boolean;
}

function Toolbar(props: ToolbarProps) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-glass-border px-2 py-1.5">
      <ToolBtn onClick={props.onBold} label={t("notes.editor.bold", { defaultValue: "Bold (Ctrl+B)" })}>
        <Bold size={14} />
      </ToolBtn>
      <ToolBtn onClick={props.onItalic} label={t("notes.editor.italic", { defaultValue: "Italic (Ctrl+I)" })}>
        <Italic size={14} />
      </ToolBtn>
      <ToolBtn onClick={props.onCode} label={t("notes.editor.code", { defaultValue: "Inline code (Ctrl+E)" })}>
        <Code size={14} />
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={props.onH1} label={t("notes.editor.h1", { defaultValue: "Heading 1 (Ctrl+1)" })}>
        <Heading1 size={14} />
      </ToolBtn>
      <ToolBtn onClick={props.onH2} label={t("notes.editor.h2", { defaultValue: "Heading 2 (Ctrl+2)" })}>
        <Heading2 size={14} />
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={props.onBullet} label={t("notes.editor.bullet", { defaultValue: "Bullet list (Ctrl+L)" })}>
        <List size={14} />
      </ToolBtn>
      <ToolBtn onClick={props.onOrdered} label={t("notes.editor.ordered", { defaultValue: "Numbered list" })}>
        <ListOrdered size={14} />
      </ToolBtn>
      <ToolBtn onClick={props.onQuote} label={t("notes.editor.quote", { defaultValue: "Blockquote" })}>
        <Quote size={14} />
      </ToolBtn>
      <Sep />
      <ToolBtn onClick={props.onLink} label={t("notes.editor.link", { defaultValue: "Link (Ctrl+K)" })}>
        <LinkIcon size={14} />
      </ToolBtn>
      {props.onInsertPageLink && (
        <ToolBtn
          onClick={props.onInsertPageLink}
          label={t("notes.editor.pageLink", {
            defaultValue: "Insert link to current PDF page",
          })}
        >
          <BookmarkPlus size={14} />
        </ToolBtn>
      )}
      <ToolBtn
        onClick={props.onSendToAi}
        label={t("notes.editor.sendToAi", {
          defaultValue: "Send selection to AI chat",
        })}
      >
        <Sparkles size={14} />
      </ToolBtn>

      {/* View mode picker — pushed to the right */}
      <div className="ml-auto flex items-center rounded-md border border-glass-border bg-bg-secondary/40 p-0.5">
        <ViewBtn
          active={props.viewMode === "edit"}
          onClick={() => props.onPickView("edit")}
          label={t("notes.editor.editOnly", { defaultValue: "Edit" })}
        >
          <Pencil size={12} />
        </ViewBtn>
        {props.isDesktop && (
          <ViewBtn
            active={props.viewMode === "split"}
            onClick={() => props.onPickView("split")}
            label={t("notes.editor.split", { defaultValue: "Split" })}
          >
            <Columns2 size={12} />
          </ViewBtn>
        )}
        <ViewBtn
          active={props.viewMode === "preview"}
          onClick={() => props.onPickView("preview")}
          label={t("notes.editor.previewOnly", { defaultValue: "Preview" })}
        >
          <Eye size={12} />
        </ViewBtn>
      </div>
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

function ViewBtn({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
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
      aria-pressed={active}
      className={cn(
        "rounded p-1 transition-colors cursor-pointer",
        active
          ? "bg-accent-purple/20 text-accent-purple"
          : "text-text-muted hover:bg-glass-hover hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-glass-border" />;
}
