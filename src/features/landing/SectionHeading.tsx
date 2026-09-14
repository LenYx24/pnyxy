import { cn } from "@/lib/cn";

/**
 * Shared landing section header: a soft accent chip (matching the app's own
 * accent-soft pills) then a display-font title. Left-aligned on purpose.
 */
export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  className,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-12", className)}>
      <span className="inline-flex items-center rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-accent">
        {eyebrow}
      </span>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 max-w-2xl text-text-secondary">{subtitle}</p>
      )}
    </div>
  );
}
