import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import {
  FileText,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
  AlertTriangle,
  ScrollText,
  ListChecks,
  GraduationCap,
} from "lucide-react";
import { PracticeMode } from "../PracticeMode";
import { Button } from "@/components/ui";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { useAuthStore } from "@/stores/auth-store";
import { useConfirm } from "@/hooks/use-confirm";
import { useOpenDocument } from "@/hooks/use-open-document";
import { extractExamTopics, extractPdfText } from "@/lib/ai/extract-exam-topics";
import { generateQuizQuestions } from "@/lib/quiz/quiz-ai";
import { useQuizStore } from "@/stores/quiz-store";
import { useBook } from "../BookPageContext";

type AiStatus = "idle" | "analyzing" | "done" | "failed";

interface ExamRow {
  id: string;
  storage_path: string;
  file_name: string;
  size_bytes: number;
  page_count: number | null;
  name: string;
  year: number | null;
  ai_status: AiStatus;
  ai_topics: string[] | null;
  ai_error: string | null;
  created_at: string;
}

const MAX_PDF_BYTES = 25 * 1024 * 1024; // 25 MB — exams are small

export function ExamsTab() {
  const { t } = useTranslation();
  const data = useBook();
  const user = useAuthStore((s) => s.user);
  const { confirm, ConfirmModalElement } = useConfirm();
  const { openFile } = useOpenDocument();
  const createQuiz = useQuizStore((s) => s.createQuiz);
  const navigate = useNavigate();

  const [exams, setExams] = useState<ExamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [practiceExam, setPracticeExam] = useState<ExamRow | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const targetCol =
    data.source === "catalog" ? "catalog_book_id" : "book_id";
  const targetId = data.book.id;

  // Initial fetch.
  useEffect(() => {
    if (!user) {
      setExams([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const { data: rows, error: err } = await supabase
        .from("book_exams")
        .select(
          "id, storage_path, file_name, size_bytes, page_count, name, year, ai_status, ai_topics, ai_error, created_at",
        )
        .eq("user_id", user.id)
        .eq(targetCol, targetId)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (err) {
        logError("ExamsTab:fetch", err);
        setError(err.message);
        setLoading(false);
        return;
      }
      setExams((rows ?? []) as ExamRow[]);
      setError(null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, targetCol, targetId]);

  const handlePickFile = () => fileInputRef.current?.click();

  const handleFileSelected = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow picking the same file again
      if (!file || !user) return;
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        setError(
          t("book.exams.errorPdfOnly", {
            defaultValue: "Only PDF exams are supported for now.",
          }),
        );
        return;
      }
      if (file.size > MAX_PDF_BYTES) {
        setError(
          t("book.exams.errorTooLarge", {
            defaultValue: "Exam PDFs are capped at 25 MB.",
          }),
        );
        return;
      }
      setUploading(true);
      setError(null);

      const examId = crypto.randomUUID();
      const storagePath = `${user.id}/exams/${examId}.pdf`;

      // 1. Upload bytes.
      const { error: uploadError } = await supabase.storage
        .from("book-files")
        .upload(storagePath, file, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (uploadError) {
        logError("ExamsTab:upload", uploadError);
        setError(uploadError.message);
        setUploading(false);
        return;
      }

      // 2. Cheap-ish page count via pdfjs. The full text-extraction
      //    happens later, on demand, when the user runs "Identify
      //    topics" — keeps the upload path snappy.
      let pageCount: number | null = null;
      try {
        const { pdfjs } = await import("react-pdf");
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        pageCount = doc.numPages;
      } catch {
        // page count is informational; continue if it failed
      }

      // 3. Insert metadata row.
      const insertRow: Record<string, unknown> = {
        id: examId,
        user_id: user.id,
        storage_path: storagePath,
        file_name: file.name,
        size_bytes: file.size,
        page_count: pageCount,
        name: deriveExamName(file.name),
        year: deriveYearFromFilename(file.name),
      };
      insertRow[targetCol] = targetId;

      const { data: row, error: insertError } = await supabase
        .from("book_exams")
        .insert(insertRow)
        .select(
          "id, storage_path, file_name, size_bytes, page_count, name, year, ai_status, ai_topics, ai_error, created_at",
        )
        .single();
      if (insertError) {
        // Best-effort cleanup of the orphaned bytes.
        await supabase.storage.from("book-files").remove([storagePath]);
        logError("ExamsTab:insert", insertError);
        setError(insertError.message);
        setUploading(false);
        return;
      }

      setExams((prev) => [row as ExamRow, ...prev]);
      setUploading(false);
    },
    [user, targetCol, targetId, t],
  );

  const handleDelete = useCallback(
    async (exam: ExamRow) => {
      const ok = await confirm({
        title: t("book.exams.deleteTitle", {
          defaultValue: "Delete this exam?",
        }),
        body: t("book.exams.deleteBody", {
          defaultValue:
            "The PDF and any AI-extracted topics will be removed permanently.",
        }),
        confirmLabel: t("common.delete", { defaultValue: "Delete" }),
        danger: true,
      });
      if (!ok) return;

      const previous = exams;
      setExams((prev) => prev.filter((e) => e.id !== exam.id));

      // Storage first, then row — if storage fails we still revert
      // optimistic state and surface the error. If row delete fails
      // after storage succeeded, we leave the orphaned row to retry.
      const storageRes = await supabase.storage
        .from("book-files")
        .remove([exam.storage_path]);
      if (storageRes.error) {
        logError("ExamsTab:deleteStorage", storageRes.error);
        setExams(previous);
        setError(storageRes.error.message);
        return;
      }
      const dbRes = await supabase.from("book_exams").delete().eq("id", exam.id);
      if (dbRes.error) {
        logError("ExamsTab:deleteRow", dbRes.error);
        setError(dbRes.error.message);
      }
    },
    [confirm, exams, t],
  );

  const handleOpen = useCallback(
    async (exam: ExamRow) => {
      try {
        const { data: blob, error: dlError } = await supabase.storage
          .from("book-files")
          .download(exam.storage_path);
        if (dlError || !blob) {
          setError(dlError?.message ?? "Failed to download exam.");
          return;
        }
        const file = new File([blob], exam.file_name, {
          type: "application/pdf",
        });
        await openFile(file);
      } catch (err) {
        logError("ExamsTab:open", err);
        setError(err instanceof Error ? err.message : "Failed to open exam.");
      }
    },
    [openFile],
  );

  const handleGenerateQuiz = useCallback(
    async (exam: ExamRow) => {
      if (!user) return;
      setGeneratingFor(exam.id);
      setError(null);
      try {
        // 1. Get the exam text. Reuses the same extractor the topic-
        //    identification pass uses — capped at 15 pages so the
        //    LLM call stays under provider token limits.
        const { data: blob, error: dlError } = await supabase.storage
          .from("book-files")
          .download(exam.storage_path);
        if (dlError || !blob) {
          throw new Error(dlError?.message ?? "download failed");
        }
        const file = new File([blob], exam.file_name, {
          type: "application/pdf",
        });
        const text = await extractPdfText(file);
        if (text.trim().length < 80) {
          throw new Error("Exam text is too short to generate from.");
        }

        // 2. Generate via the existing quiz-ai pipeline. The framing
        //    is "questions in the same style as this exam, drawn
        //    from its topics" — pedagogically the user practices on
        //    fresh items rather than memorising the original paper.
        const questions = await generateQuizQuestions({
          sourceText: text,
          count: 5,
        });

        // 3. Persist as a private quiz tied to the parent book so
        //    it shows up in the book's existing quiz list.
        const quizId = await createQuiz({
          title: t("book.exams.generatedQuizTitle", {
            defaultValue: "Practice quiz: {{name}}",
            name: exam.name,
          }),
          description: t("book.exams.generatedQuizDescription", {
            defaultValue:
              "Auto-generated from a past exam — practice the same topics with fresh questions.",
          }),
          visibility: "private",
          uploaded_book_id: data.source === "catalog" ? null : data.book.id,
          catalog_book_id: data.source === "catalog" ? data.book.id : null,
          questions,
        });
        if (!quizId) throw new Error("Quiz save failed.");

        navigate(`/quizzes/${quizId}`);
      } catch (err) {
        logError("ExamsTab:generateQuiz", err);
        setError(err instanceof Error ? err.message : "Quiz generation failed.");
      } finally {
        setGeneratingFor(null);
      }
    },
    [user, createQuiz, data, navigate, t],
  );

  const handleAnalyze = useCallback(
    async (exam: ExamRow) => {
      // Mark in-flight on the UI + the DB so a refresh doesn't lose
      // the indicator. If extraction fails we flip back to 'failed'
      // and surface the error in the row.
      setExams((prev) =>
        prev.map((e) =>
          e.id === exam.id ? { ...e, ai_status: "analyzing", ai_error: null } : e,
        ),
      );
      await supabase
        .from("book_exams")
        .update({ ai_status: "analyzing", ai_error: null })
        .eq("id", exam.id);

      try {
        const { data: blob, error: dlError } = await supabase.storage
          .from("book-files")
          .download(exam.storage_path);
        if (dlError || !blob) {
          throw new Error(dlError?.message ?? "download failed");
        }
        const file = new File([blob], exam.file_name, {
          type: "application/pdf",
        });
        const text = await extractPdfText(file);
        const topics = await extractExamTopics(text);

        await supabase
          .from("book_exams")
          .update({
            ai_status: "done",
            ai_topics: topics,
            ai_error: null,
          })
          .eq("id", exam.id);

        setExams((prev) =>
          prev.map((e) =>
            e.id === exam.id
              ? { ...e, ai_status: "done", ai_topics: topics, ai_error: null }
              : e,
          ),
        );
      } catch (err) {
        logError("ExamsTab:analyze", err);
        const msg = err instanceof Error ? err.message : "analyze failed";
        await supabase
          .from("book_exams")
          .update({ ai_status: "failed", ai_error: msg })
          .eq("id", exam.id);
        setExams((prev) =>
          prev.map((e) =>
            e.id === exam.id
              ? { ...e, ai_status: "failed", ai_error: msg }
              : e,
          ),
        );
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      <header className="flex items-baseline justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-text-primary">
            {t("book.exams.heading", {
              defaultValue: "Exams & past papers",
            })}
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.exams.description", {
              defaultValue:
                "Upload past exam PDFs tied to this book. Use AI to extract the topics each exam tests, generate a similar quiz, or practice answering with feedback.",
            })}
          </p>
        </div>
        <Button
          variant="secondary"
          onClick={handlePickFile}
          disabled={uploading}
          className="shrink-0"
        >
          {uploading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <Plus size={14} />
          )}
          {t("book.exams.upload", { defaultValue: "Upload PDF" })}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={handleFileSelected}
        />
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="break-all">{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-muted">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : exams.length === 0 ? (
        <div className="rounded-xl border border-dashed border-glass-border bg-glass-bg/30 p-6 text-center">
          <ScrollText size={24} className="mx-auto mb-2 text-text-muted" />
          <p className="text-sm font-medium text-text-primary">
            {t("book.exams.emptyTitle", {
              defaultValue: "No exams uploaded yet",
            })}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t("book.exams.emptyHint", {
              defaultValue:
                "Past papers tied to this book — practice, see the topics they cover, generate a similar quiz.",
            })}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {exams.map((exam) => (
            <ExamRow
              key={exam.id}
              exam={exam}
              isGeneratingQuiz={generatingFor === exam.id}
              onOpen={() => void handleOpen(exam)}
              onAnalyze={() => void handleAnalyze(exam)}
              onGenerateQuiz={() => void handleGenerateQuiz(exam)}
              onPractice={() => setPracticeExam(exam)}
              onDelete={() => void handleDelete(exam)}
            />
          ))}
        </ul>
      )}

      {ConfirmModalElement}
      {practiceExam && (
        <PracticeMode
          open={practiceExam !== null}
          onClose={() => setPracticeExam(null)}
          exam={{
            id: practiceExam.id,
            name: practiceExam.name,
            file_name: practiceExam.file_name,
            storage_path: practiceExam.storage_path,
          }}
        />
      )}
    </div>
  );
}

