/**
 * Test setup. Runs once before each test file.
 *
 * happy-dom does NOT implement IndexedDB, so we install
 * `fake-indexeddb` as a globalThis polyfill before any app code runs.
 *
 * Node 25+ ships its own stub `localStorage` / `sessionStorage` on the
 * global object. Without a `--localstorage-file=<path>` flag that stub
 * has no methods and only warns — it shadows happy-dom's real Storage
 * inside Vitest workers. We replace both with an in-memory polyfill
 * that behaves like the real thing and is cleared between tests.
 */
import "fake-indexeddb/auto";
import { afterEach } from "vitest";

class InMemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.data.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  key(index: number): string | null {
    const keys = Array.from(this.data.keys());
    return index >= 0 && index < keys.length ? keys[index] : null;
  }

  [name: string]: unknown;
}

Object.defineProperty(globalThis, "localStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});

Object.defineProperty(globalThis, "sessionStorage", {
  value: new InMemoryStorage(),
  writable: true,
  configurable: true,
});

afterEach(() => {
  try {
    localStorage.clear();
  } catch {
    // ignore in environments without storage
  }
  try {
    sessionStorage.clear();
  } catch {
    // ignore
  }
});
