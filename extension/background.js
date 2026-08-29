// Pnyxy browser extension: background service worker.
//
// No host_permissions are declared, only activeTab + scripting, so page
// access only happens in direct response to a user action (context menu
// click, the keyboard shortcut, a popup button) and is scoped to the tab
// the user acted on.

const DEFAULT_APP_URL = "https://pnyxy.com";
const SELECTION_LIMIT = 4000;

const MENU_ASK = "pnyxy-ask-selection";
const MENU_ADD_PDF = "pnyxy-add-pdf";
const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;

// PDF tabs: the built-in viewer takes no content scripts, so the hint is
// a badge on the toolbar icon plus a context-menu entry; both hand the
// URL to the app's /open route, which downloads it into the library.
function updatePdfBadge(tabId, url) {
  const isPdf = typeof url === "string" && PDF_URL_RE.test(url);
  chrome.action.setBadgeText({ tabId, text: isPdf ? "PDF" : "" }).catch(() => {});
  if (isPdf) {
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#5fb3c6" }).catch(() => {});
    chrome.action.setTitle({ tabId, title: "Add this PDF to Pnyxy" }).catch(() => {});
  } else {
    chrome.action.setTitle({ tabId, title: "Pnyxy: chat about this page" }).catch(() => {});
  }
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") updatePdfBadge(tabId, tab && tab.url);
});
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => updatePdfBadge(tabId, tab && tab.url)).catch(() => {});
});

async function addPdfToApp(pdfUrl) {
  if (!pdfUrl) return;
  const appUrl = await getAppUrl();
  const params = new URLSearchParams();
  params.set("url", pdfUrl);
  await chrome.tabs.create({ url: `${appUrl}/open?${params.toString()}` });
}
const MENU_CHAT_PANEL = "pnyxy-chat-panel";
const MENU_SAVE_PAGE = "pnyxy-save-page";
const MENU_SAVE_LINK = "pnyxy-save-link";

// Only https: is trusted for the real app; http:// is allowed strictly for
// pointing the extension at a localhost dev server. Anything else (a typo
// leading to a non-http(s) scheme, or a settings value tampered with
// outside the popup's own UI) falls back to the shipped default rather
// than being handed to chrome.tabs.create/update.
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

function getAppUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ appUrl: DEFAULT_APP_URL }, (items) => {
      const raw = (items && items.appUrl) || DEFAULT_APP_URL;
      const trimmed = raw.replace(/\/+$/, "");
      resolve(isTrustedAppUrl(trimmed) ? trimmed : DEFAULT_APP_URL);
    });
  });
}

function truncate(text, limit) {
  if (!text) return "";
  return text.length > limit ? text.slice(0, limit) : text;
}

// Reuses an already-open tab on the same app origin instead of piling up
// new tabs on repeated clicks, but only when that tab is sitting at the
// app root: navigating a tab that's mid-composer (a chat draft, an
// in-progress form) out from under the user would silently discard it, so
// anywhere else on the app gets a fresh tab instead.
async function openOrFocusTab(url) {
  let targetOrigin;
  try {
    targetOrigin = new URL(url).origin;
  } catch {
    targetOrigin = null;
  }

  const tabs = await chrome.tabs.query({});
  const existing = targetOrigin
    ? tabs.find((tab) => {
        if (!tab.url) return false;
        try {
          const tabUrl = new URL(tab.url);
          return tabUrl.origin === targetOrigin && tabUrl.pathname === "/";
        } catch {
          return false;
        }
      })
    : undefined;

  if (existing && existing.id != null) {
    await chrome.tabs.update(existing.id, { active: true, url });
    if (existing.windowId != null) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
    return;
  }
  await chrome.tabs.create({ url });
}

async function askAboutSelection(selectionText, pageUrl, pageTitle) {
  const appUrl = await getAppUrl();
  const params = new URLSearchParams();
  params.set("q", truncate(selectionText || "", SELECTION_LIMIT));
  if (pageUrl) params.set("src", pageUrl);
  if (pageTitle) params.set("title", pageTitle);
  await openOrFocusTab(`${appUrl}/chat?${params.toString()}`);
}

async function savePage(pageUrl) {
  if (!pageUrl) return;
  const appUrl = await getAppUrl();
  const params = new URLSearchParams();
  params.set("addUrl", pageUrl);
  await openOrFocusTab(`${appUrl}/library?${params.toString()}`);
}

async function getSelectionFromTab(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => (window.getSelection ? window.getSelection().toString() : ""),
    });
    return (results && results[0] && results[0].result) || "";
  } catch {
    return "";
  }
}

