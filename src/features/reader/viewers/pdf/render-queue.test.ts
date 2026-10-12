import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderQueue } from "./render-queue";

describe("createRenderQueue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("never admits a page released before the admit delay", () => {
    const q = createRenderQueue(2);
    const grant = vi.fn();
    const release = q.request(5, grant);
    vi.advanceTimersByTime(50);
    release(false);
    vi.advanceTimersByTime(1000);
    expect(grant).not.toHaveBeenCalled();
  });

  it("admits at most maxConcurrent pages, nearest to the focus first", () => {
    const q = createRenderQueue(1);
    q.setFocus(() => 10);
    const granted: number[] = [];
    const releases = new Map<number, (finished: boolean) => void>();
    for (const p of [2, 11, 30]) {
      releases.set(
        p,
        q.request(p, () => granted.push(p)),
      );
    }
    vi.advanceTimersByTime(200);
    // all three became eligible in the same tick: the first to clear the
    // delay takes the free slot, the rest wait
    expect(granted).toHaveLength(1);
    const first = granted[0];
    releases.get(first)!(true);
    expect(granted).toHaveLength(2);
    // the next one is the remaining page nearest page 10
    const rest = [2, 11, 30].filter((p) => p !== first);
    const nearest = rest.sort((a, b) => Math.abs(a - 10) - Math.abs(b - 10))[0];
    expect(granted[1]).toBe(nearest);
  });

  it("keeps an abandoned render's slot taken for a while", () => {
    const q = createRenderQueue(1);
    const a = q.request(1, () => {});
    const grantB = vi.fn();
    vi.advanceTimersByTime(200);
    q.request(2, grantB);
    vi.advanceTimersByTime(200);
    expect(grantB).not.toHaveBeenCalled();
    a(false);
    expect(grantB).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(grantB).toHaveBeenCalledOnce();
  });

  it("frees a slot whose render never reports back", () => {
    const q = createRenderQueue(1);
    q.request(1, () => {});
    vi.advanceTimersByTime(200);
    const grantB = vi.fn();
    q.request(2, grantB);
    vi.advanceTimersByTime(5000);
    expect(grantB).toHaveBeenCalledOnce();
  });
});
