import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import type { Range } from "@codemirror/state";

/**
 * Obsidian-style "Live Preview" for markdown in CodeMirror 6.
 *
 * The document IS the markdown (no serialisation), this plugin only
 * decorates it: formatted text is styled inline, and the raw syntax
 * markers (`**`, `#`, `` ` ``, `[..](..)`) are HIDDEN on every line
 * except the one(s) the cursor/selection touches. Move onto a line and
 * its raw markdown reappears so you can edit it, exactly like Obsidian.
 */

// Lines touched by any selection range, markers stay visible on these.
function activeLines(view: EditorView): Set<number> {
  const set = new Set<number>();
  const { doc } = view.state;
  for (const r of view.state.selection.ranges) {
    const from = doc.lineAt(r.from).number;
    const to = doc.lineAt(r.to).number;
    for (let l = from; l <= to; l++) set.add(l);
  }
  return set;
}

// Syntax-marker nodes we hide on inactive lines.
const HIDDEN_MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "QuoteMark",
]);

// Inline nodes that always get a styling class (so text stays formatted
// even while you're editing that line).
const INLINE_CLASS: Record<string, string> = {
  StrongEmphasis: "cm-md-strong",
  Emphasis: "cm-md-em",
  InlineCode: "cm-md-code",
  Strikethrough: "cm-md-strike",
};

const HIDDEN = Decoration.replace({});

function buildDecorations(view: EditorView): DecorationSet {
  const decos: Range<Decoration>[] = [];
  const active = activeLines(view);
  const { doc } = view.state;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;
        const isActive = active.has(doc.lineAt(node.from).number);

        // Heading: size the whole line; the "# " gets hidden via its
        // HeaderMark child below (we descend into it).
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          const line = doc.lineAt(node.from);
          decos.push(
            Decoration.line({ class: `cm-md-h${heading[1]}` }).range(line.from),
          );
          return;
        }
        if (name === "Blockquote") {
          const line = doc.lineAt(node.from);
          decos.push(
            Decoration.line({ class: "cm-md-quote" }).range(line.from),
          );
          return;
        }

        const cls = INLINE_CLASS[name];
        if (cls) {
          decos.push(Decoration.mark({ class: cls }).range(node.from, node.to));
          return;
        }

        // Link: [label](url): style the label; hide the brackets + url
        // when inactive so only the clickable-looking label remains.
        if (name === "Link") {
          const text = doc.sliceString(node.from, node.to);
          const close = text.indexOf("](");
          if (close > 0) {
            const labelStart = node.from + 1;
            const labelEnd = node.from + close;
            decos.push(
              Decoration.mark({ class: "cm-md-link" }).range(labelStart, labelEnd),
            );
            if (!isActive) {
              decos.push(HIDDEN.range(node.from, labelStart));
              decos.push(HIDDEN.range(labelEnd, node.to));
            }
          }
          return false; // don't descend, we handled the whole link
        }

        // Hide the raw markers on inactive lines.
        if (HIDDEN_MARKS.has(name) && !isActive) {
          let end = node.to;
          // eat the single space after a heading '#'
          if (name === "HeaderMark" && doc.sliceString(end, end + 1) === " ") {
            end += 1;
          }
          if (end > node.from) decos.push(HIDDEN.range(node.from, end));
        }
      },
    });
  }

  // sort=true: RangeSet needs ordered ranges, and we push in tree order.
  return Decoration.set(decos, true);
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
