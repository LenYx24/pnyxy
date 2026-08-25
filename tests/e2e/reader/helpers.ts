import { expect, type Page, type Locator } from "@playwright/test";
import { resolve } from "node:path";

// Shared helpers for the PDF reader regression specs. Everything reads
// state from the DOM (scrollTop, element rects, mounted page count), never
// from screenshots, so the checks are deterministic across machines.

export const FIXTURE_LONG = resolve(process.cwd(), "tests/fixtures/long-120.pdf");
export const FIXTURE_SHORT = resolve(process.cwd(), "tests/fixtures/short-12.pdf");

/** The scroll container the PdfViewer owns (`data-pdf-viewer`). */
export const VIEWER = "[data-pdf-viewer]";
/** Toolbar page number input (`data-page-input`). */
export const PAGE_INPUT = "[data-page-input]";

export interface ViewerGeometry {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  clientWidth: number;
  offsetWidth: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export function viewer(page: Page): Locator {
  return page.locator(VIEWER);
}

export async function geometry(page: Page): Promise<ViewerGeometry> {
  return viewer(page).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      clientWidth: el.clientWidth,
      offsetWidth: (el as HTMLElement).offsetWidth,
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
    };
  });
}

export async function scrollTop(page: Page): Promise<number> {
  return viewer(page).evaluate((el) => el.scrollTop);
}

/** Value the toolbar page indicator currently shows. */
export async function indicatorPage(page: Page): Promise<number> {
  return Number(await page.locator(PAGE_INPUT).inputValue());
}

/**
 * Mounted page canvases whose rect intersects the viewer's rect, plus the
 * page number nearest to a given viewport y (or the top edge of the
 * viewer when omitted). Computed from rects so CSS transforms mid-zoom are
 * accounted for.
 */
export async function visiblePages(
  page: Page,
  atY?: number,
): Promise<{ canvasesInView: number; pageAt: number; topPage: number }> {
  return viewer(page).evaluate((el, atY) => {
    const cr = el.getBoundingClientRect();
    const probeY = typeof atY === "number" ? atY : cr.top + 1;
    let canvasesInView = 0;
    for (const c of el.querySelectorAll("canvas")) {
      const r = c.getBoundingClientRect();
      if (r.width > 0 && r.bottom > cr.top && r.top < cr.bottom) {
        canvasesInView += 1;
      }
    }
    let pageAt = 0;
    let bestDist = Infinity;
    let topPage = 0;
    let topBest = Infinity;
    for (const p of el.querySelectorAll<HTMLElement>(".react-pdf__Page")) {
      const n = Number(p.dataset.pageNumber);
      const r = p.getBoundingClientRect();
      const dist =
        probeY < r.top ? r.top - probeY : probeY > r.bottom ? probeY - r.bottom : 0;
      if (dist < bestDist) {
        bestDist = dist;
        pageAt = n;
      }
      // first page whose bottom is below the viewer top
      if (r.bottom > cr.top + 1 && r.top < topBest) {
        topBest = r.top;
        topPage = n;
      }
    }
    return { canvasesInView, pageAt, topPage };
  }, atY);
}

/**
 * Open a local PDF through the reader's own file-open path (the hidden
 * `<input type=file>` in ReaderEmptyState) and wait until the first page
 * canvas has rendered.
 */
export async function openLocalPdf(page: Page, fixture = FIXTURE_LONG) {
  await page.goto("/reader");
  const input = page.locator('input[type="file"]').first();
  await expect(input).toBeAttached();
  await input.setInputFiles(fixture);
  await page.waitForURL(/\/reader\/[^/]+$/, { timeout: 20_000 });
  await expect(page.locator(VIEWER)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(`${VIEWER} canvas`).first()).toBeVisible({
    timeout: 20_000,
  });
  await waitForScrollSettled(page);
}

/** Wait until scrollTop has not changed across three consecutive samples. */
export async function waitForScrollSettled(page: Page, sampleMs = 150) {
  await viewer(page).evaluate(
    (el, ms) =>
      new Promise<void>((done) => {
        let last = el.scrollTop;
        let stable = 0;
        const iv = setInterval(() => {
          if (el.scrollTop === last) stable += 1;
          else stable = 0;
          last = el.scrollTop;
          if (stable >= 3) {
            clearInterval(iv);
            done();
          }
        }, ms);
      }),
    sampleMs,
  );
}

/** Jump via the toolbar page input, then wait for layout + scroll to settle. */
export async function gotoPage(page: Page, n: number) {
  const input = page.locator(PAGE_INPUT);
  await input.fill(String(n));
  await input.press("Enter");
  await expect
    .poll(() => indicatorPage(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(n - 1);
  await waitForScrollSettled(page);
  await expect(
    page.locator(`${VIEWER} .react-pdf__Page[data-page-number="${n}"] canvas`),
  ).toBeVisible({ timeout: 10_000 });
}
