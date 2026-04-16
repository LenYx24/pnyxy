# Text-to-Speech (TTS) — Design Doc

*Status:* Plan-only. No implementation yet.

*Audience:* Whoever picks up the TTS task after the VSCode-style
search + multi-format work landed. Assumes familiarity with the
`DocumentAdapter`, `useReaderStore`, and `useSettingsStore` layers
described in `src/types/document.ts`, `src/stores/reader-store.ts`,
and `src/stores/settings-store.ts`.

---

## 1. Goals and non-goals

### Goals (v1)

1. Read the active document aloud from a chosen starting point, using
   a voice and rate the user controls.
2. Work for **all four supported formats** (PDF, EPUB, TXT, MD)
   without per-format special cases in the UI.
3. Offer a persistent mini-player in the reader (play / pause / stop /
   next paragraph / prev paragraph / speed), accessible from the
   keyboard.
4. Highlight the sentence currently being spoken so the reader can
   follow along.
5. Remember the last-spoken position per document so "continue reading"
   resumes where TTS left off (separate from the scroll position).

### Non-goals (v1)

- Offline / on-device neural voices. Ship with the browser's built-in
  voices first (`speechSynthesis.getVoices()`). Local Piper-style
  WASM voices are a follow-up.
- Karaoke-style word-level highlighting. Sentence-level is enough.
- Cross-device resume of TTS position (would need server-side state).
- Auto-language switching mid-document. v1 uses a single voice for the
  whole document; user can override per document in settings.
- Podcast export (MP3 of a book) — explicitly out of scope.

---

## 2. Engine choice: Web Speech API

**Decision:** Use the Web Speech API (`window.speechSynthesis` +
`SpeechSynthesisUtterance`) for v1.

### Why

- Zero dependency, zero bundle cost.
- Works in all target browsers (Chrome, Edge, Safari, Firefox) and
  inside the Tauri webview on Windows (Edge WebView2 provides
  Microsoft voices) and macOS (WebKit provides the OS voices).
- Pausable and rate-adjustable mid-utterance on most engines.
- `onboundary` events fire on sentence/word boundaries — enough for our
  sentence-highlight requirement.

### Known caveats (document explicitly in code comments)

- **Chrome silently stops after ~15 s of continuous audio.** Mitigate
  by chunking text into sentence-length utterances and chaining them.
- **`voiceschanged` fires asynchronously** on some browsers; voice
  list must be refreshed on that event.
- **Safari / WebKit** emits `onboundary` only for words (not
  sentences) — we'll compute sentence boundaries ourselves and use the
  word boundary events to advance a cursor inside the current
  sentence.
- **Linux / Firefox** may have *no* installed voices. The player must
  degrade gracefully with a "No TTS voices available — install a
  system voice" notice.

### Future engine options (v2+)

| Engine | Pros | Cons |
|---|---|---|
| Piper (WASM) | High-quality neural voices, offline | ~20 MB model per voice; needs Web Worker + streaming |
| ElevenLabs / OpenAI TTS / Cartesia | Best quality, cloud | Latency + per-char pricing; needs API-key plumbing in `settings-store` |
| Tauri native bridge | Full OS voice control on desktop | Ties desktop + web to different code paths |

Defer all of these until the Web Speech integration is solid.

---

## 3. Architecture

### 3.1 Content extraction: extend `DocumentAdapter`

The search store already taught adapters how to hand raw text to the
host. TTS reuses the same abstraction but returns *ordered
speakable segments* (paragraphs/sentences) with enough metadata for
highlight-on-read. Add to `src/types/document.ts`:

```ts
export interface SpeakableSegment {
  id: string;             // stable within the document
  text: string;           // ready to feed SpeechSynthesisUtterance

  // Anchor to the rendered document:
  pageNum?: number;       // PDF
  spineHref?: string;     // EPUB
  sourceOffset?: number;  // TXT / MD — char offset into getContent()

  /** Optional DOM selector/rect so the UI can highlight the segment. */
  rects?: PageRect[];     // PDF only (same coord system as search)
  domAnchorId?: string;   // TXT/MD/EPUB — an id we can querySelector
}

export interface DocumentAdapter {
  // ...existing members
  /** Ordered list of paragraphs (or spine-document chunks). */
  getSpeakableSegments?(): Promise<SpeakableSegment[]>;
}
```

