/**
 * Test setup. Runs once before each test file.
 *
 * happy-dom provides `document`, `window`, and a working
 * `localStorage` polyfill — we just need to clear it between tests so
 * persisted Zustand state doesn't leak across files.
 *
 * happy-dom does NOT implement IndexedDB, so we install
 * `fake-indexeddb` as a globalThis polyfill before any app code runs.
 */
import "fake-indexeddb/auto";
import { afterEach } from "vitest";

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore in environments without storage
  }
});
