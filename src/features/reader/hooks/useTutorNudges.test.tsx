import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useReaderStore } from "@/stores/reader-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useTutorNudgeStore } from "@/stores/tutor-nudge-store";
import { useTutorNudges } from "./useTutorNudges";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useTutorNudges();
  return null;
}

function setDoc(currentPage: number, lastReadAt: string | null) {
  useReaderStore.setState({
    activeDocumentId: "doc-1",
    documents: new Map([
      ["doc-1", { currentPage, lastReadAt } as never],
    ]),
  });
}

let root: Root;

async function mount() {
  const host = document.createElement("div");
  root = createRoot(host);
  await act(async () => {
    root.render(<Probe />);
  });
}

describe("useTutorNudges", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    useTutorNudgeStore.setState({ nudge: null });
    useSettingsStore.setState({ aiProactiveLevel: "low" });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.useRealTimers();
  });

  it("offers help after enough active time on one page", async () => {
    setDoc(22, new Date().toISOString());
    await mount();
    await act(async () => {
      // keep the user "present" so the clock keeps running
      for (let i = 0; i < 8; i++) {
        window.dispatchEvent(new Event("pointermove"));
        vi.advanceTimersByTime(60_000);
      }
    });
    expect(useTutorNudgeStore.getState().nudge).toEqual({
      kind: "stuck",
      docId: "doc-1",
      page: 22,
    });
  });

  it("does not count time while the user is idle", async () => {
    setDoc(22, new Date().toISOString());
    await mount();
    await act(async () => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(useTutorNudgeStore.getState().nudge).toBeNull();
  });

  it("offers a recap when a book is reopened after a break", async () => {
    setDoc(40, new Date(Date.now() - 5 * 86_400_000).toISOString());
    await mount();
    expect(useTutorNudgeStore.getState().nudge?.kind).toBe("resume");
  });

  it("stays silent when switched off", async () => {
    useSettingsStore.setState({ aiProactiveLevel: "off" });
    setDoc(40, new Date(Date.now() - 5 * 86_400_000).toISOString());
    await mount();
    expect(useTutorNudgeStore.getState().nudge).toBeNull();
  });

  it("mutes itself for the day after two declines", () => {
    const store = useTutorNudgeStore.getState();
    const rules = { stuckAfterMs: 1, resumeAfterDays: 1, maxPerDay: 9, declinesToMute: 2 };
    store.show({ kind: "stuck", docId: "d", page: 1 });
    useTutorNudgeStore.getState().decline();
    expect(useTutorNudgeStore.getState().canNudge(rules)).toBe(true);
    store.show({ kind: "stuck", docId: "d", page: 2 });
    useTutorNudgeStore.getState().decline();
    expect(useTutorNudgeStore.getState().canNudge(rules)).toBe(false);
  });
});
