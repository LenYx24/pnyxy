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
- Toolbar icon opens the side-panel chat (see below); the page title, the current
  selection (editable), an "Ask Pnyxy" button, a "Save page" button, and a
  Settings section for the app URL (defaults to `https://pnyxy.com`, useful
  for pointing the extension at a local dev server).
- Keyboard shortcut `Ctrl+Shift+K` (`Cmd+Shift+K` on Mac): same as "Ask
  Pnyxy about this", using whatever is currently selected on the page.

## Permissions

Only `contextMenus`, `storage`, `activeTab`, `scripting`. No
`host_permissions`, so the extension only ever touches a page in direct
response to something you did on it (a context menu click, the shortcut,
the side panel).

## Files

- `manifest.json` - MV3 manifest.
- `background.js` - service worker: context menus, the keyboard shortcut,
  and the side panel's messages.
- `sidepanel.html` / `sidepanel.css` / `sidepanel.js` - side panel (iframe host + settings).
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

Open the side panel, click ⚙, set the App URL to
`http://localhost:5173` (the Vite dev server), click Save. Every action
now opens `http://localhost:5173/chat...` / `http://localhost:5173/library...`
instead of the production site. Switch it back to `https://pnyxy.com` (or
just clear it) when you're done.

## Reasoning notes

- `openOrFocusTab` reuses an already-open tab on the same origin instead
  of piling up new tabs on repeated clicks.
- No content script is declared in the manifest. Selection text comes
  from `chrome.scripting.executeScript` run against the active tab, both
  for the side panel and for the keyboard shortcut; the context menu's
  "selection" entry gets it for free from `info.selectionText`.


## Side panel chat (v1.1, pilot)

Clicking the toolbar icon (or the "Chat with Pnyxy about this page"
context-menu entry) opens Chrome's side panel with the app's `/ext` route in an iframe. The panel
reads the active tab (`article`/`main`/body text, title, selection) and
posts it into the iframe; the app saves the page as a **web resource in
the library's "Web" folder** (find-or-create by URL) and opens the
resource-scoped AI chat with the page text as context, so every
conversation about a page stays attached to it in the library.

- Reading pages needs host access: it is an **optional** permission
  (`optional_host_permissions: <all_urls>`) requested from the panel's
  "Allow reading pages" button on first use. Nothing is read until then.
- The iframe keeps its own Supabase session (browser storage is
  partitioned per top-level site), so the panel asks you to sign in once;
  `/auth?next=/ext` brings you back.
- The app must allow being framed by extensions: `public/_headers` sets
  `frame-ancestors 'self' chrome-extension: moz-extension:`.
- Server-side the feature is gated by the `webArticles` feature flag
  (admins see it via "show all features").
- Firefox: `sidebar_action` is not wired yet; the toolbar-icon / context-menu
  hand-offs keep working there.

The toolbar icon opens the side panel directly (`openPanelOnActionClick`);
the old popup is gone, its App URL setting lives behind the panel's ⚙.
On browsers without `chrome.sidePanel` the icon falls back to the
"ask about the selection" hand-off into the app.

### YouTube "Open with Pnyxy"

`youtube.js` (content script on youtube.com) adds a small muted "✦ Pnyxy"
pill at the end of the video title on watch pages (re-injected on
YouTube's in-page navigations). **Opt-in**: off by default, enabled with
the checkbox under the side panel's ⚙ (takes effect live). Clicking it opens the video **inside the app** in a new tab via
`/open?url=…`: saved into the library's **"YouTube"** folder through the
ingest function (title, thumbnail, captions → transcript mode), then the
resource viewer with the embedded player and the AI side-chat. (A side
panel can't be opened reliably from a content-script click, Chrome
doesn't always treat it as a user gesture.) In the chat, "+ → Organize library" can move
the video elsewhere ("put this in Algorithms/Graphs").

### PDFs

Chrome's PDF viewer accepts no content scripts, so a PDF tab gets a
**"PDF" badge on the toolbar icon**, a context-menu entry ("Add this PDF
to Pnyxy", also on links ending in .pdf) and an "Add to Pnyxy" button in
the side panel. All three open `/open?url=<pdf>` in the app, which
downloads the file (direct fetch, `fetch-url-proxy` on CORS failure) into
the upload queue: it lands in the library and opens in the reader.
