import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { skipOnboarding, waitForActiveOrg } from "./helpers";

// Guards: library upload -> book card -> reader. Historic bug: clicking a
// card gave no feedback until the blob had downloaded and the route
// changed; the DocumentLoadingOverlay (role=status, mounted in AppLayout)
// must now appear right away. The overlay latency is measured inside the
// page (capture-phase click timestamp vs. MutationObserver) so Playwright's
// own click overhead is not counted.

const FIXTURE = resolve(process.cwd(), "tests/fixtures/short-12.pdf");
const TITLE = "short-12";

declare global {
  interface Window {
    __clickAt?: number;
    __overlayAt?: number;
  }
}

/** The list view is the default now; this flow covers the grid card,
 *  so switch to it first (the pick persists in localStorage). */
async function useGridView(page: Page) {
  await page.getByRole("button", { name: "Grid view" }).click();
}

function bookCards(page: Page) {
  // the clickable card body carries title="<title> - <author>" ("Unknown"
  // author for the fixture); `.group` is the card wrapper that also holds
  // the 3-dot menu
  return page.locator(".group", { has: page.locator(`div[title^="${TITLE}"]`) });
}

/** Delete every card titled TITLE via the card menu + confirm dialog. */
async function deleteFixtureBooks(page: Page) {
  for (let i = 0; i < 5; i++) {
    const card = bookCards(page).first();
    if ((await card.count()) === 0) return;
    await card.hover();
    await card.locator("div.absolute > button").first().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.locator("div", {
      has: page.getByRole("heading", { name: "Delete Book" }),
    });
    await dialog.getByRole("button", { name: "Delete", exact: true }).last().click();
    await expect(bookCards(page)).toHaveCount(
      Math.max(0, (await bookCards(page).count()) - 1),
      { timeout: 15_000 },
    );
  }
}

test.describe.configure({ mode: "serial" });

// Desktop-only core flow: the mobile layout moves the same actions into a
// drawer and a list layout, covered by the smoke suite instead.
test.skip(({ isMobile }) => Boolean(isMobile), "desktop-only core flow");

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

test("uploading a PDF, opening the card shows the overlay instantly and renders the book", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: /your library/i })).toBeVisible();

  await waitForActiveOrg(page);
  await useGridView(page);

  // leftovers from an aborted earlier run
  await deleteFixtureBooks(page);

  await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(FIXTURE);
  const card = bookCards(page).first();
  await expect(card).toBeVisible({ timeout: 90_000 });

  // instrument: capture click time and the overlay's first appearance
  await page.evaluate(() => {
    window.__clickAt = undefined;
    window.__overlayAt = undefined;
    document.addEventListener(
      "click",
      () => {
        if (window.__clickAt === undefined) window.__clickAt = performance.now();
      },
      { capture: true, once: true },
    );
    const mo = new MutationObserver(() => {
      if (
        window.__overlayAt === undefined &&
        document.querySelector('[role="status"].fixed')
      ) {
        window.__overlayAt = performance.now();
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  });

  await card.locator(`div[title^="${TITLE}"]`).click();
  const overlay = page.locator('[role="status"].fixed');
  await expect(overlay).toBeVisible({ timeout: 2_000 });
  await page.waitForURL(/\/reader\/[^/]+$/, { timeout: 60_000 });

  const timing = await page.evaluate(() => ({
    click: window.__clickAt,
    overlay: window.__overlayAt,
  }));
  expect(timing.click).toBeDefined();
  expect(timing.overlay).toBeDefined();
  expect(timing.overlay! - timing.click!).toBeLessThan(300);

  await expect(page.locator("[data-pdf-viewer] canvas").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("/ 12", { exact: true })).toBeVisible();
  // the overlay is gone once the document is up
  await expect(overlay).toHaveCount(0);
});

test("cleanup: delete the uploaded fixture book", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: /your library/i })).toBeVisible();
  await useGridView(page);
  await deleteFixtureBooks(page);
  await expect(bookCards(page)).toHaveCount(0);
});
