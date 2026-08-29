import { describe, expect, it } from "vitest";
import {
  buildVideoSystemPrompt,
  formatTimestamp,
  parseTimestamp,
  sliceTranscript,
  transcriptToText,
} from "./video-chat";

const segments = [
  { start: 0, dur: 4, text: "Hello" },
  { start: 4, dur: 4, text: "world" },
  { start: 40, dur: 5, text: "later" },
  { start: 125, dur: 5, text: "much later" },
];

describe("formatTimestamp / parseTimestamp", () => {
  it("round-trips m:ss and h:mm:ss", () => {
    expect(formatTimestamp(125)).toBe("2:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(parseTimestamp("2:05")).toBe(125);
    expect(parseTimestamp("1:02:05")).toBe(3725);
    expect(parseTimestamp("90")).toBe(90);
  });
  it("distinguishes empty (null) from invalid (undefined)", () => {
    expect(parseTimestamp("")).toBeNull();
    expect(parseTimestamp("  ")).toBeNull();
    expect(parseTimestamp("abc")).toBeUndefined();
    expect(parseTimestamp("1:2:3:4")).toBeUndefined();
  });
});

describe("sliceTranscript", () => {
  it("keeps overlapping cues, open bounds pass everything", () => {
    expect(sliceTranscript(segments, { startSec: null, endSec: null })).toHaveLength(4);
    expect(
      sliceTranscript(segments, { startSec: 5, endSec: 60 }).map((s) => s.text),
    ).toEqual(["world", "later"]);
    expect(
      sliceTranscript(segments, { startSec: 100, endSec: null }).map((s) => s.text),
    ).toEqual(["much later"]);
  });
});

describe("transcriptToText", () => {
  it("groups cues into ~30s timestamped lines", () => {
    const text = transcriptToText(segments);
    expect(text.split("\n")).toEqual([
      "[0:00] Hello world later",
      "[2:05] much later",
    ]);
  });
});

describe("buildVideoSystemPrompt", () => {
  it("embeds the clipped transcript in transcript mode", () => {
    const prompt = buildVideoSystemPrompt({
      title: "Lecture",
      mode: "transcript",
      clip: { startSec: 100, endSec: null },
      transcript: segments,
    });
    expect(prompt).toContain('Video: "Lecture"');
    expect(prompt).toContain("from 1:40 to the end");
    expect(prompt).toContain("[2:05] much later");
    expect(prompt).not.toContain("Hello world");
  });
  it("says when no transcript is available", () => {
    const prompt = buildVideoSystemPrompt({
      title: "Lecture",
      mode: "transcript",
      clip: { startSec: null, endSec: null },
      transcript: null,
    });
    expect(prompt).toContain("No transcript is available");
  });
  it("never includes the transcript in video mode", () => {
    const prompt = buildVideoSystemPrompt({
      title: "Lecture",
      mode: "video",
      clip: { startSec: null, endSec: null },
      transcript: segments,
    });
    expect(prompt).toContain("the whole video");
    expect(prompt).not.toContain("<transcript>");
    expect(prompt).not.toContain("much later");
  });
});
