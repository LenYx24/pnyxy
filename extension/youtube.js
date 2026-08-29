// Pnyxy browser extension: YouTube content script.
//
// Adds a small, muted "✦ Pnyxy" pill at the end of the video title on
// watch pages. Clicking it opens the video inside the app in a new tab
// (saved to the library's "YouTube" folder, embedded player + AI
// side-chat), so watching continues there with the chat next to it.
// YouTube is a SPA, so the pill is (re)injected on every navigation.
//
// Opt-in: only shown when the "YouTube button" setting (side panel ⚙) is
// on; the storage change is picked up live, no reload needed.

const BUTTON_ID = "pnyxy-open-button";
let enabled = false;

function isWatchPage() {
  return location.pathname === "/watch" && new URLSearchParams(location.search).has("v");
}

function findTitleHost() {
  // watch page: the title block above the description
  return (
    document.querySelector("ytd-watch-metadata #title") ||
    document.querySelector("#above-the-fold #title") ||
    null
  );
}

function makeButton() {
  const btn = document.createElement("button");
  btn.id = BUTTON_ID;
  btn.type = "button";
  btn.textContent = "✦ Pnyxy";
  btn.title = "Open with Pnyxy: save this video to your library and chat about it";
  btn.setAttribute("aria-label", "Open with Pnyxy");
  // quiet by default (muted text, no fill), accent only on hover
  Object.assign(btn.style, {
    display: "inline-flex",
    alignItems: "center",
    verticalAlign: "middle",
    margin: "0 0 0 8px",
    padding: "2px 8px",
    borderRadius: "999px",
    border: "1px solid rgba(128,128,128,0.35)",
    background: "transparent",
    color: "rgba(128,128,128,0.9)",
    font: "500 11px/1.4 Roboto, Arial, sans-serif",
    cursor: "pointer",
    opacity: "0.75",
    transition: "opacity .15s, color .15s, border-color .15s",
  });
  btn.addEventListener("mouseenter", () => {
    btn.style.opacity = "1";
    btn.style.color = "#5fb3c6";
    btn.style.borderColor = "rgba(95,179,198,0.6)";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.opacity = "0.75";
    btn.style.color = "rgba(128,128,128,0.9)";
    btn.style.borderColor = "rgba(128,128,128,0.35)";
  });
  btn.addEventListener("click", () => {
    btn.disabled = true;
    btn.style.opacity = "0.6";
    chrome.runtime.sendMessage(
      { type: "pnyxy-open-in-app", url: location.href, title: document.title },
      () => {
        btn.disabled = false;
        btn.style.opacity = "0.75";
      },
    );
  });
  return btn;
}

let attempts = 0;
function inject() {
  const existing = document.getElementById(BUTTON_ID);
  if (!enabled || !isWatchPage()) {
    if (existing) existing.remove();
    return;
  }
  const host = findTitleHost();
  if (!host) {
    // metadata renders a bit after navigation; retry briefly
    if (attempts++ < 20) setTimeout(inject, 300);
    return;
  }
  attempts = 0;
  if (existing && host.contains(existing)) return;
  if (existing) existing.remove();
  host.appendChild(makeButton());
}

document.addEventListener("yt-navigate-finish", () => {
  attempts = 0;
  inject();
});
chrome.storage.sync.get({ ytButton: false }, (items) => {
  enabled = !!(items && items.ytButton);
  inject();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes.ytButton) return;
  enabled = !!changes.ytButton.newValue;
  attempts = 0;
  inject();
});