Per-adapter plan:

| Format | Implementation sketch |
|---|---|
| **PDF** | For each page, walk `getTextContent()`, group items by vertical line then merge consecutive lines into paragraphs (heuristic: empty-line gap or large `y` jump). Reuse the coordinate-flip logic from `search()` to emit `rects` per segment. |
| **EPUB** | `book.spine.each(section => section.load())` → parse HTML → extract `<p>`, `<li>`, headings. Each becomes one segment; `domAnchorId` is the element's existing `id` or we inject one via `rendition.hooks.content`. |
| **Markdown** | `marked.lexer(content)` gives tokens; flatten paragraphs/list items/headings in order. `sourceOffset` is the token's `position.start.offset`. |
| **Text** | Split on blank lines (`/\n{2,}/`), fall back to sentence split for very long paragraphs. |

A shared helper `src/lib/speech/segment-text.ts` handles the paragraph-
and sentence-level splitters so each adapter stays thin.

### 3.2 Sentence tokenizer

Sentence boundaries matter both for chunking (Chrome 15 s bug) and
for highlighting. Implementation:

```ts
// src/lib/speech/sentences.ts
export function splitSentences(text: string): { text: string; start: number }[]
```

Rules:
- `Intl.Segmenter(locale, { granularity: "sentence" })` where
  available; fall back to a regex (`/[.?!…]+(?:\s+|$)/g`) otherwise.
- Merge adjacent segments shorter than 6 chars (handles "Mr.",
  "e.g.", etc.).
- Preserve leading whitespace of every sentence so the concatenation
  of sentence texts equals the source (needed for offset math).

Unit tests live next to it — regex fallback is the tricky one.

### 3.3 `useTtsStore` (new)

Adapter-agnostic playback state; single store for all three viewers.

```ts
// src/stores/tts-store.ts
type TtsStatus = "idle" | "loading" | "playing" | "paused" | "error";

interface TtsState {
  status: TtsStatus;
  documentId: string | null;
  segments: SpeakableSegment[];      // cached result of getSpeakableSegments
  sentences: Array<{                 // flattened for playback
    segmentId: string;
    segmentIdx: number;
    sentenceIdx: number;
    text: string;
    start: number;                   // offset into segment.text
  }>;
  currentSentenceIdx: number;

  // User knobs (mirrored from settings-store):
  voiceURI: string | null;
  rate: number;                      // 0.5–3.0
  pitch: number;                     // 0–2
  volume: number;                    // 0–1

  error: string | null;

  load(doc: ActiveDocument): Promise<void>;
  play(fromSentenceIdx?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
  next(): void;                      // skip to next sentence
  prev(): void;                      // go back one sentence
  seekToSegment(segmentId: string, offset?: number): void;
  setRate(v: number): void;
  setPitch(v: number): void;
  setVolume(v: number): void;
  setVoice(voiceURI: string): void;
}
```

Internals:
- Maintain a private `currentUtterance: SpeechSynthesisUtterance | null`.
- On `play()`: cancel any running utterance, build the next one from
  `sentences[currentSentenceIdx]`, wire `onend` → advance and recurse,
  `onerror` → set status "error".
- `onboundary(event)` with `charIndex` → compute word-within-sentence
  progress if we want word highlight later; for now, just drive the
  sentence highlight.
- Guard against the Chrome 15 s bug by splitting sentences longer than
  ~180 characters into half-sentences at the nearest clause boundary
  (`,` or `;`).
- `pause()` calls `speechSynthesis.pause()`. Do NOT try to resume with
  `speechSynthesis.resume()` — known to hang on Chromium. Instead,
  remember which sentence was in progress, cancel, and on `resume()`
  replay from that sentence (acceptable jitter < 1 s).
- `stop()` calls `speechSynthesis.cancel()` and resets state.
- Debounce voice/rate/pitch changes: cancel the running utterance and
  re-queue from the current sentence so the new settings apply
  immediately.

### 3.4 `useReaderStore` integration

- Add `lastTtsSentenceIdxByDocument: Record<string, number>` (persisted
  to IDB via the existing reader-store migration path). Updated
  on every `onend`.
