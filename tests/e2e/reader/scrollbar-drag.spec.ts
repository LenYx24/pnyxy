import { test, expect } from "@playwright/test";
import {
  geometry,
  gotoPage,
  openLocalPdf,
  scrollTop,
  waitForScrollSettled,
} from "./helpers";

// Guards: dragging the native scrollbar thumb through a virtualized
// 120-page document. Historic bugs: (1) pageOffsets shifting under the
// drag when a measured page height replaced an estimate, which made the
// thumb jump backwards; (2) the resume re-snap writing an old scrollTop
// a second or two after the user let go of the thumb.
//
// Playwright's headless Chromium launches with --hide-scrollbars, so this
// file opts out of that flag to get the real 15px classic scrollbar.

test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("scrollbar thumb drag tracks the mouse and holds after release", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 40);

  const g = await geometry(page);
  expect(
    g.offsetWidth - g.clientWidth,
    "expected a classic (non-overlay) vertical scrollbar",
  ).toBeGreaterThanOrEqual(8);

  // Thumb centre estimate. Chrome's thumb length is clientHeight^2 /
  // scrollHeight, clamped to a minimum; assuming ~20px puts the estimate
  // within a few px of the real centre at any track position.
  const assumedThumb = 20;
  const frac = g.scrollTop / (g.scrollHeight - g.clientHeight);
  const x = g.right - 6;
  const y0 = g.top + assumedThumb / 2 + frac * (g.clientHeight - assumedThumb);

  const startTop = g.scrollTop;
  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.waitForTimeout(50);

  const pxPerScreenPx = (g.scrollHeight - g.clientHeight) / (g.clientHeight - assumedThumb);
  const samples: number[] = [startTop];
  const STEP = 6;
  const STEPS = 20; // 120 px of thumb travel, roughly 20 pages
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(x, y0 + i * STEP);
    await page.waitForTimeout(40);
    samples.push(await scrollTop(page));
  }

  // (i) scrollTop follows the mouse: never jumps backwards by more than a
  //     page height mid-drag, and overall tracks the expected travel.
  const pageHeight = await page
    .locator(`[data-pdf-viewer] .react-pdf__Page`)
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  for (let i = 1; i < samples.length; i++) {
    expect(
      samples[i] - samples[i - 1],
      `scrollTop jumped back at step ${i}: ${samples.join(", ")}`,
    ).toBeGreaterThan(-pageHeight);
  }
  // first move must have grabbed the thumb (a track click would page by
  // clientHeight instead, and a miss would not move at all)
  expect(samples[1] - startTop).toBeGreaterThan(pxPerScreenPx * STEP * 0.4);
  expect(samples[1] - startTop).toBeLessThan(pxPerScreenPx * STEP * 2.5);
  const expectedTravel = pxPerScreenPx * STEP * STEPS;
  const travel = samples[samples.length - 1] - startTop;
  expect(travel).toBeGreaterThan(expectedTravel * 0.6);
  expect(travel).toBeLessThan(expectedTravel * 1.4);

  await page.mouse.up();

  // (ii) after release nothing else moves the scroller
  await waitForScrollSettled(page);
  const released = await scrollTop(page);
  await page.waitForTimeout(1000);
  expect(await scrollTop(page), "scrollTop moved 1s after mouseup").toBe(released);
  await page.waitForTimeout(1500);
  expect(await scrollTop(page), "scrollTop moved 2.5s after mouseup").toBe(released);
});

// Regression for the recurring "drag and it snaps back" bug. A plain
// (non-ctrl) wheel scroll animates scrollTop toward a target with an rAF
// lerp. The exit test was |dy| < 0.5, but Chrome snaps scrollTop to whole
// pixels, so any fractional target (touchpad deltas, the zoom-damping
// multiplier, the burst multiplier) left dy stuck at e.g. 0.6 and the rAF
// loop never terminated. That zombie animation then fought every later
// input: grabbing the scrollbar thumb pulled the view 25% back toward the
// old wheel target each frame, i.e. it "snapped back". The suite missed it
// because every other spec wheels with integer deltas, so the target was
// always whole and the loop always terminated.
test("thumb drag after a fractional-delta wheel burst holds (no snap-back to the wheel target)", async ({
  page,
}) => {
  await openLocalPdf(page);
  await gotoPage(page, 40);

  const g0 = await geometry(page);
  expect(
    g0.offsetWidth - g0.clientWidth,
    "expected a classic (non-overlay) vertical scrollbar",
  ).toBeGreaterThanOrEqual(8);

  // Wheel down a few times with a fractional delta so the smooth-scroll
  // target lands on a fractional pixel (the condition that pinned the lerp).
  await page.mouse.move(
    g0.left + g0.clientWidth / 2,
    g0.top + g0.clientHeight / 2,
  );
  for (let i = 0; i < 3; i++) {
    await page.mouse.wheel(0, 250.7);
    await page.waitForTimeout(30);
  }
  // On the fixed code the lerp terminates within a few frames; on the broken
  // code the rAF loop is still running (scrollTop is stable at the target,
  // but the animation is live and will fight the drag below).
  await page.waitForTimeout(400);
  await waitForScrollSettled(page);
  const postWheelTop = await scrollTop(page);

  // Grab the thumb at its current position and drag DOWN, past the target.
  const g = await geometry(page);
  const assumedThumb = 20;
  const x = g.right - 6;
  const frac = g.scrollTop / (g.scrollHeight - g.clientHeight);
  const y0 = g.top + assumedThumb / 2 + frac * (g.clientHeight - assumedThumb);
  const pxPerScreenPx =
    (g.scrollHeight - g.clientHeight) / (g.clientHeight - assumedThumb);

  const pageHeight = await page
    .locator(`[data-pdf-viewer] .react-pdf__Page`)
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);

  await page.mouse.move(x, y0);
  await page.mouse.down();
  await page.waitForTimeout(50);

  const samples: number[] = [g.scrollTop];
  const STEP = 6;
  const STEPS = 18;
  for (let i = 1; i <= STEPS; i++) {
    await page.mouse.move(x, y0 + i * STEP);
    await page.waitForTimeout(40);
    samples.push(await scrollTop(page));
  }
  // (i) the drag never lurches backwards mid-move (the zombie lerp did).
  for (let i = 1; i < samples.length; i++) {
    expect(
      samples[i] - samples[i - 1],
      `scrollTop jumped back at step ${i}: ${samples.join(", ")}`,
    ).toBeGreaterThan(-pageHeight);
  }
  // (ii) the drag actually moved us well below the wheel target.
  const dragged = samples[samples.length - 1];
  expect(dragged - postWheelTop).toBeGreaterThan(
    pxPerScreenPx * STEP * STEPS * 0.5,
  );

  await page.mouse.up();

  // (iii) after release nothing pulls the view back toward the old wheel
  // target: scrollTop holds, and stays below where the drag left it.
  await waitForScrollSettled(page);
  const released = await scrollTop(page);
  await page.waitForTimeout(1200);
  expect(
    await scrollTop(page),
    "scrollTop drifted 1.2s after mouseup (zombie wheel lerp still running)",
  ).toBe(released);
  await page.waitForTimeout(1300);
  expect(
    await scrollTop(page),
    "scrollTop drifted 2.5s after mouseup (zombie wheel lerp still running)",
  ).toBe(released);
});
