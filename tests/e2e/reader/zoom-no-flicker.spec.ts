import { test, expect, type Page } from "@playwright/test";
import { geometry, gotoPage, openLocalPdf, visiblePages, VIEWER } from "./helpers";

// Guards: ctrl+wheel zoom deep in a long document. Historic bugs: the
// virtualization window collapsing mid-gesture (all canvases unmounted,
// white flash) and the zoom pivot drifting so the page under the cursor
// changed. A 50 ms in-page sampler records the mounted-in-viewport canvas
// count and the page under the cursor for the whole gesture.

declare global {
  interface Window {
    __zoomSamples?: { t: number; canvases: number; pageAt: number }[];
    __stopZoomSampler?: () => void;
  }
}

async function startSampler(page: Page, cursorY: number) {
  await page.evaluate((cursorY) => {
    const el = document.querySelector<HTMLElement>("[data-pdf-viewer]")!;
    window.__zoomSamples = [];
    const t0 = performance.now();
    const iv = setInterval(() => {
      const cr = el.getBoundingClientRect();
      let canvases = 0;
      for (const c of el.querySelectorAll("canvas")) {
        const r = c.getBoundingClientRect();
        if (r.width > 0 && r.bottom > cr.top && r.top < cr.bottom) canvases++;
      }
      let pageAt = 0;
      let best = Infinity;
      for (const p of el.querySelectorAll<HTMLElement>(".react-pdf__Page")) {
        const r = p.getBoundingClientRect();
        const d = cursorY < r.top ? r.top - cursorY : cursorY > r.bottom ? cursorY - r.bottom : 0;
        if (d < best) {
          best = d;
          pageAt = Number(p.dataset.pageNumber);
        }
      }
      window.__zoomSamples!.push({ t: performance.now() - t0, canvases, pageAt });
    }, 50);
    window.__stopZoomSampler = () => clearInterval(iv);
  }, cursorY);
}

async function stopSampler(page: Page) {
  return page.evaluate(() => {
    window.__stopZoomSampler?.();
    return window.__zoomSamples ?? [];
  });
}

function assertSamples(
  samples: { t: number; canvases: number; pageAt: number }[],
  anchorPage: number,
) {
  expect(samples.length).toBeGreaterThan(10);
  const blank = samples.filter((s) => s.canvases === 0);
  expect(
    blank,
    `viewport had no mounted canvas at t=${blank.map((s) => Math.round(s.t)).join(",")}ms`,
  ).toHaveLength(0);
  const drifted = samples.filter((s) => Math.abs(s.pageAt - anchorPage) > 1);
  expect(
    drifted,
    `page under cursor drifted from ${anchorPage}: ${drifted
      .map((s) => `${Math.round(s.t)}ms->p${s.pageAt}`)
      .join(", ")}`,
  ).toHaveLength(0);
}

async function trayScale(page: Page): Promise<number> {
  return page
    .locator(`${VIEWER} div[style*="transform-origin"]`)
    .first()
    .evaluate((el) => {
      const m = /scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform);
      return m ? Number(m[1]) : 1;
    });
}

test("ctrl+wheel zoom keeps pages mounted and the cursor page stable", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 80);

  const g = await geometry(page);
  const cx = g.left + (g.right - g.left) / 2;
  const cy = g.top + g.clientHeight / 2;
  await page.mouse.move(cx, cy);
  const { pageAt: anchorPage } = await visiblePages(page, cy);
  expect(anchorPage).toBeGreaterThanOrEqual(79);

  const scale0 = await trayScale(page);
  await startSampler(page, cy);

  await page.keyboard.down("Control");
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const scaleIn = await trayScale(page);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 100);
    await page.waitForTimeout(120);
  }
  await page.keyboard.up("Control");
  await page.waitForTimeout(500);

  const samples = await stopSampler(page);
  const scaleOut = await trayScale(page);

  expect(scaleIn).toBeGreaterThan(scale0 * 1.05);
  expect(scaleOut).toBeLessThan(scaleIn);
  assertSamples(samples, anchorPage);

  // and after the gesture settles the same page is still under the cursor
  await page.waitForTimeout(600);
  const after = await visiblePages(page, cy);
  expect(after.canvasesInView).toBeGreaterThan(0);
  expect(Math.abs(after.pageAt - anchorPage)).toBeLessThanOrEqual(1);
});

test("zoom presets (fit width, fit page, 150%) re-layout without blanking", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 80);
  const g = await geometry(page);
  const cy = g.top + g.clientHeight / 2;
  const { pageAt: anchorPage } = await visiblePages(page, cy);

  const pick = async (label: string) => {
    await page.getByTitle("Zoom presets").click();
    await page.getByRole("button", { name: label, exact: true }).click();
  };

  await startSampler(page, cy);

  await pick("Page Fit");
  await page.waitForTimeout(700);
  // fit-page: the page under the cursor must fit inside the viewer height
  const fitPageH = await page
    .locator(`${VIEWER} .react-pdf__Page[data-page-number="${anchorPage}"]`)
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(fitPageH).toBeLessThanOrEqual(g.clientHeight + 2);

  await pick("150%");
  await page.waitForTimeout(700);
  expect(await trayScale(page)).toBeCloseTo(1.5, 2);
  await expect(page.getByTitle("Zoom presets").locator("..")).toContainText("150%");

  await pick("Page Width");
  await page.waitForTimeout(700);
  const widthW = await page
    .locator(`${VIEWER} .react-pdf__Page[data-page-number="${anchorPage}"]`)
    .evaluate((el) => el.getBoundingClientRect().width);
  // fit-width fills the viewer (minus scrollbar) within a small margin
  expect(widthW).toBeGreaterThan(g.clientWidth * 0.9);

  const samples = await stopSampler(page);
  assertSamples(samples, anchorPage);
});
