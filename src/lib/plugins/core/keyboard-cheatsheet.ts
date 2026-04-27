import { getRegisteredShortcuts } from "@/lib/keyboard-shortcuts";
import type { PluginAPI, PluginManifest, PluginModule } from "../types";

export const keyboardCheatsheetManifest: PluginManifest = {
  id: "keyboard-cheatsheet",
  name: "Keyboard Cheatsheet",
  version: "1.0.0",
  apiVersion: 1,
  author: "Pnyxy",
  description:
    "Press ? on your keyboard to open a full-screen overlay showing all available keyboard shortcuts. Press ? again or Esc to close it. Works anywhere except inside text inputs.",
  entry: "",
  permissions: ["commands"],
  runtime: ["sandboxed"],
  defaultEnabled: true,
};

const OVERLAY_ID = "plugin-keyboard-cheatsheet-overlay";

function formatShortcut(s: {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push("Ctrl");
  if (s.shift) parts.push("Shift");
  if (s.alt) parts.push("Alt");
  const k =
    s.key === "=" ? "+" :
    s.key === "-" ? "-" :
    s.key.startsWith("Arrow") ? s.key.replace("Arrow", "") :
    s.key.length === 1 ? s.key.toUpperCase() :
    s.key;
  parts.push(k);
  return parts.join(" + ");
}

function toggleOverlay() {
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) {
    existing.remove();
    return;
  }

  const rows = Array.from(getRegisteredShortcuts().values())
    .filter((s) => s.description)
    .map(
      (s) => `
        <tr>
          <td style="padding:6px 12px;color:var(--color-text-secondary,#a0a0b0);font-size:13px;">${escapeHtml(s.description ?? "")}</td>
          <td style="padding:6px 12px;text-align:right;">
            <kbd style="font-family:ui-monospace,monospace;font-size:11px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:4px;padding:2px 6px;color:var(--color-text-primary,#f0f0f5);">${escapeHtml(formatShortcut(s))}</kbd>
          </td>
        </tr>
      `,
    )
    .join("");

  const wrapper = document.createElement("div");
  wrapper.id = OVERLAY_ID;
  wrapper.setAttribute("role", "dialog");
  wrapper.setAttribute("aria-label", "Keyboard shortcuts");
  wrapper.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);";
  wrapper.innerHTML = `
    <div style="max-width:520px;width:100%;max-height:70vh;overflow:auto;border-radius:12px;background:var(--color-bg-secondary,#111118);border:1px solid var(--color-glass-border,rgba(255,255,255,0.1));box-shadow:0 8px 32px rgba(0,0,0,0.4);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--color-glass-border,rgba(255,255,255,0.1));">
        <span style="font-weight:600;color:var(--color-text-primary,#f0f0f5);font-size:15px;">Keyboard Shortcuts</span>
        <span style="font-size:12px;color:var(--color-text-muted,#6b6b80);">Press ? or Esc to close</span>
      </div>
      <table style="width:100%;border-collapse:collapse;">
        ${rows || `<tr><td style="padding:24px;text-align:center;color:var(--color-text-muted,#6b6b80);font-size:13px;">No shortcuts registered.</td></tr>`}
      </table>
    </div>
  `;
  const dismiss = () => wrapper.remove();
  wrapper.addEventListener("click", (e) => {
    if (e.target === wrapper) dismiss();
  });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "?") {
      dismiss();
      window.removeEventListener("keydown", onKey, true);
    }
  };
  window.addEventListener("keydown", onKey, true);
  document.body.appendChild(wrapper);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}

export function createKeyboardCheatsheetModule(): PluginModule {
  let api: PluginAPI | null = null;
  let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

  const handlers = new Map<string, () => void | Promise<void>>();

  return {
    async onLoad(pluginApi) {
      api = pluginApi;
      await api.commands.register(
        "keyboard-cheatsheet:show",
        "Keyboard: Toggle cheatsheet",
      );
      handlers.set("keyboard-cheatsheet:show", toggleOverlay);

      onKeyDown = (e: KeyboardEvent) => {
        if (
          e.key === "?" &&
          !(e.target instanceof HTMLInputElement) &&
          !(e.target instanceof HTMLTextAreaElement) &&
          !(e.target instanceof HTMLElement && e.target.isContentEditable)
        ) {
          e.preventDefault();
          toggleOverlay();
        }
      };
      window.addEventListener("keydown", onKeyDown);
    },

    async onUnload() {
      if (onKeyDown) window.removeEventListener("keydown", onKeyDown);
      onKeyDown = null;
      document.getElementById(OVERLAY_ID)?.remove();
      handlers.clear();
      api = null;
    },

    async handleCommand(id) {
      const fn = handlers.get(id);
      if (fn) await fn();
    },
  };
}
