import type { VocabEntry } from "@/types/vocab";

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Export entries as a CSV compatible with Anki's "import file" tool.
 * Columns: word, definition, context, source, page, due, created.
 *
 * Anki accepts CSV directly; users pick which columns map to their
 * note type on import.
 */
export function exportVocabAsCsv(entries: VocabEntry[]): void {
  const header = [
    "word",
    "definition",
    "context",
    "source",
    "page",
    "due",
    "created",
  ];
  const lines = [header.join(",")];
  for (const e of entries) {
    lines.push(
      [
        csvEscape(e.word),
        csvEscape(e.definition),
        csvEscape(e.contextSentence),
        csvEscape(e.sourceTitle),
        csvEscape(e.sourcePage),
        csvEscape(new Date(e.dueAt).toISOString()),
        csvEscape(new Date(e.createdAt).toISOString()),
      ].join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `pnyxy-vocab-${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
