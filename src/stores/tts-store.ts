import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Global text-to-speech state. Wraps `window.speechSynthesis` so a
 * single mini-player can drive playback from any selection popover
 * in the app. Long passages are chunked into sentence-sized
 * utterances because some browsers (Safari, iOS) silently cut off
 * utterances past ~200 words or ~32KB.
 *
 * Playback model: a flat queue of strings. The store keeps an
 * `index` pointing at the chunk currently being spoken. Pause/
 * resume map to `speechSynthesis.pause()/resume()`; stop clears
 * the queue. The active `SpeechSynthesisUtterance` is held outside
 * the React state (in `activeUtterance` below) so we can detach
 * `onend`/`onerror` handlers cleanly on cancellation.
 *
 * Voice + rate are *applied at start-time*; changing them mid-
 * passage re-speaks the current chunk so the change is audible
 * immediately rather than waiting for the next sentence boundary.
 *
 * Only voice + rate persist to localStorage — playback state is
 * intentionally session-scoped so a refresh doesn't leave the
 * browser droning over background tabs.
 */

export type TtsPlaybackStatus = "idle" | "playing" | "paused";

interface TtsState {
  status: TtsPlaybackStatus;
  /** Sentence-sized chunks of the current passage. */
  queue: string[];
  /** Index of the currently-speaking chunk in `queue`. */
  index: number;
  /** Selected voice URI (matches `SpeechSynthesisVoice.voiceURI`). */
  voiceUri: string | null;
  /** Speech rate, 0.5 – 2.0. */
  rate: number;
  /** Cached snapshot of `speechSynthesis.getVoices()`. */
  voices: SpeechSynthesisVoice[];

  /** True iff Web Speech API is reachable in this environment. */
  isSupported: () => boolean;

  /** Refresh the voice list. Some browsers populate it
   *  asynchronously via `voiceschanged`; callers should invoke
   *  this on mount + on the event. */
  refreshVoices: () => void;

  /** Start (or restart) speaking the given passage. Cancels any
   *  in-flight utterance first. */
  speak: (text: string) => void;

  pause: () => void;
  resume: () => void;
  stop: () => void;
  skipNext: () => void;
  skipPrev: () => void;

  setVoiceUri: (uri: string | null) => void;
  setRate: (rate: number) => void;
}

let activeUtterance: SpeechSynthesisUtterance | null = null;

function isAvailable(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance !== "undefined"
  );
}

/**
 * Split into sentence-ish chunks. Aim for ~200 characters so
 * mobile browsers don't cut us off. Tries to break on sentence
 * boundaries; falls back to soft-cap on commas / spaces.
 */
