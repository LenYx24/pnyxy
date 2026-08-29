// Pnyxy browser extension: side panel.
//
// Hosts the app's /ext route in an iframe and feeds it the active tab's
// URL / title / text / selection over postMessage. Reading a page needs
// host access, which is requested once (optional_host_permissions) from
// the "Allow reading pages" button, a user gesture inside the panel. The
// iframe announces itself with {type:"pnyxy:ready"}; after that, every
// tab switch / navigation re-captures the page and posts it again.

const DEFAULT_APP_URL = "https://pnyxy.com";
const MAX_TEXT = 120000;
const ALL_URLS = { origins: ["<all_urls>"] };

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

function isReadableTabUrl(url) {
  return typeof url === "string" && /^https?:/i.test(url);
}

// runs inside the page: the readable bits, nothing else
function capturePage() {
  const sel = window.getSelection ? window.getSelection().toString() : "";
  const main =
    document.querySelector("article") ||
    document.querySelector("main") ||
    document.body;
  const text = (main && main.innerText ? main.innerText : "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return {
    url: location.href,
    title: document.title || "",
    text: text.slice(0, 120000),
    selection: sel.slice(0, 4000),
  };
}

const state = {
  appOrigin: null,
  ready: false,
  lastKey: null,
};

const iframe = document.getElementById("app");
const gate = document.getElementById("gate");
const blocked = document.getElementById("blocked");
const pdfGate = document.getElementById("pdf");
const PDF_URL_RE = /\.pdf(?:[?#]|$)/i;
document.getElementById("addPdfBtn").addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!tab || !tab.url) return;
  chrome.runtime.sendMessage({ type: "pnyxy-add-pdf", url: tab.url }).catch(() => {});
});
const gateStatus = document.getElementById("gateStatus");

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

async function hasHostAccess() {
  try {
    return await chrome.permissions.contains(ALL_URLS);
  } catch {
    return false;
  }
}

function show(el, on) {
  if (on) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

async function pushActivePage(force) {
  if (!state.ready || !state.appOrigin) return;
  const tab = await getActiveTab();
  if (tab && tab.url && PDF_URL_RE.test(tab.url)) {
    show(pdfGate, true);
    show(blocked, false);
    show(iframe, false);
    return;
  }
  show(pdfGate, false);
  if (!tab || tab.id == null || !isReadableTabUrl(tab.url)) {
    show(blocked, true);
    show(iframe, false);
    return;
  }
  show(blocked, false);
  if (!(await hasHostAccess())) {
    show(gate, true);
    show(iframe, false);
    return;
  }
  show(gate, false);
  show(iframe, true);
  let page;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: capturePage,
    });
    page = results && results[0] && results[0].result;
  } catch {
    page = null;
  }
  if (!page) {
    page = { url: tab.url, title: tab.title || "", text: "", selection: "" };
  }
  page.text = (page.text || "").slice(0, MAX_TEXT);
  const key = page.url.replace(/#.*$/, "");
  if (!force && key === state.lastKey && !page.selection) return;
  state.lastKey = key;
  iframe.contentWindow.postMessage({ type: "pnyxy:page", ...page }, state.appOrigin);
}

// runs inside an app tab: the Supabase session from localStorage
// (key "sb-<ref>-auth-token"), tokens only
function readAppSession() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      const parsed = JSON.parse(localStorage.getItem(k) || "null");
      const s = parsed && parsed.currentSession ? parsed.currentSession : parsed;
      if (s && s.access_token && s.refresh_token) {
        return { access_token: s.access_token, refresh_token: s.refresh_token };
      }
    }
  } catch {
    /* no session */
  }
  return null;
}

