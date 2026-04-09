import { cn } from "@/lib/cn";

const mockTOC = [
  { id: "1", title: "Introduction", level: 0 },
  { id: "2", title: "Chapter 1: Getting Started", level: 0 },
  { id: "2.1", title: "Setting Up Your Environment", level: 1 },
  { id: "2.2", title: "First Steps", level: 1 },
  { id: "3", title: "Chapter 2: Core Concepts", level: 0 },
  { id: "3.1", title: "Fundamentals", level: 1 },
  { id: "3.2", title: "Advanced Topics", level: 1 },
  { id: "4", title: "Chapter 3: Practical Applications", level: 0 },
];

export function ReaderSidebar() {
  return (
    <div className="h-full w-64 border-r border-glass-border bg-bg-secondary/50 p-4">
      <h3 className="mb-4 text-sm font-semibold text-text-muted uppercase tracking-wider">
        Table of Contents
      </h3>
      <nav className="space-y-1">
        {mockTOC.map((item) => (
          <button
            key={item.id}
            className={cn(
              "block w-full rounded-md px-3 py-2 text-left text-sm transition-colors cursor-pointer",
              "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
              item.level > 0 && "pl-6 text-xs",
            )}
          >
            {item.title}
          </button>
        ))}
      </nav>
    </div>
  );
}