function chunkPassage(text: string): string[] {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return [];

  const MAX_CHUNK = 220;
  const chunks: string[] = [];

  // Greedy split on sentence terminators, keeping the terminator.
  const sentenceRe = /([^.!?]+[.!?]+["')\]]*\s+)/g;
  const sentences: string[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = sentenceRe.exec(trimmed)) !== null) {
    sentences.push(match[0].trim());
    lastIndex = sentenceRe.lastIndex;
  }
  if (lastIndex < trimmed.length) {
    sentences.push(trimmed.slice(lastIndex).trim());
  }

  // Further split any sentence longer than MAX_CHUNK on
  // commas/semicolons; final fallback is a hard split at MAX_CHUNK.
  for (const sentence of sentences) {
    if (sentence.length <= MAX_CHUNK) {
      chunks.push(sentence);
      continue;
    }
    let buffer = "";
    const parts = sentence.split(/(,|;)\s+/);
    for (const part of parts) {
      if (!part) continue;
      if ((buffer + part).length > MAX_CHUNK && buffer) {
        chunks.push(buffer.trim());
        buffer = part;
      } else {
        buffer += (buffer && !/^[,;]/.test(part) ? " " : "") + part;
      }
    }
    if (buffer.trim()) chunks.push(buffer.trim());
  }

  // Final pass: any chunk still over the cap gets sliced.
  const final: string[] = [];
  for (const chunk of chunks) {
    if (chunk.length <= MAX_CHUNK) {
      final.push(chunk);
      continue;
    }
    for (let i = 0; i < chunk.length; i += MAX_CHUNK) {
      final.push(chunk.slice(i, i + MAX_CHUNK));
    }
  }
  return final;
}

function detachActiveUtterance() {
  if (activeUtterance) {
    activeUtterance.onend = null;
    activeUtterance.onerror = null;
    activeUtterance = null;
  }
}

export const useTtsStore = create<TtsState>()(
  persist(
    (set, get) => {
      function speakIndex(index: number) {
        if (!isAvailable()) return;
        const { queue, voiceUri, rate, voices } = get();
        if (index < 0 || index >= queue.length) {
          detachActiveUtterance();
          window.speechSynthesis.cancel();
          set({ status: "idle", queue: [], index: 0 });
          return;
        }

        detachActiveUtterance();
        window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(queue[index]);
        utterance.rate = rate;
        if (voiceUri) {
          const voice = voices.find((v) => v.voiceURI === voiceUri);
          if (voice) utterance.voice = voice;
        }
        utterance.onend = () => {
          if (activeUtterance !== utterance) return;
          // Advance to the next chunk. Read the latest index from
          // the store so skipNext/skipPrev racing this callback
          // don't double-advance.
          const current = get().index;
          const next = current + 1;
          if (next >= get().queue.length) {
            detachActiveUtterance();
            set({ status: "idle", queue: [], index: 0 });
            return;
          }
          set({ index: next });
          speakIndex(next);
        };
        utterance.onerror = () => {
          if (activeUtterance !== utterance) return;
          detachActiveUtterance();
          set({ status: "idle", queue: [], index: 0 });
        };

        activeUtterance = utterance;
        set({ status: "playing", index });
        window.speechSynthesis.speak(utterance);
      }

      return {
        status: "idle",
        queue: [],
        index: 0,
        voiceUri: null,
        rate: 1.0,
        voices: [],

        isSupported: () => isAvailable(),

        refreshVoices: () => {
          if (!isAvailable()) return;
          const voices = window.speechSynthesis.getVoices();
          set({ voices });
        },

        speak: (text: string) => {
          if (!isAvailable()) return;
          const queue = chunkPassage(text);
          if (queue.length === 0) return;
          set({ queue, index: 0 });
          speakIndex(0);
        },

        pause: () => {
          if (!isAvailable()) return;
          if (get().status !== "playing") return;
          window.speechSynthesis.pause();
          set({ status: "paused" });
        },

        resume: () => {
          if (!isAvailable()) return;
          if (get().status !== "paused") return;
          window.speechSynthesis.resume();
          set({ status: "playing" });
        },

        stop: () => {
          if (!isAvailable()) return;
          detachActiveUtterance();
          window.speechSynthesis.cancel();
          set({ status: "idle", queue: [], index: 0 });
        },

        skipNext: () => {
          const { queue, index } = get();
          if (queue.length === 0) return;
          const next = Math.min(index + 1, queue.length - 1);
          if (next === index && index === queue.length - 1) {
            // Already on the last chunk — let the natural `onend`
            // finalise rather than re-speaking.
            return;
          }
          speakIndex(next);
        },

        skipPrev: () => {
          const { queue, index } = get();
          if (queue.length === 0) return;
          speakIndex(Math.max(0, index - 1));
        },

        setVoiceUri: (uri: string | null) => {
          set({ voiceUri: uri });
          // Re-speak current chunk so the change takes effect now,
          // not at the next sentence boundary.
          const { status, queue, index } = get();
          if (status !== "idle" && queue.length > 0) {
            speakIndex(index);
          }
        },

        setRate: (rate: number) => {
          const clamped = Math.min(2, Math.max(0.5, rate));
          set({ rate: clamped });
          const { status, queue, index } = get();
          if (status !== "idle" && queue.length > 0) {
            speakIndex(index);
          }
        },
      };
    },
    {
      name: "pnyxy-reader:tts",
      // Persist only the preferences, never playback state or the
      // voice list snapshot (voice objects are non-serialisable).
      partialize: (state) => ({
        voiceUri: state.voiceUri,
        rate: state.rate,
      }),
    },
  ),
);
