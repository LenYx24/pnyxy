import type { LucideIcon } from "lucide-react";

/** Small corner glyph on a grid card's cover marking the item type. */
export function CardTypeBadge({
  icon: Icon,
  colorClass,
  title,
}: {
  icon: LucideIcon;
  colorClass: string;
  title: string;
}) {
  return (
    <span
      className={`absolute bottom-1.5 left-1.5 rounded bg-bg-primary/80 p-0.5 ${colorClass} backdrop-blur-sm`}
      title={title}
    >
      <Icon size={10} />
    </span>
  );
}

