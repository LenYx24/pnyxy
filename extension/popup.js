// Pnyxy browser extension: toolbar popup.
//
// Reads the current tab's title and selection (via chrome.scripting,
// since the popup has no direct access to the page), lets the user edit
// the text, then hands off to the background service worker to open the
// right Pnyxy URL. Settings (the app URL, useful for pointing the
// extension at a localhost dev server) live in chrome.storage.sync.

const DEFAULT_APP_URL = "https://pnyxy.com";

// Mirrors background.js's isTrustedAppUrl: https: for the real app,
// http://localhost or http://127.0.0.1 only for pointing at a dev server.
function isTrustedAppUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  }
  return false;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function getSelectionFromTab(tabId) {
  if (tabId == null) return "";
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection ? window.getSelection().toString() : ""),
    });
    return (results && results[0] && results[0].result) || "";
  } catch {
    // restricted page (chrome://, the Chrome Web Store, a PDF viewer, …):
    // fall back to an empty selection, the user can still type or paste
    return "";
  }
}

function setStatus(text) {
  const el = document.getElementById("settingsStatus");
  el.textContent = text;
  if (text) {
    window.clearTimeout(setStatus._timer);
    setStatus._timer = window.setTimeout(() => {
      el.textContent = "";
    }, 1500);
  }
}

async function init() {
  const tab = await getActiveTab();
  const pageTitleEl = document.getElementById("pageTitle");
  pageTitleEl.textContent = (tab && tab.title) || "";

  const selectionField = document.getElementById("selectionText");
  selectionField.value = await getSelectionFromTab(tab && tab.id);

  const stored = await chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL });
  const appUrlInput = document.getElementById("appUrl");
  appUrlInput.value = stored.appUrl || DEFAULT_APP_URL;

  document.getElementById("askBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "pnyxy-ask",
      selectionText: selectionField.value,
      pageUrl: tab && tab.url,
      pageTitle: tab && tab.title,
    });
    window.close();
  });

  document.getElementById("saveBtn").addEventListener("click", () => {
    chrome.runtime.sendMessage({
      type: "pnyxy-save-page",
      pageUrl: tab && tab.url,
    });
    window.close();
  });

  document.getElementById("saveSettingsBtn").addEventListener("click", async () => {
    const raw = appUrlInput.value.trim() || DEFAULT_APP_URL;
    if (!isTrustedAppUrl(raw)) {
      setStatus("Must be https://, or http://localhost for dev");
      return;
    }
    await chrome.storage.sync.set({ appUrl: raw });
    appUrlInput.value = raw;
    setStatus("Saved");
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void init();
});
