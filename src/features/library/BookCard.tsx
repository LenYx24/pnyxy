import { GlassCard } from "@/components/ui";

interface BookCardProps {
  title: string;
  author: string;
  progress: number;
  coverColor?: string;
}

export function BookCard({
  title,
  author,
  progress,
  coverColor = "from-accent-purple/30 to-accent-blue/30",
}: BookCardProps) {
  return (
    <GlassCard className="overflow-hidden">
      <div
        className={`flex h-48 items-center justify-center bg-gradient-to-br ${coverColor}`}
      >
        <span className="text-4xl font-bold text-white/20">
          {title.charAt(0)}
        </span>
      </div>
      <div className="p-4">
        <h3 className="mb-1 truncate text-sm font-semibold text-text-primary">
          {title}
        </h3>
        <p className="mb-3 truncate text-xs text-text-muted">{author}</p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-tertiary">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent-purple to-accent-blue transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="mt-1.5 block text-xs text-text-muted">
          {progress}% complete
        </span>
      </div>
    </GlassCard>
  );
}
