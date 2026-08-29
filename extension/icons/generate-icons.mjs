// Rasterizes public/logo.svg (the real app mark, incl. its Figma conic
// gradient via foreignObject) into the 16/48/128 px extension icons using
// the Chromium that Playwright already ships with the repo. Replaces the
// old dependency-free "blocky P" approximation, which looked broken in
// the toolbar. Run from the repo root: node extension/icons/generate-icons.mjs

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
const svg = readFileSync("public/logo.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const size of [16, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  // slight padding so the mark isn't clipped by rounded toolbar tiles
  const pad = Math.round(size * 0.06);
  await page.setContent(`<html><body style="margin:0;background:transparent"><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center"><div style="width:${size - 2 * pad}px;height:${size - 2 * pad}px">${svg.replace(/<svg /, '<svg style="width:100%;height:100%" ')}</div></div></body></html>`);
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  writeFileSync(`extension/icons/icon${size}.png`, buf);
  console.log("wrote", size);
}
await browser.close();
