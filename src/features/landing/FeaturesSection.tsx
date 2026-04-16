import {
  BookOpen,
  Video,
  PenTool,
  Sparkles,
  Flame,
  Users,
} from "lucide-react";
import { GlassCard } from "@/components/ui";

const features = [
  {
    icon: BookOpen,
    title: "Smart Reading",
    description:
      "Read EPUBs and PDFs with a distraction-free, customizable reader built for deep focus.",
  },
  {
    icon: Video,
    title: "Video Integration",
    description:
      "Link YouTube lectures and tutorials directly to your book chapters for multimedia learning.",
  },
  {
    icon: PenTool,
    title: "Study Tools",
    description:
      "Highlight, annotate, and create flashcards directly from your reading material.",
  },
  {
    icon: Sparkles,
    title: "AI Assistant",
    description:
      "Get explanations, summaries, and answers about your books powered by AI.",
  },
  {
    icon: Flame,
    title: "Streaks & Goals",
    description:
      "Build consistent reading habits with daily streaks, goals, and progress tracking.",
  },
  {
    icon: Users,
    title: "Community",
    description:
      "Share highlights, discuss books, and learn together with other readers.",
  },
];

export function FeaturesSection() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      <h2 className="mb-4 text-center text-3xl font-bold text-text-primary">
        Everything you need to read smarter
      </h2>
      <p className="mb-16 text-center text-text-secondary">
        Powerful tools designed around how people actually learn from books.
      </p>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ icon: Icon, title, description }) => (
          <GlassCard key={title} className="p-6">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-purple/15">
              <Icon size={20} className="text-accent-purple" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {title}
            </h3>
            <p className="text-sm leading-relaxed text-text-secondary">
              {description}
            </p>
          </GlassCard>
        ))}
      </div>
    </section>
  );
}
