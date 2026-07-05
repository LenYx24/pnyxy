// PWA File Handlers + launchQueue glue. When the OS routes a PDF to
// Pnyxy ("Open with…" on Chromium desktop / Android Chrome for an
// installed PWA), the browser opens the manifest's `file_handlers.action`
// URL and queues the launch params. We register the consumer once at
// startup and forward any received File to whichever React listener is
// currently mounted (typically AppLayout, which calls openFile).
//
// Files received before the React listener is set are buffered so a
// cold-start launch still gets its file delivered.

type LaunchParams = {
  files?: Array<{
    getFile?: () => Promise<File>;
  }>;
};

declare global {
  interface Window {
    launchQueue?: {
      setConsumer: (cb: (params: LaunchParams) => void | Promise<void>) => void;
    };
  }
}

let pending: File[] = [];
let listener: ((files: File[]) => void) | null = null;

export function initLaunchedFiles() {
  if (typeof window === "undefined") return;
  const lq = window.launchQueue;
  if (!lq) return;
  lq.setConsumer(async (params) => {
    if (!params?.files?.length) return;
    const files: File[] = [];
    for (const handle of params.files) {
      try {
        if (typeof handle.getFile === "function") {
          const file = await handle.getFile();
          if (file instanceof File) files.push(file);
        }
      } catch {
        // skip unreadable handles silently, partial delivery is
        // better than dropping the whole launch
      }
    }
    if (!files.length) return;
    if (listener) listener(files);
    else pending.push(...files);
  });
}

export function setLaunchedFilesListener(cb: (files: File[]) => void) {
  listener = cb;
  if (pending.length) {
    const flush = pending;
    pending = [];
    cb(flush);
  }
}

export function clearLaunchedFilesListener() {
  listener = null;
}
