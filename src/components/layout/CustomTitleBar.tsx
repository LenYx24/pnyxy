import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@/lib/tauri";

// Custom window title bar for the native (Tauri) app. The native
// decorations are turned off (tauri.conf.json), so this provides drag,
// minimize, maximize/restore and close. Renders nothing in the browser.
export function CustomTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized).catch(() => {});
    // keep the maximize/restore icon in sync as the user resizes
    void win
      .onResized(() => {
        void win.isMaximized().then(setMaximized).catch(() => {});
      })
      .then((u) => {
        unlisten = u;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, []);

  if (!isTauri) return null;
  const win = getCurrentWindow();

  const btn =
    "flex h-full w-11 items-center justify-center text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary cursor-pointer";

  return (
    <div
      data-tauri-drag-region
      className="fixed inset-x-0 top-0 z-[9999] flex h-8 select-none items-center justify-between border-b border-glass-border bg-bg-secondary"
    >
      <div
        data-tauri-drag-region
        className="pointer-events-none flex items-center gap-2 pl-3 text-xs font-medium text-text-secondary"
      >
        <img src="/logo.svg" alt="" aria-hidden className="h-4 w-auto" />
        <span>Pnyxy</span>
      </div>
      <div className="flex h-full">
        <button
          type="button"
          onClick={() => void win.minimize()}
          aria-label="Minimize"
          className={btn}
        >
          <Minus size={15} />
        </button>
        <button
          type="button"
          onClick={() => void win.toggleMaximize()}
          aria-label={maximized ? "Restore" : "Maximize"}
          className={btn}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          onClick={() => void win.close()}
          aria-label="Close"
          className="flex h-full w-11 items-center justify-center text-text-muted transition-colors hover:bg-danger hover:text-white cursor-pointer"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
