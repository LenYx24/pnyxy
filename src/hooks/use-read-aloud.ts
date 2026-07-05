import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Wraps the Web Speech API's `speechSynthesis` so a message bubble
 * can offer a one-click "Read aloud" toggle without each instance
 * re-implementing the lifecycle. Single-utterance: starting a new
 * read on a different message cancels whatever was already speaking.
 *
 * Components consume `speakingId` to render a Stop icon on the
 * currently-speaking message and Play on every other one.
 */
export function useReadAloud() {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const stop = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    utteranceRef.current = null;
    setSpeakingId(null);
  }, []);

  const read = useCallback(
    (id: string, text: string) => {
      if (
        typeof window === "undefined" ||
        !window.speechSynthesis ||
        typeof window.SpeechSynthesisUtterance === "undefined"
      ) {
        return;
      }
      const trimmed = text.trim();
      if (!trimmed) return;
      // Cancel any in-flight utterance before starting a new one.
      // Some browsers (Safari) glitch on overlapping speak() calls.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.onend = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
          setSpeakingId(null);
        }
      };
      utterance.onerror = () => {
        if (utteranceRef.current === utterance) {
          utteranceRef.current = null;
          setSpeakingId(null);
        }
      };
      utteranceRef.current = utterance;
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [],
  );

  // Cancel on unmount so a navigation away from /chat doesn't leave
  // the browser droning over background tabs.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const supported =
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined";

  return { read, stop, speakingId, supported };
}

/**
 * Strip markdown syntax to plain text suitable for TTS. Best-effort
 * regex pass, keeps it cheap (called per click, not per render) and
 * doesn't try to be a full parser. Code blocks get dropped because
 * "tilde tilde tilde python def main" reads worse than skipping them
 * outright; inline math survives without the dollar delimiters.
 */
export function markdownToSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]+\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/^\s*#{1,6}\s+/gm, "") // headers
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // unordered list markers
    .replace(/^\s*\d+\.\s+/gm, "") // ordered list markers
    .replace(/(\*\*|__)(.+?)\1/g, "$2") // bold
    .replace(/(\*|_)(.+?)\1/g, "$2") // italic
    .replace(/~~(.+?)~~/g, "$1") // strikethrough
    .replace(/\$\$[\s\S]*?\$\$/g, "") // display math, read-aloud rendering would be incoherent
    .replace(/\$([^$]+)\$/g, "$1") // inline math, fall through as-is
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