- On document open, if TTS was last playing in this session on this
  doc, the player is preloaded but not auto-started.

### 3.5 Highlight layer

PDF: new `TtsHighlightLayer` mirrors `SearchHighlightLayer`. Reads
`segments[currentSentenceIdx].rects` and paints a soft
`rgba(124, 58, 237, 0.2)` box + border. Scrolling to the current
sentence: reuse `readerStore.requestScrollToPage(pageNum)` then
`scrollIntoView({ behavior: "smooth", block: "center" })` on the
first rect's DOM element (the layer needs a ref per sentence).

EPUB / TXT / MD: use `domAnchorId` → `document.querySelector("#" +
id)` → toggle a `.tts-active` class with `mix-blend-mode: multiply`
and the same soft purple background.

### 3.6 Player UI

Floating dock at the bottom-right of the viewer (same layer as the
`SearchOverlay` but opposite corner). Mount once in
`ReaderPage.tsx`'s viewer area.

```
┌─────────────────────────────────────────┐
│ ▶  ⏸  ⏹   ⟸  ⟹   1.25×   "Chapter 3 · p12" │
└─────────────────────────────────────────┘
```

Collapses to a single icon when not playing to avoid visual noise.
Click the icon → expands. Focus-trap identical to the existing
`SearchOverlay`.

### 3.7 Keyboard shortcuts

