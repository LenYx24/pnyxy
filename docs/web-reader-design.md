# Web Page Reader — Design Doc

*Status:* Research complete. Ready for implementation.

---

## 1. Goal

Allow users to paste a URL and read web articles/resources inside the
pnyxy reader, with access to existing features: AI chat, notes,
search, define/translate, whiteboard, reading streaks, print/screenshot.

---

## 2. Approach

### 2.1 Content extraction

Raw web pages contain navigation, ads, scripts, and tracking. We use
**Mozilla Readability** (`@mozilla/readability`) to extract the article
body, title, author, and text content — the same algorithm behind
Firefox Reader View.

The pipeline:

```
URL → fetch HTML (via proxy) → DOMParser → Readability → clean article
```

Output: `{ title, byline, content (clean HTML), textContent, length }`.

### 2.2 CORS proxy

Browsers block cross-origin HTML fetches. Two solutions depending on
platform:

| Platform | Strategy |
|----------|----------|
| **Web (Cloudflare)** | Cloudflare Worker endpoint (`/api/fetch-url`) that fetches the URL server-side and returns HTML. ~30 lines. Rate-limit per user to prevent abuse. |
| **Tauri (desktop)** | Rust command (`fetch_url`) using `reqwest`. No CORS restrictions. Faster, no proxy needed. |

For v1, the Cloudflare Worker proxy is sufficient for both platforms.

### 2.3 Document adapter

A new `web-adapter.ts` following the existing adapter pattern:

```typescript
interface WebAdapter extends DocumentAdapter {
  loadFromUrl(url: string): Promise<DocumentMeta>;
}
```

Since the current `load(file: File)` API expects a File, the web
adapter wraps the fetched HTML into a synthetic Blob/File so it fits
the existing `addDocument(adapter, file)` store API without changes.

**Capabilities:**
- `paginated: false` — web content is flow (like text/markdown)
- `editable: false` — read-only
- `searchable: true` — search extracted text content

**Methods:**
- `load()`: fetch URL via proxy → parse with DOMParser → run
  Readability → store clean HTML and text
- `extractToc()`: parse `<h1>`–`<h6>` from cleaned HTML → build
  nested `TocItem[]` (all `pageIndex: 0`)
- `search()`: reuse `runTextSearch()` utility on extracted text
  (same as text-adapter)
- `dispose()`: revoke any object URLs

### 2.4 Viewer component

A new `WebViewer.tsx`, similar to `TextViewer.tsx`:

- Renders cleaned HTML via `DOMPurify.sanitize()` (already used in
  TextViewer for markdown)
- Applies reader theme CSS variables for consistent look
- Strips external styles; applies a readable typography stylesheet
- Search highlighting via `<mark>` wrapping (same as TextViewer)
- Scroll-based reading position tracking

### 2.5 URL input UI

Add a URL input option alongside the existing file picker:
- In the library: an "Open URL" button next to "Open file"
- In the reader empty state: a URL text field
- Validates URL format before fetching

---

## 3. Feature compatibility

| Feature | Works? | Notes |
|---------|--------|-------|
| AI Chat | Yes | `getContent()` returns extracted text for LLM context |
| Notes | Yes | Notes are per-document, format-independent |
| Search | Yes | Text search on extracted content with `<mark>` highlighting |
| TOC sidebar | Yes | Parsed from HTML heading hierarchy |
| Define / Translate | Yes | Text selection context menu works on any DOM text |
| Reading progress | Yes | Scroll-based, same as text/markdown |
| Streaks / Stats | Yes | Reading time tracking is format-independent |
| Print / Screenshot | Yes | html2canvas works on any rendered DOM |
| Whiteboard | Partial | Works with experimental toggle (non-paginated formats). Overlay alignment is approximate since content reflows. |
| Highlights | No (v1) | Highlights use `PageRect` coordinates tied to PDF page layout. Flow content needs a different anchoring system (text offsets or CSS selectors). Same limitation exists for EPUB/TXT today. |
| Comments (annotations) | No (v1) | Same anchoring limitation as highlights. |
| Zoom | Partial | Font-size scaling works. Fit-width/fit-page modes are less meaningful for flow content. |

---

## 4. Files to create / modify

### New files
- `src/features/reader/adapters/web-adapter.ts` — adapter (~120 lines)
- `src/features/reader/WebViewer.tsx` — viewer component (~100 lines)
- Edge function or Worker for CORS proxy (~30 lines)

### Modified files
- `src/types/document.ts` — add `"web"` to `DocumentFormat` union
- `src/features/reader/adapters/index.ts` — add web format detection
  and `createWebAdapter()` case
- `src/features/reader/ReaderPage.tsx` — add `case "web"` to
  `ActiveViewer` switch
- `src/hooks/use-open-document.ts` — add `openUrl(url: string)` method
- Library / reader empty state — add URL input field

### New dependency
- `@mozilla/readability` — article extraction (MIT license, ~30KB)

---

## 5. Implementation phases

### Phase 1 (MVP)
1. Install `@mozilla/readability` and `linkedom` (for server-side
   DOMParser if needed, or use browser's built-in `DOMParser`)
2. Build Cloudflare Worker proxy endpoint
3. Implement `web-adapter.ts` with load, extractToc, search, dispose
4. Implement `WebViewer.tsx` with sanitized HTML rendering
5. Add URL input to reader empty state and library page
6. Wire format detection, ActiveViewer, and routes

### Phase 2 (enhancements)
- Text-offset-based highlights and comments for flow content (would
  also unlock highlights for EPUB and TXT/MD)
- Reader View toggle (show original page vs. cleaned article)
- Favicon / site icon display in library
- Save web pages to library (persist HTML to Supabase storage)
- Offline reading of saved web pages

---

## 6. Security considerations

- **DOMPurify** sanitizes all rendered HTML — no script execution,
  no iframe injection, no event handlers
- **CORS proxy** must rate-limit per user and reject non-HTTP(S) URLs
  to prevent SSRF
- **Content-Type validation** — proxy should only return text/html
  responses
- **URL validation** — reject private/internal IP ranges in the proxy
  to prevent server-side request forgery
- **No cookies forwarded** — proxy fetches with a clean request, no
  user credentials passed to target sites

---

## 7. Open questions

1. **Save to library?** Should fetched web pages be persistable like
   uploaded PDFs? If so, store the cleaned HTML in Supabase storage.
   Recommend: yes for Phase 2, not Phase 1.
2. **Images?** Readability preserves `<img>` tags. Should we proxy
   images too, or let them load directly? Direct loading is simpler
   but may break on pages that block hotlinking. Recommend: direct
   for v1, proxy for v2.
3. **Paywall / login-gated content?** The proxy can only fetch
   publicly accessible pages. No solution for paywalled content in v1.
4. **PDF links?** If a user pastes a URL ending in `.pdf`, should we
   download and open it as a PDF instead of running Readability?
   Recommend: yes, detect by content-type header.
