import { test, expect } from "@playwright/test";
import {
  geometry,
  indicatorPage,
  openLocalPdf,
  scrollTop,
  waitForScrollSettled,
} from "./helpers";

// Guards: plain mouse-wheel scrolling (usePdfZoom owns the wheel handler
// and smooth-scrolls with rAF easing). Historic bug: the resume re-snap
// or a stale programmatic scroll write pulled the viewport back after the
// user scrolled ("snap-back"). We assert scrollTop only ever grows while
// wheeling down and stays put afterwards.

test("wheel scrolling advances pages without snapping back", async ({
  page,
}) => {
  await openLocalPdf(page);
  const g = await geometry(page);
  await page.mouse.move(g.left + (g.right - g.left) / 2, g.top + g.clientHeight / 2);

  const startPage = await indicatorPage(page);
  const samples: number[] = [await scrollTop(page)];

  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(250);
    samples.push(await scrollTop(page));
  }

  // monotonic, never going backwards between wheel detents
  for (let i = 1; i < samples.length; i++) {
    expect(
      samples[i],
      `scrollTop went backwards after detent ${i}: ${samples.join(", ")}`,
    ).toBeGreaterThanOrEqual(samples[i - 1]);
  }
  expect(samples[samples.length - 1]).toBeGreaterThan(samples[0] + 1000);

  await waitForScrollSettled(page);
  const settled = await scrollTop(page);
  await page.waitForTimeout(1200);
  expect(await scrollTop(page)).toBe(settled);

  await expect.poll(() => indicatorPage(page)).toBeGreaterThan(startPage);
});
