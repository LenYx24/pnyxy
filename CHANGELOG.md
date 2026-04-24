# Changelog

All notable changes to Pnyxy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) — though
while the project is on 0.x, minor bumps may still include breaking changes.

## [Unreleased]

## [0.2.1] — 2026-04-24

### Fixed
- Mobile: AI chat, TOC, and Comments panels no longer render their content
  while closed. Previously their effects (auto-scroll, textarea autoresize,
  visualViewport listeners) fired on every reader mount and leaked onto the
  main view on Android WebView, which looked like the panel auto-opening.

## [0.2.0] — 2026-04-24

### Added
- **Vocabulary builder.** Dictionary lookups in the reader are now captured
  into a local-first, Supabase-synced vocabulary list with FSRS-scheduled
  flashcard reviews. CSV export compatible with Anki.
- **Mobile reader UX.** Tap-to-toggle toolbar (ReadEra pattern), safe-area
  insets on reader chrome, swipe-left/right for PDF page turn, two-finger
  pinch zoom, keyboard avoidance for the AI chat input on iOS/Android,
  ESC-to-close for mobile panels.
- **PWA install.** Manifest + 192/512 icons + maskable variant so the site
  installs cleanly to Android home screens with the correct logo.
- **Library pull-to-refresh** on mobile.
- **Web Share API** in the annotation context menu — "Share…" opens the
  native share sheet on mobile with the selected text + book attribution.
- **Overscroll hygiene.** `overscroll-behavior: none` on `html` so the
  browser's default pull-to-refresh doesn't fire inside the app.

### Changed
- Schema migration `00020_vocabulary` adds `vocab_entries` with RLS.
- IndexedDB version bumped to 6 to add the `vocab` object store.

## [0.1.0]

Initial alpha: PDF/EPUB reader, annotations + notes + whiteboards,
multi-provider AI chat, library with catalog, auth + profiles, themes &
plugins, Tauri desktop + mobile wrappers, Cloudflare-hosted web.
