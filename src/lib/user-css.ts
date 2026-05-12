// User-supplied CSS overrides. Power users paste rules into a
// textarea in Settings → Appearance and they're injected into a
// single <style> tag in <head> on every page load. Tailwind utility
// classes (.bg-accent-purple, .text-text-muted, etc.) and the
// theme CSS variables (--accent-purple, --bg-primary, …) are the
// intended stable surface to target.

const STORAGE_KEY = "pnyxy-user-css";
const STYLE_ELEMENT_ID = "user-custom-css";

export function getUserCss(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function applyUserCss(css: string) {
  if (typeof document === "undefined") return;
  let el = document.getElementById(STYLE_ELEMENT_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ELEMENT_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}

export function setUserCss(css: string) {
  try {
    localStorage.setItem(STORAGE_KEY, css);
  } catch {
    // localStorage can throw in private mode / out-of-quota — fall
    // through and still apply so the user at least sees the effect
    // for the current session.
  }
  applyUserCss(css);
}

export function loadUserCss() {
  applyUserCss(getUserCss());
}