// The iframe's storage is partitioned, so it can't see the session the
// user has in their Pnyxy tab. Copy it over: find an open app tab, read
// the tokens there, hand them to the frame (same app origin as target).
async function syncSessionFromApp() {
  if (!state.appOrigin || !state.ready) return false;
  const tabs = await chrome.tabs.query({ url: `${state.appOrigin}/*` });
  for (const tab of tabs) {
    if (tab.id == null) continue;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: readAppSession,
      });
      const session = results && results[0] && results[0].result;
      if (session) {
        iframe.contentWindow.postMessage({ type: "pnyxy:session", ...session }, state.appOrigin);
        return true;
      }
    } catch {
      /* tab not scriptable */
    }
  }
  return false;
}

async function openAppForSignIn() {
  const appUrl = await getAppUrl();
  await chrome.tabs.create({ url: `${appUrl}/auth` });
}

window.addEventListener("message", (event) => {
  if (!state.appOrigin || event.origin !== state.appOrigin) return;
  if (event.source !== iframe.contentWindow) return;
  const data = event.data;
  if (!data) return;
  if (data.type === "pnyxy:ready") {
    state.ready = true;
    state.lastKey = null;
    void pushActivePage(true);
  } else if (data.type === "pnyxy:need-auth") {
    void syncSessionFromApp().then((ok) => {
      if (!ok) iframe.contentWindow.postMessage({ type: "pnyxy:no-session" }, state.appOrigin);
    });
  } else if (data.type === "pnyxy:open-app") {
    void openAppForSignIn();
  } else if (data.type === "pnyxy:open-settings") {
    void openSettings();
  }
});

// the user just signed in on an app tab: push the session to the panel
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status !== "complete" || !state.appOrigin || !tab || !tab.url) return;
  if (tab.url.startsWith(state.appOrigin)) void syncSessionFromApp();
});

document.getElementById("grantBtn").addEventListener("click", async () => {
  gateStatus.textContent = "";
  let ok = false;
  try {
    ok = await chrome.permissions.request(ALL_URLS);
  } catch (err) {
    ok = false;
  }
  if (!ok) {
    gateStatus.textContent = "Permission not granted.";
    return;
  }
  await pushActivePage(true);
});

chrome.tabs.onActivated.addListener(() => void pushActivePage(false));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete" && tab && tab.active) void pushActivePage(false);
});
// re-send with the fresh selection when the user acts from the context
// menu / shortcut while the panel is open
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender || sender.id !== chrome.runtime.id) return;
  if (message && message.type === "pnyxy-panel-refresh") void pushActivePage(true);
});

// settings: the app URL (dev server vs production), then reload the frame
const settingsEl = document.getElementById("settings");
const appUrlInput = document.getElementById("appUrl");
const settingsStatus = document.getElementById("settingsStatus");
const ytButtonInput = document.getElementById("ytButton");
async function openSettings() {
  appUrlInput.value = await getAppUrl();
  chrome.storage.sync.get({ ytButton: false }, (items) => {
    ytButtonInput.checked = !!(items && items.ytButton);
  });
  show(settingsEl, true);
}
document.getElementById("closeSettingsBtn").addEventListener("click", () => show(settingsEl, false));
document.getElementById("saveSettingsBtn").addEventListener("click", () => {
  let raw = (appUrlInput.value || "").trim().replace(/\/+$/, "");
  // the Vite dev server is plain http; "https://localhost" is a common slip
  // that only yields "localhost sent an invalid response"
  raw = raw.replace(/^https:\/\/(localhost|127\.0\.0\.1)(?=[:/]|$)/i, "http://$1");
  if (raw && !isTrustedAppUrl(raw)) {
    settingsStatus.textContent = "Use an https:// URL (or http://localhost for dev).";
    return;
  }
  appUrlInput.value = raw || DEFAULT_APP_URL;
  chrome.storage.sync.set({ appUrl: raw || DEFAULT_APP_URL, ytButton: !!ytButtonInput.checked }, () => {
    settingsStatus.textContent = "Saved.";
    void boot();
  });
});

async function boot() {
  const appUrl = await getAppUrl();
  state.appOrigin = new URL(appUrl).origin;
  state.ready = false;
  state.lastKey = null;
  show(settingsEl, false);
  iframe.src = `${appUrl}/ext`;
}
void boot();
