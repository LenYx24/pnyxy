import { test, expect } from "@playwright/test";
import {
  gotoPage,
  openLocalPdf,
  visiblePages,
  waitForScrollSettled,
} from "./helpers";

// Guards: the resize re-anchor (usePdfScrollAnchor). Historic bug: a
// centre-based currentPage/scrollOffset re-anchor made the top-visible
// page jump on resize; the fix pins the page that was at the top of the
// panel to the top after the width/height change.

test("resizing the viewport keeps the same page at the top", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 55);
  const original = page.viewportSize()!;

  const before = await visiblePages(page);
  expect(before.topPage).toBeGreaterThanOrEqual(54);

  for (const size of [
    { width: 900, height: 600 },
    { width: 1400, height: 900 },
  ]) {
    await page.setViewportSize(size);
    // ResizeObserver -> re-anchor is async; wait for the scroller to settle
    await page.waitForTimeout(400);
    await waitForScrollSettled(page);
    const after = await visiblePages(page);
    expect(
      Math.abs(after.topPage - before.topPage),
      `top page moved from ${before.topPage} to ${after.topPage} at ${size.width}x${size.height}`,
    ).toBeLessThanOrEqual(1);
    expect(after.canvasesInView).toBeGreaterThan(0);
  }

  await page.setViewportSize(original);
  await page.waitForTimeout(400);
  await waitForScrollSettled(page);
  const restored = await visiblePages(page);
  expect(Math.abs(restored.topPage - before.topPage)).toBeLessThanOrEqual(1);
});
