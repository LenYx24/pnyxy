import { useRef } from "react";
import { MoreVertical } from "lucide-react";
import { FloatingMenu } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * 3-dot trigger + portal-rendered floating menu used by both
 * `FolderRow` and `BookRow`. Portal-mounted so the list container's
 * `overflow-x-auto` can't clip the dropdown, the bug this whole
 * detour fixes.
 */
export function ContextMenu({
  children,
  open,
  onToggle,
}: {
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="shrink-0">
      <button
        ref={triggerRef}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          "rounded-md p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer",
          open
            ? "opacity-100"
            : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
        )}
      >
        <MoreVertical size={14} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={triggerRef}
        onClose={onToggle}
        className="w-44"
      >
        {children}
      </FloatingMenu>
    </div>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-sm transition-colors hover:bg-glass-hover cursor-pointer",
        danger ? "text-danger" : "text-text-secondary hover:text-text-primary",
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
