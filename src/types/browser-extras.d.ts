/**
 * Ambient declarations for non-standard / vendor-prefixed browser
 * APIs we touch from app code. Centralised here so callers can use
 * `window.requestIdleCallback?.()` directly without `as unknown as`
 * casts at every site.
 */

export {};

declare global {
  interface Window {
    /** iOS Safari < 14.5 / older WebKit shipped Audio under the
     *  webkit prefix. Used by the focus-session tone generator. */
    webkitAudioContext?: typeof AudioContext;
    /** Chromium / Firefox feature; absent on Safari pre-17. We use
     *  it as a low-priority scheduler for non-urgent work
     *  (PDF prefetch warmups), falling back to setTimeout when
     *  unavailable. */
    requestIdleCallback?: (
      callback: () => void,
      opts?: { timeout: number },
    ) => number;
    cancelIdleCallback?: (id: number) => void;
  }
}