function ExamRow({
  exam,
  isGeneratingQuiz,
  onOpen,
  onAnalyze,
  onGenerateQuiz,
  onPractice,
  onDelete,
}: {
  exam: ExamRow;
  isGeneratingQuiz: boolean;
  onOpen: () => void;
  onAnalyze: () => void;
  onGenerateQuiz: () => void;
  onPractice: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const sizeMb = (exam.size_bytes / 1024 / 1024).toFixed(1);
  const meta = [
    exam.year ? exam.year.toString() : null,
    exam.page_count ? `${exam.page_count} pp` : null,
    `${sizeMb} MB`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="rounded-xl border border-glass-border bg-glass-bg/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent">
          <FileText size={18} />
        </div>
        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left cursor-pointer"
        >
          <p className="truncate text-sm font-medium text-text-primary hover:text-accent">
            {exam.name}
          </p>
          <p className="truncate text-xs text-text-muted">{meta}</p>
        </button>
        <Button
          variant="secondary"
          onClick={onAnalyze}
          disabled={exam.ai_status === "analyzing"}
          className="shrink-0"
          title={t("book.exams.analyze", {
            defaultValue: "Identify topics with AI",
          })}
        >
          {exam.ai_status === "analyzing" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Sparkles size={12} />
          )}
          <span className="hidden sm:inline">
            {exam.ai_status === "done"
              ? t("book.exams.reanalyze", { defaultValue: "Re-analyse" })
              : t("book.exams.analyzeShort", { defaultValue: "Identify" })}
          </span>
        </Button>
        <Button
          variant="secondary"
          onClick={onGenerateQuiz}
          disabled={isGeneratingQuiz}
          className="shrink-0"
          title={t("book.exams.generateQuiz", {
            defaultValue:
              "Generate a practice quiz with similar questions on the same topics",
          })}
        >
          {isGeneratingQuiz ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <ListChecks size={12} />
          )}
          <span className="hidden sm:inline">
            {t("book.exams.generateQuizShort", { defaultValue: "Quiz" })}
          </span>
        </Button>
        <Button
          variant="secondary"
          onClick={onPractice}
          className="shrink-0"
          title={t("book.exams.practice", {
            defaultValue:
              "Practice each question with Socratic tutor feedback",
          })}
        >
          <GraduationCap size={12} />
          <span className="hidden sm:inline">
            {t("book.exams.practiceShort", { defaultValue: "Practice" })}
          </span>
        </Button>
        <button
          type="button"
          onClick={onDelete}
          className="shrink-0 rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-danger cursor-pointer"
          title={t("common.delete", { defaultValue: "Delete" })}
          aria-label={t("common.delete", { defaultValue: "Delete" })}
        >
          <Trash2 size={14} />
        </button>
      </div>

      {exam.ai_status === "done" && exam.ai_topics && exam.ai_topics.length > 0 && (
        <div className="mt-3 border-t border-glass-border pt-3">
          <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-text-muted">
            {t("book.exams.topics", { defaultValue: "Topics covered" })}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {exam.ai_topics.map((topic, i) => (
              <span
                key={i}
                className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-2xs text-text-primary"
              >
                {topic}
              </span>
            ))}
          </div>
        </div>
      )}
      {exam.ai_status === "done" &&
        (!exam.ai_topics || exam.ai_topics.length === 0) && (
          <p className="mt-2 text-2xs text-text-muted">
            {t("book.exams.topicsEmpty", {
              defaultValue:
                "AI couldn't identify clear topics — the PDF may be too short or not a typical exam.",
            })}
          </p>
        )}
      {exam.ai_status === "failed" && (
        <p className="mt-2 text-2xs text-danger">
          {t("book.exams.aiFailed", {
            defaultValue: "Analyse failed:",
          })}{" "}
          {exam.ai_error}
        </p>
      )}
    </li>
  );
}

/** Cheap heuristic — strip the extension and hyphenate / underscore /
 *  dot-separated tokens so an ugly filename comes in as a sane name.
 */
function deriveExamName(filename: string): string {
  return filename
    .replace(/\.[^./]+$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim() || filename;
}

/** Look for a 4-digit year in the filename. Many users name files
 *  "Algebra_2023_midterm.pdf" or similar. Years before 2000 / past
 *  the next year are filtered out as not-a-year noise.
 */
function deriveYearFromFilename(filename: string): number | null {
  const matches = filename.match(/(?:^|[^\d])(\d{4})(?:[^\d]|$)/);
  if (!matches) return null;
  const y = Number(matches[1]);
  if (y < 2000 || y > new Date().getFullYear() + 1) return null;
  return y;
}
