import { pdfjs } from "react-pdf";
import { aiJsonExtract } from "@/lib/ai-json-extract";

/**
 * Pull text from a PDF File for AI processing. Caps at MAX_PAGES so a
 * pathologically long upload (e.g. a multi-year exam pack the user
 * accidentally combined) doesn't blow our LLM token budget.
 *
 * Concatenates pages with a `\n\n` separator so the model sees a
 * page-aware structure without needing actual page numbers.
 */
const MAX_PAGES = 15;
const MAX_TOPICS = 12;

interface PdfTextItem {
  str?: string;
}

export async function extractPdfText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const total = Math.min(doc.numPages, MAX_PAGES);
  const parts: string[] = [];
  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((it) => ("str" in it ? (it as PdfTextItem).str ?? "" : ""))
      .join(" ");
    parts.push(pageText);
  }
  return parts.join("\n\n").trim();
}

const SYSTEM_PROMPT = `You analyse the text of a school / university exam paper and identify which TOPICS or CONCEPTS the exam tests.

Output ONLY valid JSON in this exact shape, no preamble, no markdown fence, no commentary:

{ "topics": [ "topic 1", "topic 2", … ] }

Rules:
- 3 to 10 distinct topics.
- Each topic is a short noun phrase (2–6 words). No full sentences.
- Use the SAME language as the exam itself (Hungarian exam → Hungarian topics).
- Be specific. "Mathematics" is too broad; "Eigenvalues of 2×2 matrices" is good.
- If the document is too short, garbled, or not actually an exam, return { "topics": [] }.
- Do NOT solve the exam. Do NOT list questions verbatim. List only the underlying concepts.`;

/**
 * Run the extracted PDF text through an extractor LLM call and
 * return a structured list of topics. Same streaming-buffer-parse-
 * validate shape as `extract-flashcards.ts` and `quiz-ai.ts` so the
 * three readers stay symmetric.
 */
export async function extractExamTopics(text: string): Promise<string[]> {
  return aiJsonExtract<string>({
    passage: text,
    systemPrompt: SYSTEM_PROMPT,
    minPassageLength: 80,
    maxOutputTokens: 600,
    maxItems: MAX_TOPICS,
    errorLabel: "exam-topics",
    pickArray: (parsed) => {
      if (!parsed || typeof parsed !== "object") throw new Error();
      return (parsed as { topics?: unknown }).topics;
    },
    coerce: (raw) => {
      if (typeof raw !== "string") return null;
      const text = raw.trim();
      return text.length > 0 ? text : null;
    },
  });
}
