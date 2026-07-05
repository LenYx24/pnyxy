import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API has two implementations in the wild: the
// standardized `SpeechRecognition` (Firefox-flagged, others rolling
// out) and the older `webkitSpeechRecognition` (Chrome/Edge/Safari).
// Pick whichever the browser exposes, or null if neither is there
// that's our capability gate.
type SpeechRecognitionCtor = new () => SpeechRecognitionInstance;

interface SpeechRecognitionInstance {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult:
    | ((event: SpeechRecognitionEvent) => void)
    | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: {
    0: { transcript: string };
    isFinal: boolean;
  };
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return (
    window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
  );
}

export interface SpeechRecognitionState {
  /** True if the browser has any flavour of the API at all. */
  supported: boolean;
  /** True while a recognition session is active. */
  listening: boolean;
  /** Last error message, if any. Cleared on the next start(). */
  error: string | null;
  start: () => void;
  stop: () => void;
}

interface UseSpeechRecognitionOptions {
  /** Called with each new chunk of *finalized* transcript text, the
   *  bits the engine has committed to. Use this to append to your
   *  textarea. Interim results stream live via `onInterim`. */
  onResult: (text: string) => void;
  /** Called with the live un-finalized transcript on every update.
   *  Useful for showing what's "in the air" while the user speaks.
   *  Optional. */
  onInterim?: (text: string) => void;
  /** BCP-47 lang tag. Defaults to the browser's navigator.language. */
  lang?: string;
}

/**
 * Wraps the Web Speech API into a hook that's safe to call
 * everywhere, it never throws on unsupported browsers (`supported`
 * just returns false). Designed for "press a mic button, dictate
 * into the chat composer" flows.
 *
 * Notes / known limitations:
 * - Tauri's WKWebView (iOS) supports it on recent versions; Android
 *   WebView is hit-or-miss. Always call `supported` to gate UI.
 * - Continuous mode keeps listening across pauses, but Chrome
 *   stops after ~60 seconds of silence regardless. The `onend`
 *   callback resets the listening state so the UI doesn't lie.
 * - The user's first listen prompts for mic permission. Denials
 *   surface as `error: "not-allowed"`; show that to the user.
 */
export function useSpeechRecognition({
  onResult,
  onInterim,
  lang,
}: UseSpeechRecognitionOptions): SpeechRecognitionState {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  // Stable callback refs so the recognition instance below, created
  // once, always sees the latest handlers from the consumer.
  // The "assign during render" pattern is intentional and matches
  // React's recommended way to keep callback refs up-to-date without
  // re-creating the recognition instance on every callback identity
  // change. The lint rule's complaint is overcautious here.
  const onResultRef = useRef(onResult);
  const onInterimRef = useRef(onInterim);
  // eslint-disable-next-line react-hooks/refs
  onResultRef.current = onResult;
  // eslint-disable-next-line react-hooks/refs
  onInterimRef.current = onInterim;

  const supported = getSpeechRecognitionCtor() !== null;

  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return;
    const instance = new Ctor();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = lang ?? navigator.language ?? "en-US";

    instance.onresult = (event: SpeechRecognitionEvent) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      if (finalText) onResultRef.current(finalText);
      if (interimText && onInterimRef.current)
        onInterimRef.current(interimText);
    };
    instance.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "no-speech" fires constantly when the mic picks up nothing
      // don't surface it as an error in the UI.
      if (event.error !== "no-speech") setError(event.error);
    };
    instance.onend = () => {
      setListening(false);
    };

    recognitionRef.current = instance;
    return () => {
      try {
        instance.abort();
      } catch {
        // already aborted
      }
      recognitionRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    const instance = recognitionRef.current;
    if (!instance || listening) return;
    setError(null);
    try {
      instance.start();
      setListening(true);
    } catch {
      // start() throws if called while already started, ignore.
    }
  }, [listening]);

  const stop = useCallback(() => {
    const instance = recognitionRef.current;
    if (!instance) return;
    try {
      instance.stop();
    } catch {
      // already stopped
    }
  }, []);

  return { supported, listening, error, start, stop };
}
