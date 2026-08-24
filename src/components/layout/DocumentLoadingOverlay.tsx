import { Loader2 } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";

/** App-wide overlay for the "opening a document" state. Lives in
 *  AppLayout so a click in the library gets instant feedback: before,
 *  the only consumer was ReaderPage, which is not mounted yet while
 *  the blob downloads, so the user saw nothing until the route changed. */
export function DocumentLoadingOverlay() {
  const isLoadingDocument = useUIStore((s) => s.isLoadingDocument);
  const loadingMessage = useUIStore((s) => s.loadingMessage);
  if (!isLoadingDocument) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-bg-primary/80 backdrop-blur-sm"
    >
      <Loader2 size={32} className="mb-3 animate-spin text-accent" />
      <p className="text-sm text-text-secondary">{loadingMessage}</p>
    </div>
  );
}
