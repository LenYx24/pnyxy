# Changelog

All notable changes to Pnyxy are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html), though
while the project is on 0.x, minor bumps may still include breaking changes.

## [Unreleased]

## [0.19.0], 2026-08-26
Fix LLM chat page, add animations, small bug fixes.

## [0.18.0], 2026-08-26
Disable most features, full app redesign, core refactor, e2e regression suite, library list redesign.

## [0.17.1], 2026-07-09
Fix linter errors.

## [0.17.0], 2026-07-09
Add onboarding.

## [0.16.0], 2026-07-05
Premium tier, file-first storage, prompt caching, context trimming, smart model routing, analytics tab, TTS MVP, mobile chat UI simplification.

## [0.15.0], 2026-05-20
TTS MVP, mobile main menu change, list view and dock layout fixes, MIME telemetry.

## [0.14.4], 2026-05-14
Add another model, small bug fixes.

## [0.14.3], 2026-05-13
Fix privacy policy link for Google verification.

## [0.14.2], 2026-05-13
Fix Library page bugs, add PDF viewer utilities.

## [0.14.1], 2026-05-12
Improve LLM page.

## [0.14.0], 2026-05-12
Add LLM models, model selection and description in settings, reasoning option.

## [0.13.1], 2026-05-12
Fix linting error.

## [0.13.0], 2026-05-12
LLM image generation, unify LLM page and side panel, chat composer and library folder fixes.

## [0.12.0], 2026-05-11
Markdown note editor, inline drawing, unified chat folders, external resource linking, mobile UX.

## [0.11.0], 2026-05-09
Zoom fixes, learning techniques on the book description page.

## [0.10.1], 2026-05-07
LLM chat tab improvements, better AI citation, pinch zoom fix, open PDFs with Pnyxy.

## [0.10.0], 2026-05-06
Action confirmation, focus-store feature, mobile fixes.

## [0.9.0], 2026-04-28
Physical book reading aids, whiteboards and notes, images in LLM chat, Tutorial page, command palette.

## [0.8.0], 2026-04-27
LLM tool use for roadmap and quiz generation, model selection, STT, chat folders, PDF reader optimization.

## [0.7.0], 2026-04-26
Cross-device sync of book position.

## [0.6.0], 2026-04-26
Organizations, plan creation and Quiz page improvements, avatar paste.

## [0.5.0], 2026-04-26
EPUB word selection and customizations, forum comment improvements.

## [0.4.1], 2026-04-25
Fix mobile PDF reading UX problems.

## [0.4.0], 2026-04-25
Landing page and mobile UX improvements.

## [0.3.0], 2026-04-24
Better Browse page and book browsing, new logo, SEO and footer changes.

## [0.2.2], 2026-04-24
Add changelog and code of conduct.

## [0.2.1], 2026-04-24

### Fixed
- Mobile: AI chat, TOC, and Comments panels no longer render their content
  while closed. Previously their effects (auto-scroll, textarea autoresize,
  visualViewport listeners) fired on every reader mount and leaked onto the
  main view on Android WebView, which looked like the panel auto-opening.

## [0.2.0], 2026-04-24

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
- **Web Share API** in the annotation context menu, "Share…" opens the
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
