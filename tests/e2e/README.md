# End-to-end tests

Playwright suite against the Vite dev server (`http://localhost:5173`).
`playwright.config.ts` starts `pnpm dev` itself when nothing is listening
and reuses a running server otherwise.

## Running

```sh
pnpm exec playwright install chromium   # once per machine
pnpm test:e2e:fixtures                  # regenerate tests/fixtures/*.pdf (already committed)
pnpm test:e2e:core                      # reader + chat + open-book regression suite
pnpm test:e2e                           # everything, including the smoke/screenshot specs
pnpm exec playwright test tests/e2e/reader --project=chromium-desktop   # one folder, one project
```

Signed-in specs (`tests/e2e/authed/`) need `TEST_USER_EMAIL` and
`TEST_USER_PASSWORD` in `.env.test` or `.env.test.local` (both gitignored).
Without them the `setup` project and the `*-authed` projects are simply not
generated, the public specs still run.

Projects: `chromium-desktop`, `chromium-mobile` (public specs),
`chromium-desktop-authed`, `chromium-mobile-authed` (signed in via the
storage state written by `auth.setup.ts`). The reader specs are desktop-only
(no scrollbar / ctrl+wheel on touch), and the two authed core specs skip
themselves on the mobile viewport.

## Fixtures

`scripts/make-test-pdf.mjs` hand-writes two PDFs (no dependencies):

- `tests/fixtures/long-120.pdf`: 120 pages, A4 portrait with every 10th page
  US Letter landscape, a huge page number on each page.
- `tests/fixtures/short-12.pdf`: same layout, 12 pages, used for the upload flow.

They are ~45 KB / ~5 KB and committed. The reader identifies a document by a
content hash, so re-generating them keeps the same ids.

## What each spec guards

Reader (`tests/e2e/reader/`, unauthenticated, local file opened through the
reader's own hidden `<input type=file>`; helpers in `helpers.ts` read
`scrollTop`, element rects and mounted canvases, never screenshots):

| spec | guards |
| --- | --- |
| `open-local-pdf` | file open path, `/ 120` page count in the toolbar, page 1 canvas rendered, portrait aspect, full scroll height |
| `wheel-scroll` | wheel scrolling is monotonic (no snap-back from a stale programmatic scroll / resume re-snap), indicator advances |
| `scrollbar-drag` | native scrollbar thumb drag through the virtualized list follows the mouse, never jumps back more than a page, and nothing moves scrollTop 1 s / 2.5 s after mouseup (launches Chromium without `--hide-scrollbars`) |
| `zoom-no-flicker` | ctrl+wheel in/out at page 80 keeps at least one canvas in the viewport at every 50 ms sample and the page under the cursor stays within +/-1; same for the Page Fit / 150% / Page Width presets |
| `resize-anchor` | the top-visible page stays at the top across viewport resizes (top-anchored re-anchor, not the old centre-based one) |
| `resume-position` | SPA navigate away/back resumes the page; after a reload the local file is gone (in-memory file store) but re-opening the same file restores the IndexedDB position |

Authed (`tests/e2e/authed/`):

| spec | guards |
| --- | --- |
| `chat.spec.ts` | `/chat` send -> streamed reply (user bubble, streamed text, exactly one proxy call carrying the user text). The `ai-chat-proxy` edge function is mocked in-page (`ai-proxy-mock.ts`: fetch override emitting Anthropic-style SSE `content_block_delta` events every 150 ms, honouring the AbortSignal); helper prompts (title, follow-ups) get a one-word reply. Each test deletes the conversation it created. The "Stop keeps partial text" test is `test.fixme` until the chat-stream abort bug below is fixed |
| `open-book.spec.ts` | library upload of `short-12.pdf`, clicking the card shows the `DocumentLoadingOverlay` (`[role=status].fixed`) within 300 ms measured in-page, URL becomes `/reader/...`, pages render; cleanup deletes the book via the card menu (also at the start, for leftovers) |

`authed/helpers.ts` has `skipOnboarding` (marks the first-run tour completed
in the persisted settings blob before any script runs) and `waitForActiveOrg`
(the OrgSwitcher only mounts once the org list is loaded; uploads fail before
that).

## Known app bugs the suite surfaced (tests left as `fixme` / worked around)

- `src/lib/ai/chat-stream.ts`, `streamPlain()`: on Stop the partial reply is
  lost. The streamed text lives in the function-local `local`; the
  AbortError thrown by the `for await` skips `acc = await streamPlain()`, so
  the `finally` persists and renders `content: ""`. The Stop test in
  `chat.spec.ts` is `test.fixme` until this is fixed.
- `src/stores/chat-store.ts`, `openConversation()`: the final
  `set({ messages, activeLeafId })` does not check that
  `activeConversationId` is still the conversation it fetched. ChatPage
  auto-opens the most recent conversation on `/chat`; clicking "New
  conversation" before that fetch resolves leaves the new thread with the
  old messages/leaf (user bubble missing, reply lands in the wrong branch).
  `chat.spec.ts` waits for the `chat_messages` request before creating a
  conversation; a guard like `if (get().activeConversationId !== conversationId) return;`
  before the `set` would close the race.

## Adding a bug-regression test

1. Reproduce the bug as DOM state: which number moves when it should not
   (`scrollTop`, `data-page-number` under a point, mounted canvas count, an
   input value). Avoid screenshots, they flake on font rendering.
2. Put reader bugs under `tests/e2e/reader/<bug>.spec.ts` and reuse
   `openLocalPdf`, `gotoPage`, `visiblePages`, `geometry`,
   `waitForScrollSettled` from `helpers.ts`. For timing-sensitive checks run
   an in-page sampler (`setInterval` + `performance.now()`, see
   `zoom-no-flicker.spec.ts`) instead of polling from the test runner.
3. Signed-in flows go under `tests/e2e/authed/`; call `skipOnboarding` in a
   `beforeEach`, mock network with `page.route` or an in-page fetch override
   when a stream must be interruptible, and clean up anything the test
   created so the shared test account stays tidy.
4. Name the test after the symptom and put the original bug description in a
   comment at the top of the file, that is what the next refactor needs.
5. If a check cannot be made deterministic, keep it as `test.fixme(...)` with
   the reason rather than deleting it.

The only DOM hooks the reader specs rely on already exist in `src`:
`data-pdf-viewer` (scroll container), `data-page-input` (toolbar page
field), react-pdf's `.react-pdf__Page[data-page-number]`, and the
`title="Zoom presets"` toolbar button.