// Side panel: the in-browser chat about the current page (app /ext route
// in an iframe, fed by sidepanel.js). Opening it must happen in the same
// user-gesture tick, so no awaits before chrome.sidePanel.open.
function openChatPanel(tab) {
  if (!chrome.sidePanel || !tab || tab.windowId == null) return Promise.resolve();
  return chrome.sidePanel
    .open({ windowId: tab.windowId })
    .then(() => {
      // a panel that is already open re-captures the page (fresh selection)
      chrome.runtime.sendMessage({ type: "pnyxy-panel-refresh" }).catch(() => {});
    })
    .catch(() => {});
}

// Toolbar icon → side panel (Chrome handles the gesture itself).
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
// Firefox / older Chromium without sidePanel: fall back to the old
// "ask about the selection" hand-off into the app.
chrome.action.onClicked.addListener(async (tab) => {
  if (chrome.sidePanel) return;
  const selection = tab && tab.id != null ? await getSelectionFromTab(tab.id) : "";
  await askAboutSelection(selection, tab && tab.url, tab && tab.title);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_CHAT_PANEL,
    title: "Chat with Pnyxy about this page",
    contexts: ["page", "selection"],
  });
  chrome.contextMenus.create({
    id: MENU_ADD_PDF,
    title: "Add this PDF to Pnyxy",
    contexts: ["page", "link"],
    documentUrlPatterns: ["*://*/*.pdf", "*://*/*.pdf?*", "*://*/*.pdf#*"],
  });
  chrome.contextMenus.create({
    id: MENU_ASK,
    title: "Ask Pnyxy about this",
    contexts: ["selection"],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_PAGE,
    title: "Save page to Pnyxy",
    contexts: ["page"],
  });
  chrome.contextMenus.create({
    id: MENU_SAVE_LINK,
    title: "Save page to Pnyxy",
    contexts: ["link"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ADD_PDF) {
    void addPdfToApp((info.linkUrl && PDF_URL_RE.test(info.linkUrl) ? info.linkUrl : null) || (tab && tab.url) || info.pageUrl);
  } else if (info.menuItemId === MENU_CHAT_PANEL) {
    void openChatPanel(tab);
  } else if (info.menuItemId === MENU_ASK) {
    void askAboutSelection(info.selectionText, tab && tab.url, tab && tab.title);
  } else if (info.menuItemId === MENU_SAVE_PAGE) {
    void savePage((tab && tab.url) || info.pageUrl);
  } else if (info.menuItemId === MENU_SAVE_LINK) {
    void savePage(info.linkUrl || (tab && tab.url));
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "ask-selection") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const selection = await getSelectionFromTab(tab.id);
  await askAboutSelection(selection, tab.url, tab.title);
});

// The popup can't reliably keep the service worker alive across its own
// async work once it closes (e.g. right after the user clicks a button),
// so it hands the actual navigation off to the background worker via a
// message instead of doing it inline.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own contexts (its popup, its content scripts)
  // should be able to trigger a tab navigation. No externally_connectable
  // is declared in the manifest so an unrelated page can't reach this
  // listener anyway, but a same-machine malicious/compromised extension
  // could still call chrome.runtime.sendMessage(ourExtensionId, ...).
  if (!sender || sender.id !== chrome.runtime.id) return undefined;
  if (!message || typeof message !== "object") return undefined;

  if (message.type === "pnyxy-ask") {
    void askAboutSelection(message.selectionText, message.pageUrl, message.pageTitle).then(
      () => sendResponse({ ok: true }),
    );
    return true;
  }
  // YouTube "✦ Pnyxy" pill: open the video inside the app (embedded
  // player + AI side-chat) in a new tab. The app's /open route saves it
  // to the library's "YouTube" folder and redirects to the viewer.
  if (message.type === "pnyxy-add-pdf") {
    void addPdfToApp(message.url).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "pnyxy-open-in-app") {
    void (async () => {
      const appUrl = await getAppUrl();
      const params = new URLSearchParams();
      params.set("url", message.url || (sender.tab && sender.tab.url) || "");
      if (message.title) params.set("title", message.title);
      await chrome.tabs.create({ url: `${appUrl}/open?${params.toString()}` });
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.type === "pnyxy-open-panel") {
    void openChatPanel(message.tab).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === "pnyxy-save-page") {
    void savePage(message.pageUrl).then(() => sendResponse({ ok: true }));
    return true;
  }
  return undefined;
});
