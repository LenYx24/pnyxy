import { test, expect } from "@playwright/test";
import {
  openLocalPdf,
  PAGE_INPUT,
  VIEWER,
  waitForScrollSettled,
} from "./helpers";

// Guards: a fast scroll through the document must not send every page it
// sweeps past to the pdf.js worker. The worker can't abort a page once
// queued, so on a 1000+ page book ~300 swept pages piled up ~30 s of work
// in front of the page the user stopped on. Only pages admitted by the
// render queue get a .react-pdf__Page element, so their count is the
// number of pages that reached the worker.

test("fast scroll only renders the pages it settles on", async ({ page }) => {
  await openLocalPdf(page);
  await page.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { __seen: Set<string> }).__seen = seen;
    new MutationObserver(() => {
      for (const p of document.querySelectorAll(".react-pdf__Page")) {
        seen.add((p as HTMLElement).dataset.pageNumber ?? "");
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.locator(VIEWER).evaluate(
    (el) =>
      new Promise<void>((done) => {
        const to = (el.scrollHeight - el.clientHeight) * 0.9;
        const start = performance.now();
        const step = () => {
          const k = Math.min(1, (performance.now() - start) / 800);
          el.scrollTop = to * k;
          if (k < 1) setTimeout(step, 16);
          else done();
        };
        step();
      }),
  );

  await waitForScrollSettled(page);
  const target = await page.locator(PAGE_INPUT).inputValue();
  const canvas = page.locator(
    `${VIEWER} .react-pdf__Page[data-page-number="${target}"] canvas`,
  );
  await expect(canvas).toBeVisible({ timeout: 5_000 });

  const rendered = await page.evaluate(
    () => (window as unknown as { __seen: Set<string> }).__seen.size,
  );
  // the settled window is a handful of pages; the sweep crossed ~100
  expect(rendered).toBeLessThan(20);
});