Register through `useKeyboardShortcut` (same registry that the
Shortcuts settings tab displays). Default bindings:

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+P` | Play / pause |
| `Ctrl+Shift+.` | Next sentence |
| `Ctrl+Shift+,` | Previous sentence |
| `Ctrl+Shift+S` | Stop |
| `Ctrl+Shift+=` | Rate + 0.1 |
| `Ctrl+Shift+-` | Rate − 0.1 |

All are overridable in the Shortcuts tab via the existing customization
path.

### 3.8 Settings surface

Add a new "Reading → Text-to-Speech" section to
`src/features/settings/SettingsPage.tsx`:

- Voice picker (populated from `speechSynthesis.getVoices()`, grouped
  by language). Shows a "Test voice" button that utters a sample line.
- Rate slider (0.5×–3×, default 1×).
- Pitch slider (0–2, default 1).
- Volume slider (0–1, default 1).
- Toggle: "Highlight sentence while reading" (default on).
- Toggle: "Auto-scroll to follow TTS" (default on).
- Toggle: "Start TTS when opening a document" (default off).

Persisted fields on `SettingsState`:

```ts
ttsVoiceURI: string | null;
ttsRate: number;
ttsPitch: number;
ttsVolume: number;
ttsHighlightSentence: boolean;
ttsAutoScroll: boolean;
ttsAutoStartOnOpen: boolean;
```

Bump the persist `version` and add a migration branch that seeds the
defaults above when missing.

---

## 4. Format-specific notes

### PDF

- `getTextContent()` returns text ordered by visual position, not
  reading order. Two-column layouts will occasionally read across
  columns. **Accept this for v1** and add a follow-up to integrate a
  reading-order detector (`pdfjs` `textContentStream` + column
  clustering).
- Long TOC/index pages produce hundreds of tiny segments. Cap segment
  count at ~2000; merge or skip trailing decorative pages.

### EPUB

- epubjs iframes: post-process with `rendition.hooks.content` to add
  `id` attributes to `<p>` and headings if missing. Run once per
  spine item on `rendered` event.
- `rendition.display(spineHref)` will trigger a short layout animation;
  debounce sentence changes that cross spine boundaries to avoid
  strobing.

### Markdown

- `marked.lexer` is synchronous — we can precompute segments in
  `getSpeakableSegments` without extra overhead.
- Skip code blocks and inline code (they speak poorly). Render them
  as "code block" or omit — make this a setting
  (`ttsSkipCodeBlocks`, default true).
- Headings get a short pause before them: implement by emitting
  `SpeakableSegment` with a trailing ` …` for headings (one-char pause
  hack) rather than building a real pause mechanism.

### Plain text

- Honor `.txt` files with Windows line endings (`\r\n`) — normalize
  before splitting.

---

## 5. Accessibility

- The player is announced to screen readers via an `aria-live="polite"`
  status region that says "Playing · sentence 12 of 180" on each
  sentence change (throttled to once a second to avoid spam).
- All controls are real `<button>`s with visible text + `aria-label`s.
- Focus never jumps into the highlighted sentence itself — keep focus
  on the player so keyboard users can control playback.
- When `prefers-reduced-motion` is set, disable the auto-scroll smooth
  behavior (use `block: "center"` with `behavior: "auto"`).

---

## 6. Testing plan

Unit (vitest, happy-dom):

- `splitSentences` — abbreviations, ellipses, CJK punctuation,
  quotes, mixed case.
- `tts-store` — play/pause/stop transitions with a fake
  `speechSynthesis`; next/prev bounds; rate change mid-play.
- Per-adapter `getSpeakableSegments` — ordering, offset math,
  empty doc.

Integration (vitest + RTL):

- Open a canned MD doc → click play → `speechSynthesis.speak` invoked
  with the first sentence; highlight class on first segment.
- Stop → `cancel` invoked, current sentence reset to 0.

Manual QA matrix (record in follow-up PR):

- Chrome on Windows (Edge WebView2 inside Tauri)
- Safari on macOS
- Firefox on Linux (no voices → degraded state)
- Long session (> 30 min) on Chrome (watch for 15-s stall bug)

---

## 7. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Chrome 15 s stall | Sentence-chunked utterances; watchdog that restarts playback if `onend` hasn't fired 20 s into a single utterance. |
| Voices unavailable on Linux | UI shows a banner linking to system setup docs; keep the player controls disabled with a "No voices installed" tooltip. |
| PDF reading order is wrong | Document as known limitation; follow-up to plug in a proper reading-order algorithm. |
| EPUB iframe same-origin weirdness | Already handled for search; reuse the same content hook registration. |
| Persisted `lastTtsSentenceIdx` becomes stale after re-OCR | Resume falls back to sentence 0 when the stored idx is out of range. |

---

## 8. Phased rollout

| Phase | Ships | Gate |
|---|---|---|
| 1 | Segment extraction helpers, tokenizer, unit tests | Tests green |
| 2 | `useTtsStore`, player UI, Web Speech integration for TXT+MD | Manual smoke in happy path |
| 3 | PDF adapter segment extraction + highlight layer | 2-column PDF regression check |
| 4 | EPUB segment extraction + highlight layer | Alice-in-Wonderland smoke |
| 5 | Settings tab, persist migration, keyboard shortcuts | Persist-migration unit test |
| 6 | Accessibility polish + follow-up cleanup | Axe + manual screen-reader pass |

Each phase is independently shippable — land them separately.

---

## 9. Open questions

1. Should TTS progress count toward the reading streak /
   reading-stats plugin? Probably yes, but it should emit different
   events (`tts:sentence` rather than `page:scroll`) so analytics can
   distinguish. Resolve in Phase 2.
2. Do we want a podcast-style "continue playing in background while
   you switch tabs" mode? Browsers will throttle the audio, so this
   needs testing; punt to v2.
3. Cloud voices — are we OK with per-user BYO-key as a setting, or
   does the project want a pooled backend key? Matches the pattern set
   by `anthropicApiKey` / `openaiApiKey`; recommend BYO-key.
4. How should TTS interact with the annotation overlay? v1: pause
   TTS while the context menu is open.

---

## 10. Critical files (if / when this is implemented)

- `src/types/document.ts` — add `SpeakableSegment`, extend
  `DocumentAdapter`.
- `src/stores/tts-store.ts` — new; central playback state.
- `src/stores/settings-store.ts` — new TTS fields + persist migration.
- `src/features/reader/TtsPlayer.tsx` — new; player UI.
- `src/features/reader/TtsHighlightLayer.tsx` — new; PDF overlay.
- `src/features/reader/adapters/*-adapter.ts` — each gets
  `getSpeakableSegments`.
- `src/features/reader/ReaderPage.tsx` — mount `<TtsPlayer />`,
  register keyboard shortcuts.
- `src/features/settings/SettingsPage.tsx` — "Text-to-Speech"
  section.
- `src/lib/speech/segment-text.ts` and `src/lib/speech/sentences.ts` —
  shared helpers.
