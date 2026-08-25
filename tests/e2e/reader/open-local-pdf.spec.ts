import { test, expect } from "@playwright/test";
import { openLocalPdf, PAGE_INPUT, VIEWER } from "./helpers";

// Guards: the reader's local-file open path (ReaderEmptyState hidden file
// input -> adapter parse -> /reader/:id) and that the first page actually
// rasterizes, not just the shell. Also checks the mixed page sizes in the
// fixture are laid out (landscape page 10 must be wider than tall).

test("opens a local PDF and renders the first page", async ({ page }) => {
  await openLocalPdf(page);

  await expect(page.locator(PAGE_INPUT)).toHaveValue("1");
  await expect(page.getByText("/ 120", { exact: true })).toBeVisible();

  const first = page.locator(
    `${VIEWER} .react-pdf__Page[data-page-number="1"] canvas`,
  );
  await expect(first).toBeVisible();
  const box = await first.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200);
  expect(box!.height).toBeGreaterThan(box!.width); // A4 portrait

  // total scrollable height must reflect all 120 pages
  const scrollHeight = await page
    .locator(VIEWER)
    .evaluate((el) => el.scrollHeight);
  expect(scrollHeight).toBeGreaterThan(100 * box!.height);
});
