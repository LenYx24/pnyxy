import type { TFunction } from "i18next";

// true/false questions store "True"/"False" as their option labels; show
// those (and missing labels) in the UI language, keep custom labels as is
export function tfLabels(
  a: string | null | undefined,
  b: string | null | undefined,
  t: TFunction,
): [string, string] {
  const pick = (v: string | null | undefined, fallback: string, key: string) =>
    !v || v === fallback ? t(key) : v;
  return [
    pick(a, "True", "quizzes.trueLabel"),
    pick(b, "False", "quizzes.falseLabel"),
  ];
}
