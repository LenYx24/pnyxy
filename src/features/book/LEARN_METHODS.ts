import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Layers,
  HelpCircle,
  MessagesSquare,
  Lightbulb,
  Baby,
} from "lucide-react";

export interface LearnMethod {
  slug: string;
  label: string;
  icon: LucideIcon;
  tagline: string;
  description: string;
  status: "stub" | "live";
}

export const LEARN_METHODS: LearnMethod[] = [
  {
    slug: "faq",
    label: "FAQ",
    icon: HelpCircle,
    tagline: "Shared Q&A",
    description:
      "Ask about the book. Similar past answers are surfaced first to save tokens and build a shared resource across readers.",
    status: "stub",
  },
  {
    slug: "flashcards",
    label: "Flashcards",
    icon: Layers,
    tagline: "Spaced repetition",
    description:
      "Auto-generated cards from your highlights and chapters, scheduled by an FSRS review algorithm.",
    status: "stub",
  },
  {
    slug: "quiz",
    label: "Quiz",
    icon: BookOpen,
    tagline: "Active recall",
    description:
      "Build or take multiple-choice quizzes on this book, or share them with the community.",
    status: "live",
  },
  {
    slug: "feynman",
    label: "Feynman",
    icon: Lightbulb,
    tagline: "Teach to learn",
    description:
      "You explain it; the AI plays a curious student and probes the weakest part of your explanation.",
    status: "stub",
  },
  {
    slug: "socratic",
    label: "Socratic",
    icon: MessagesSquare,
    tagline: "Guided by questions",
    description:
      "The AI responds to your question with questions, nudging you to reach the answer yourself.",
    status: "stub",
  },
  {
    slug: "eli5",
    label: "ELI5",
    icon: Baby,
    tagline: "Explain simply",
    description:
      "An explanation calibrated for a five-year-old. A quick check on whether you truly understood.",
    status: "stub",
  },
];
