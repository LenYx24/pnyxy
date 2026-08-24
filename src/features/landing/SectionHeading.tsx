import { cn } from "@/lib/cn";

/**
 * Shared landing section header: a tracked-out monospace eyebrow with a
 * short accent rule, then a display-font title. Left-aligned on purpose
 * (the editorial, asymmetric rhythm is what keeps the page from
 * reading as a generic centered-everything template.
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
      <div className="flex items-center gap-2.5 font-mono text-2xs font-medium uppercase tracking-[0.22em] text-accent">
        <span className="h-px w-6 bg-accent" />
        {eyebrow}
      </div>
      <h2 className="mt-3 font-display text-3xl font-bold tracking-tight text-text-primary sm:text-4xl">
        {title}
      </h2>
      {subtitle && (
        <p className="mt-3 max-w-2xl text-text-secondary">{subtitle}</p>
      )}
    </div>
  );
}
