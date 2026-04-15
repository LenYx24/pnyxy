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

## License

MIT
