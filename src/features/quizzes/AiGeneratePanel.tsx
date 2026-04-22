import { useState } from "react";
import { Link } from "react-router";
import { Loader2, Minus, Plus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui";
import { hasAnyConfiguredProvider } from "@/lib/ai-client";
import {
  generateQuizQuestions,
  MAX_QUIZ_QUESTIONS,
  MIN_QUIZ_QUESTIONS,
  MAX_SOURCE_CHARS,
  QuizGenerationError,
} from "@/lib/quiz-ai";
import type { QuizQuestionDraft } from "@/types/quiz";

interface AiGeneratePanelProps {
  onAppend: (drafts: QuizQuestionDraft[]) => void;
}

const DEFAULT_COUNT = 5;

export function AiGeneratePanel({ onAppend }: AiGeneratePanelProps) {
  const [open, setOpen] = useState(false);
  const [sourceText, setSourceText] = useState("");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const providerConfigured = hasAnyConfiguredProvider();

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      const drafts = await generateQuizQuestions({
        sourceText,
        count,
      });
      onAppend(drafts);
      setSourceText("");
      setOpen(false);
    } catch (err) {
      if (err instanceof QuizGenerationError) {
        setError(err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("Generation failed.");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent-purple/30 bg-accent-purple/5 px-4 py-3 text-sm font-medium text-accent-purple transition-colors hover:bg-accent-purple/10 cursor-pointer"
      >
        <Sparkles size={16} />
        Generate questions with AI
      </button>
    );
  }

  return (
    <section className="space-y-4 rounded-xl border border-accent-purple/30 bg-accent-purple/5 p-4">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-accent-purple">
          <Sparkles size={16} />
          Generate with AI
        </div>
        <button
          onClick={() => setOpen(false)}
          disabled={loading}
          className="rounded-md p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
          aria-label="Close AI panel"
        >
          <X size={14} />
        </button>
      </header>

      {!providerConfigured && (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
          No AI provider is enabled.{" "}
          <Link
            to="/settings"
            className="font-semibold underline underline-offset-2"
          >
            Configure one in Settings
          </Link>{" "}
          to use generation.
        </p>
      )}

      <div>
        <label
          htmlFor="ai-source-text"
          className="mb-1 block text-xs font-medium text-text-muted"
        >
          Source text
        </label>
        <textarea
          id="ai-source-text"
          rows={6}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          maxLength={MAX_SOURCE_CHARS}
          placeholder="Paste a chapter, notes, a Wikipedia section — anything the quiz should be about."
          disabled={loading}
          className="w-full resize-y rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary outline-none focus:border-accent-purple/50 disabled:opacity-60"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          {sourceText.length.toLocaleString()} / {MAX_SOURCE_CHARS.toLocaleString()} chars
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-text-muted">Questions</span>
          <CountStepper
            value={count}
            onChange={setCount}
            min={MIN_QUIZ_QUESTIONS}
            max={MAX_QUIZ_QUESTIONS}
            disabled={loading}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="secondary"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={loading}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleGenerate}
          disabled={
            loading || !providerConfigured || sourceText.trim().length === 0
          }
          className="w-full sm:w-auto"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles size={16} />
              Generate {count}
            </>
          )}
        </Button>
      </div>
    </section>
  );
}

function CountStepper({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.max(min, Math.min(max, n));
  return (
    <div className="inline-flex items-center overflow-hidden rounded-lg border border-glass-border bg-bg-primary/50">
      <button
        onClick={() => onChange(clamp(value - 1))}
        disabled={disabled || value <= min}
        className="px-3 py-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Decrease question count"
      >
        <Minus size={14} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(clamp(Math.round(n)));
        }}
        disabled={disabled}
        className="w-10 border-x border-glass-border bg-transparent py-1 text-center text-sm tabular-nums text-text-primary outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        onClick={() => onChange(clamp(value + 1))}
        disabled={disabled || value >= max}
        className="px-3 py-1.5 text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Increase question count"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
