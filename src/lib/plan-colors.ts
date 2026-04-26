// Six-swatch palette for differentiating reading plans on the list
// page. Each entry maps to Tailwind utility classes; storing only the
// key in the DB keeps the visual choices reskinnable without a
// migration. `null` / unknown keys fall back to the neutral default.

export type PlanColorKey =
  | "purple"
  | "blue"
  | "green"
  | "amber"
  | "pink"
  | "red";

export const PLAN_COLOR_KEYS: PlanColorKey[] = [
  "purple",
  "blue",
  "green",
  "amber",
  "pink",
  "red",
];

interface PlanColorClasses {
  /** A solid swatch used in the picker and as a small chip on cards. */
  swatch: string;
  /** Left-border accent on the list/detail card. */
  border: string;
  /** Subtle tinted background on the card. */
  bg: string;
}

const COLORS: Record<PlanColorKey, PlanColorClasses> = {
  purple: {
    swatch: "bg-accent-purple",
    border: "border-l-accent-purple",
    bg: "bg-accent-purple/5",
  },
  blue: {
    swatch: "bg-accent-blue",
    border: "border-l-accent-blue",
    bg: "bg-accent-blue/5",
  },
  green: {
    swatch: "bg-green-500",
    border: "border-l-green-500",
    bg: "bg-green-500/5",
  },
  amber: {
    swatch: "bg-amber-500",
    border: "border-l-amber-500",
    bg: "bg-amber-500/5",
  },
  pink: {
    swatch: "bg-pink-500",
    border: "border-l-pink-500",
    bg: "bg-pink-500/5",
  },
  red: {
    swatch: "bg-red-500",
    border: "border-l-red-500",
    bg: "bg-red-500/5",
  },
};

const NEUTRAL: PlanColorClasses = {
  swatch: "bg-text-muted/40",
  border: "border-l-glass-border",
  bg: "",
};

export function planColorClasses(
  color: string | null | undefined,
): PlanColorClasses {
  if (color && color in COLORS) return COLORS[color as PlanColorKey];
  return NEUTRAL;
}
