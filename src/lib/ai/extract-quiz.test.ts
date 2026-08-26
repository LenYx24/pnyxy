import { describe, expect, it } from "vitest";
import { extractInlineQuiz } from "./extract-quiz";

const quizJson = JSON.stringify({
  title: "Euklideszi algoritmus",
  questions: [
    { q: "lnko(252, 198)?", options: ["6", "18", "36"], correct: 1, explanation: "54, 36, 18 [p.42]" },
    { q: "lnko(a, 0)?", options: ["a", "0"], correct: 0 },
  ],
});

describe("extractInlineQuiz", () => {
  it("parses a closed quiz fence and strips it from the prose", () => {
    const content = `Rendben, kezdjük!\n\n\`\`\`quiz\n${quizJson}\n\`\`\`\n\nSok sikert!`;
    const res = extractInlineQuiz(content);
    expect(res.quiz?.title).toBe("Euklideszi algoritmus");
    expect(res.quiz?.questions).toHaveLength(2);
    expect(res.quiz?.questions[0].correct).toBe(1);
    expect(res.quiz?.questions[1].explanation).toBeNull();
    expect(res.cleaned).toContain("Rendben");
    expect(res.cleaned).toContain("Sok sikert");
    expect(res.cleaned).not.toContain("```quiz");
    expect(res.pending).toBeUndefined();
  });

  it("drops questions with an out-of-range correct index or too few options", () => {
    const bad = JSON.stringify({
      questions: [
        { q: "ok", options: ["a", "b"], correct: 0 },
        { q: "bad index", options: ["a", "b"], correct: 5 },
        { q: "one option", options: ["a"], correct: 0 },
      ],
    });
    const res = extractInlineQuiz(`\`\`\`quiz\n${bad}\n\`\`\``);
    expect(res.quiz?.questions).toHaveLength(1);
  });

  it("returns no quiz for malformed JSON but still strips the fence", () => {
    const res = extractInlineQuiz("Szia\n```quiz\n{not json]\n```");
    expect(res.quiz).toBeUndefined();
    expect(res.cleaned).toBe("Szia");
  });

  it("marks an unterminated fence as pending and hides the partial JSON", () => {
    const res = extractInlineQuiz('Íme:\n```quiz\n{"title": "fél');
    expect(res.pending).toBe(true);
    expect(res.quiz).toBeUndefined();
    expect(res.cleaned).toBe("Íme:");
  });

  it("leaves content without quiz fences untouched", () => {
    const res = extractInlineQuiz("Sima válasz ```js\ncode\n``` blokkal.");
    expect(res.quiz).toBeUndefined();
    expect(res.pending).toBeUndefined();
    expect(res.cleaned).toContain("```js");
  });
});
