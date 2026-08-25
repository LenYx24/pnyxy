import { test, expect, type Page } from "@playwright/test";
import {
  FIXTURE_LONG,
  gotoPage,
  indicatorPage,
  openLocalPdf,
  VIEWER,
  waitForScrollSettled,
} from "./helpers";

// Guards: resume-position. The reader store persists lastPosition +
// scrollOffset per document id (a content hash) to IndexedDB, and the
// scroll-to-page path re-snaps on open.
//
// A local file lives only in the in-memory file-store, so a full reload of
// /reader/:id shows the empty state instead of the book. Two paths are
// covered instead:
//   1. SPA navigation away and back (document stays in the store).
//   2. Reload, then re-open the same file: the persisted IndexedDB
//      position must be restored (same content hash -> same doc id).

/** Client-side navigation through the router's popstate listener. */
async function spaNavigate(page: Page, path: string) {
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);
}

test("navigating away and back within the SPA resumes the same page", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 60);
  const docUrl = new URL(page.url()).pathname;
  const before = await indicatorPage(page);
  expect(before).toBeGreaterThanOrEqual(59);

  await spaNavigate(page, "/library");
  await expect(page.locator(VIEWER)).toHaveCount(0);
  await expect(page).toHaveURL(/\/library/);

  await spaNavigate(page, docUrl);
  await expect(page.locator(VIEWER)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(`${VIEWER} canvas`).first()).toBeVisible({
    timeout: 15_000,
  });
  await waitForScrollSettled(page);
  await expect.poll(() => indicatorPage(page), { timeout: 5_000 }).toBeGreaterThanOrEqual(before - 1);
  expect(await indicatorPage(page)).toBeLessThanOrEqual(before + 1);
});

test("re-opening the same file after a reload resumes the persisted page", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 60);
  const before = await indicatorPage(page);
  // progress persist is debounced; give it time to land in IndexedDB
  await page.waitForTimeout(1500);

  await page.reload();
  // local files are not re-parsed on reload: the empty state shows
  await expect(page.locator('input[type="file"]').first()).toBeAttached({
    timeout: 15_000,
  });
  expect(await page.locator(VIEWER).count()).toBe(0);

  await page.locator('input[type="file"]').first().setInputFiles(FIXTURE_LONG);
  await page.waitForURL(/\/reader\/[^/]+$/, { timeout: 20_000 });
  await expect(page.locator(`${VIEWER} canvas`).first()).toBeVisible({
    timeout: 20_000,
  });
  await waitForScrollSettled(page);
  await expect
    .poll(() => indicatorPage(page), { timeout: 10_000 })
    .toBeGreaterThanOrEqual(before - 1);
  expect(await indicatorPage(page)).toBeLessThanOrEqual(before + 1);
  await expect(
    page.locator(`${VIEWER} .react-pdf__Page[data-page-number="${before}"] canvas`),
  ).toBeVisible();
});
