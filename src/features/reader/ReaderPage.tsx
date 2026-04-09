import { BookOpen } from "lucide-react";
import { ReaderSidebar } from "./ReaderSidebar";

export function ReaderPage() {
  return (
    <div className="flex h-[calc(100vh-theme(spacing.14)-theme(spacing.12))] -m-6 -mt-0">
      <ReaderSidebar />
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-glass-bg">
          <BookOpen size={32} className="text-text-muted" />
        </div>
        <h2 className="mb-2 text-xl font-semibold text-text-primary">
          No book open
        </h2>
        <p className="max-w-sm text-sm text-text-secondary">
          Select a book from your library to start reading. Your reading
          progress will be saved automatically.
        </p>
      </div>
    </div>
  );
}
