import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { useReaderStore, useDocumentState } from "@/stores/reader-store";
import { useSearchStore } from "@/stores/search-store";
import { useSettingsStore } from "@/stores/settings-store";
import { getReaderPalette } from "@/lib/reader-themes";
import { useTextSelection } from "@/hooks/use-text-selection";
import { AnnotationContextMenu } from "../popovers/AnnotationContextMenu";
import { CommentPopover } from "../popovers/CommentPopover";
import { buildSearchRegex } from "@/lib/text-search";
import type { SearchOptions } from "@/types/document";

interface TextViewerProps {
  documentId?: string;
}

/**
 * Renders text/markdown documents. Listens to the adapter's
 * `subscribeContent` so live edits (replace-all) show up without a
 * remount. When a search is active, wraps matches in `<mark>` and
 * scrolls the current one into view.
 */
export function TextViewer({ documentId }: TextViewerProps) {
  const activeDocumentId = useReaderStore((s) => s.activeDocumentId);
  const docId = documentId ?? activeDocumentId;
  const doc = useDocumentState(docId ?? "");
  const [content, setContent] = useState<string>("");
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const allowAnnotations = useSettingsStore(
    (s) => s.experimental_allowAnnotationsForAllFormats,
  );
  const readerTheme = useSettingsStore((s) => s.readerTheme);
  const palette = getReaderPalette(readerTheme);
  // Only wire the selection listener when the dev toggle is enabled; a
  // conditionally-empty ref keeps the hook's argument stable.
  useTextSelection(allowAnnotations ? selectionRootRef : { current: null });

  useEffect(() => {
    let alive = true;
    if (!doc?.adapter.getContent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear content when the active doc can't provide it
      setContent("");
      return;
    }
    doc.adapter.getContent().then((text) => {
      if (alive) setContent(text);
    });
    const unsubscribe = doc.adapter.subscribeContent?.(() => {
      doc.adapter.getContent?.().then((text) => {
        if (alive) setContent(text);
      });
    });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, [doc]);

  const format = doc?.meta.format;

  const html = useMemo(() => {
    if (format === "markdown") {
      const rendered = marked.parse(content, { async: false }) as string;
      return DOMPurify.sanitize(rendered);
    }
    const escaped = content
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    return `<pre class="whitespace-pre-wrap break-words font-mono text-sm leading-relaxed">${escaped}</pre>`;
  }, [content, format]);

  const query = useSearchStore((s) => s.query);
  const caseSensitive = useSearchStore((s) => s.options.caseSensitive);
  const wholeWord = useSearchStore((s) => s.options.wholeWord);
  const regexEnabled = useSearchStore((s) => s.options.regex);
  const currentIdx = useSearchStore((s) => s.currentIdx);
  const matches = useSearchStore((s) => s.matches);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Rebuild from scratch so stale <mark>s never stack up.
    container.innerHTML = html;

    if (!query) return;
    const opts: SearchOptions = {
      caseSensitive,
      wholeWord,
      regex: regexEnabled,
    };
    const regex = buildSearchRegex(query, opts);
    if (!regex) return;

    wrapTextMatches(container, regex);

    const marks = container.querySelectorAll("mark[data-search-match]");
    if (marks.length > 0 && currentIdx >= 0 && currentIdx < marks.length) {
      const el = marks[currentIdx] as HTMLElement;
      el.setAttribute("data-current", "true");
      el.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [html, query, caseSensitive, wholeWord, regexEnabled, currentIdx, matches]);

  if (!doc) return null;

  return (
    <div
      ref={selectionRootRef}
      data-active-viewer
      data-text-viewer
      style={{ backgroundColor: palette.background, color: palette.text }}
      className="h-full w-full overflow-auto px-8 py-6"
    >
      <div
        ref={containerRef}
        // Keep `prose` for the markdown typography reset; override
        // Tailwind Typography's colour variables so the same `prose`
        // class works across all three reader themes. Using the CSS
        // vars (not prose-invert) means sepia doesn't have to fight a
        // hard-wired dark palette.
        style={
          {
            color: palette.text,
            "--tw-prose-body": palette.text,
            "--tw-prose-headings": palette.textStrong,
            "--tw-prose-bold": palette.textStrong,
            "--tw-prose-links": palette.textStrong,
            "--tw-prose-quotes": palette.textMuted,
            "--tw-prose-code": palette.textStrong,
            "--tw-prose-bullets": palette.textMuted,
            "--tw-prose-counters": palette.textMuted,
            "--tw-prose-captions": palette.textMuted,
          } as React.CSSProperties
        }
        className="prose mx-auto max-w-3xl leading-relaxed [&_mark[data-search-match]]:bg-warning/40 [&_mark[data-search-match]]:text-inherit [&_mark[data-search-match][data-current=true]]:bg-orange-400/70"
      />
      {allowAnnotations && (
        <>
          <AnnotationContextMenu />
          <CommentPopover />
        </>
      )}
    </div>
  );
}

/**
 * Walk every text node under `root` and wrap portions that match
 * `regex` with `<mark data-search-match>`.
 */
function wrapTextMatches(root: HTMLElement, regex: RegExp): void {
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || node.nodeValue.length === 0) {
        return NodeFilter.FILTER_REJECT;
      }
      let el = node.parentElement;
      while (el && el !== root) {
        const tag = el.tagName.toLowerCase();
        if (tag === "script" || tag === "style") return NodeFilter.FILTER_REJECT;
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const targets: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    targets.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of targets) {
    const text = textNode.nodeValue ?? "";
    const nodeRegex = new RegExp(regex.source, regex.flags);
    const fragments: (Text | HTMLElement)[] = [];
    let lastIndex = 0;
    let hadMatch = false;
    for (const m of text.matchAll(nodeRegex)) {
      if (m.index === undefined) continue;
      const matchStart = m.index;
      const matchEnd = matchStart + m[0].length;
      if (matchEnd === matchStart) continue;
      hadMatch = true;
      if (matchStart > lastIndex) {
        fragments.push(doc.createTextNode(text.slice(lastIndex, matchStart)));
      }
      const mark = doc.createElement("mark");
      mark.setAttribute("data-search-match", "true");
      mark.textContent = m[0];
      fragments.push(mark);
      lastIndex = matchEnd;
    }
    if (!hadMatch) continue;
    if (lastIndex < text.length) {
      fragments.push(doc.createTextNode(text.slice(lastIndex)));
    }

    const parent = textNode.parentNode;
    if (!parent) continue;
    for (const frag of fragments) parent.insertBefore(frag, textNode);
    parent.removeChild(textNode);
  }
}
