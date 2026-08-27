# Pnyxy browser extension

Manifest V3 extension for Chrome/Edge (Firefox-compatible, see below). Plain
vanilla JS/HTML/CSS, no build step, no bundler, no dependencies.

## What it does

- Select text on any page, right-click, "Ask Pnyxy about this": opens (or
  focuses) a Pnyxy tab at `/chat?q=<selection>&src=<pageUrl>&title=<pageTitle>`.
  The selection is capped at 4000 characters. The app turns this into a
  quoted draft in the composer, it does not auto-send, you still get to
  edit and hit send.
- Right-click a page or a link, "Save page to Pnyxy": opens
  `/library?addUrl=<pageUrl>`, which prefills the app's existing
  "add a link" flow.
- Toolbar icon opens a small popup with the page title, the current
  selection (editable), an "Ask Pnyxy" button, a "Save page" button, and a
  Settings section for the app URL (defaults to `https://pnyxy.com`, useful
  for pointing the extension at a local dev server).
- Keyboard shortcut `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac): same as "Ask
  Pnyxy about this", using whatever is currently selected on the page.

## Permissions

Only `contextMenus`, `storage`, `activeTab`, `scripting`. No
`host_permissions`, so the extension only ever touches a page in direct
response to something you did on it (a context menu click, the shortcut,
a popup button).

## Files

- `manifest.json` - MV3 manifest.
- `background.js` - service worker: context menus, the keyboard shortcut,
  and the popup's "Ask" / "Save page" messages.
- `popup.html` / `popup.css` / `popup.js` - toolbar popup.
- `icons/` - 16/48/128 px PNG icons plus `generate-icons.mjs`, the script
  that made them (Node's built-in `zlib`, no npm dependencies; Chrome
  doesn't accept SVG for extension icons).

## Load it unpacked

1. Chrome/Edge: open `chrome://extensions` (or `edge://extensions`).
2. Turn on "Developer mode" (top right).
3. Click "Load unpacked" and pick this `extension/` folder.
4. The Pnyxy icon appears in the toolbar. Pin it if you want it always
   visible.

Firefox: open `about:debugging#/runtime/this-firefox`, "Load Temporary
Add-on", pick `manifest.json` inside this folder. Firefox 109+ supports
this manifest (`browser_specific_settings.gecko` is set accordingly); the
temporary load only lasts the session, package it properly for anything
longer-lived.

## Point it at localhost

Open the popup, expand "Settings", set the App URL to
`http://localhost:5173` (the Vite dev server), click Save. Every action
now opens `http://localhost:5173/chat...` / `http://localhost:5173/library...`
instead of the production site. Switch it back to `https://pnyxy.com` (or
just clear it) when you're done.

## Reasoning notes

- `openOrFocusTab` reuses an already-open tab on the same origin instead
  of piling up new tabs on repeated clicks.
- The popup can't reliably finish async work after it closes, so its
  buttons send a message to the background service worker and let that
  do the actual `chrome.tabs` work.
- No content script is declared in the manifest. Selection text comes
  from `chrome.scripting.executeScript` run against the active tab, both
  for the popup and for the keyboard shortcut; the context menu's
  "selection" entry gets it for free from `info.selectionText`.
