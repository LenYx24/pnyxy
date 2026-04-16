# Pnyxy Reader

A modern PDF reader and digital library built with React, TypeScript, and Supabase. Read, annotate, organize, and discover books — on web, desktop, and mobile.

## Features

- **PDF Reader** — zoom, search, print, screenshot, fullscreen, keyboard navigation
- **Annotations** — highlight text, add comments, view in a sidebar
- **Whiteboard** — draw over PDF pages with a canvas overlay
- **Notes** — create and edit notes alongside your reading
- **Library** — organize books into folders, upload PDFs, grid/list views, bulk operations
- **Catalog** — browse a community-shared book collection with category filters
- **Auth & Profiles** — user accounts, admin moderation dashboard, report system
- **Themes & Plugins** — runtime theme switching plus sandboxed community plugins (see [below](#themes--plugins))
- **Desktop & Mobile** — Tauri v2 wraps the web app for native builds on all platforms

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS 4 |
| State | Zustand |
| Backend | Supabase (auth, database, storage) |
| PDF | react-pdf (PDF.js) |
| Layout | Dockview (resizable panels) |
| Desktop/Mobile | Tauri v2 (Rust) |
| Hosting | Cloudflare Workers |
| Icons | Lucide React |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+
- [Rust](https://rustup.rs/) (only for desktop/mobile builds)
- A [Supabase](https://supabase.com/) project

### Setup

```sh
git clone https://github.com/your-username/pnyxy-reader.git
cd pnyxy-reader
pnpm install
```

Create a `.env` file from the example:

```sh
cp .env.example .env
```

Fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your-anon-key-here
```

### Development

```sh
pnpm dev          # Start Vite dev server at http://localhost:5173
```

### Build & Preview

```sh
pnpm build        # Type-check + production build
pnpm preview      # Preview the production build locally
```

### Deploy to Cloudflare

```sh
pnpm deploy:worker
```

Or push to `main` — the GitHub Actions workflow handles build + deploy automatically.

### Desktop (Tauri)

```sh
pnpm tauri:dev    # Dev mode with hot reload
pnpm tauri:build  # Production build (.exe / .msi / .dmg / .AppImage)
```

### Mobile (Tauri)

```sh
pnpm tauri:android:init   # One-time setup (requires Android Studio)
pnpm tauri:android:dev    # Run on emulator or device

pnpm tauri:ios:init       # One-time setup (requires Xcode, macOS only)
pnpm tauri:ios:dev        # Run on simulator or device
```

## Project Structure

```
src/
├── app/              # Providers, router
├── components/       # Shared UI components
├── features/         # Feature modules
│   ├── admin/        #   Admin dashboard & moderation
│   ├── auth/         #   Authentication
│   ├── browse/       #   Community catalog
│   ├── landing/      #   Landing page
│   ├── library/      #   Personal library
│   ├── notes/        #   Note editor
│   ├── profile/      #   User profile
│   ├── reader/       #   PDF reader & annotations
│   ├── settings/     #   User settings
│   └── whiteboard/   #   Drawing canvas
├── hooks/            # Custom React hooks
├── lib/              # Utilities (Supabase client, helpers)
├── stores/           # Zustand state stores
├── styles/           # Global styles
└── types/            # TypeScript type definitions
src-tauri/            # Tauri Rust backend (desktop/mobile)
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm dev` | Start dev server |
| `pnpm build` | Type-check and build for production |
| `pnpm lint` | Run ESLint |
| `pnpm preview` | Preview production build |
| `pnpm deploy:worker` | Build and deploy to Cloudflare |
| `pnpm tauri:dev` | Desktop dev mode |
| `pnpm tauri:build` | Desktop production build |

## Auth setup

Pnyxy ships Supabase auth config and branded email templates in `supabase/`. After you've linked your Supabase project, apply them with the CLI:

```sh
supabase db push         # apply migrations, including 00009_auth_user_metadata
supabase config push     # push auth settings and email templates from supabase/config.toml
```

Alternatively, paste the HTML from `supabase/templates/*.html` into **Auth → Email Templates** in the Supabase dashboard (Confirm signup, Magic link, Reset password, Change email).

### Google OAuth

To enable the "Continue with Google" button on the sign-in page:

1. Create OAuth credentials in the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) (Web application). Add the authorized redirect URI `<SUPABASE_URL>/auth/v1/callback`.
2. In Supabase, set the Google provider to **Enabled** and paste the Client ID / Client Secret — either via the dashboard (**Authentication → Providers → Google**) or by exporting `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` before running `supabase config push` (the provided `supabase/config.toml` reads them via `env(...)`).
3. Make sure your app origin (`http://localhost:5173` in dev) is listed under **Authentication → URL Configuration → Site URL / Redirect URLs** — the provided config already adds `/auth/welcome`, `/auth/reset-password`, and `/library`.

## Themes & Plugins

Pnyxy ships with a runtime extension system. Themes and plugins live in
**Settings → Appearance** and **Settings → Plugins**, where users can
toggle the built-ins, install community packages from the registry,
and configure each one. Preferences sync to Supabase
(`profiles.preferences`); plugin bundles stay local-only.

### Authoring a theme

A theme is a JSON object that overrides CSS custom properties. Drop a
file like this into the community registry repo
([pnyxy-community](https://github.com/pnyxy/pnyxy-community)) under
`themes/<id>.json`:

```json
{
  "id": "solar",
  "name": "Solar",
  "description": "Warm light theme inspired by old paper.",
  "author": "Your Name",
  "apiVersion": 1,
  "variant": "light",
  "tokens": {
    "--color-bg-primary": "#fdf6e3",
    "--color-bg-secondary": "#eee8d5",
    "--color-bg-tertiary": "#e1dbc4",
    "--color-accent-purple": "#6c71c4",
    "--color-accent-blue": "#268bd2",
    "--color-text-primary": "#073642",
    "--color-text-secondary": "#586e75",
    "--color-text-muted": "#93a1a1",
    "--color-glass-bg": "rgba(0, 0, 0, 0.04)",
    "--color-glass-border": "rgba(0, 0, 0, 0.1)",
    "--color-glass-hover": "rgba(0, 0, 0, 0.06)"
  }
}
```

The 11 token keys above are the full theme contract — they map 1:1 to
the `@theme` block in `src/styles/index.css`. Switching themes is
instant (no reload) because the host writes them onto
`document.documentElement` via `style.setProperty`.

### Authoring a plugin

A plugin is a manifest plus a single bundled JS file. The manifest
lives at `plugins/<id>/manifest.json` in the registry, the bundle at
`plugins/<id>/bundle.js`.

**`manifest.json`:**

```json
{
  "id": "hello-world",
  "name": "Hello World",
  "version": "1.0.0",
  "apiVersion": 1,
  "author": "Your Name",
  "description": "Logs a friendly message when a book opens.",
  "entry": "bundle.js",
  "permissions": ["events:book", "notifications"]
}
```

**`bundle.js`** (must export an object via `module.exports`):

```js
let subId = null;

module.exports = {
  async onLoad(api) {
    subId = await api.events.on("book:opened");
  },
  handleEvent(_subId, payload) {
    // Fired for every "book:opened" host event.
    console.log("[hello-world] opened", payload.title);
  },
  async onUnload() {
    if (subId !== null) await api.events.off(subId);
  },
};
```

#### Sandbox & permissions

Community plugins run in a **cross-origin iframe** with
`sandbox="allow-scripts"` (no `allow-same-origin`, opaque origin).
That means a plugin cannot:

- Touch the host DOM, cookies, or `localStorage`
- Read other plugins' state
- Make network requests on the host's origin

All host capabilities go through the JSON-RPC `PluginAPI` surface,
which is enforced host-side against the manifest's `permissions`:

| Permission         | Grants access to                          |
|--------------------|-------------------------------------------|
| `storage`          | `api.storage.{get,set,remove,keys}`       |
| `notifications`    | `api.notifications.show`                  |
| `events:reader`    | Subscribing to `reader:page-change`       |
| `events:book`      | Subscribing to `book:opened`/`closed`     |
| `commands`         | Registering & executing host commands     |

Calling a method without the matching permission throws
`PermissionDeniedError`. Every argument and return value MUST be
JSON-serializable — that's what lets the same `PluginAPI` work in both
the sandboxed iframe runtime and (eventually) the native runtime
without any glue code.

#### Core plugins

Two plugins ship in-tree as reference implementations
(`src/lib/plugins/core/`):

- **`reading-stats`** — counts unique pages read per document
- **`keyboard-cheatsheet`** — registers `?` to show all shortcuts

Both are disabled by default; toggle them in Settings → Plugins.

## License

MIT
