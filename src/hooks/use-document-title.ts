import { useEffect } from "react";

const BASE_TITLE = "Pnyxy";

/**
 * Sets `document.title` to `<title> · Pnyxy` while mounted, restoring the
 * previous title on unmount. Lets each open tab (chat, reader, ...) show what
 * it holds, so several Pnyxy tabs are distinguishable. Pass null/empty to keep
 * the bare app title.
 */
export function useDocumentTitle(title: string | null | undefined) {
  useEffect(() => {
    const previous = document.title;
    const trimmed = title?.trim();
    document.title = trimmed ? `${trimmed} · ${BASE_TITLE}` : BASE_TITLE;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
