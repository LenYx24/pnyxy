import { test, expect } from "@playwright/test";

// Smoke suite: cheap "did anything break at the bundle/route/layout
// level" coverage. Deliberately avoids signed-in flows, those need
// Supabase fixtures we don't have yet, and the unauthenticated
// surface already catches the regressions we hit most often (broken
// build, missing route, horizontal overflow on mobile, etc.).

test.describe("public pages render", () => {
  test("landing page loads and shows hero content", async ({ page }) => {
    await page.goto("/landing");
    // Landing should render *some* h1, the actual copy may change,
    // but the page should never be blank. visible: true filters out
    // off-screen / hidden headings.
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("auth page has email and password inputs", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("settings → appearance loads with custom CSS textarea", async ({
    page,
  }) => {
    await page.goto("/settings/appearance");
    // The textarea is what we just added; if the bundle for the
    // appearance tab broke we'd never see it.
    const textarea = page.locator("textarea").first();
    await expect(textarea).toBeVisible();
    // Sanity-check the live-apply path: typing should update both
    // the textarea value and the injected <style> tag.
    await textarea.fill(":root { --probe: 1; }");
    const styleContent = await page
      .locator("style#user-custom-css")
      .innerText();
    expect(styleContent).toContain("--probe");
    // Clean up so subsequent tests aren't polluted by our injection.
    await textarea.fill("");
  });
});

test.describe("visual regression", () => {
  // Baselines live next to the spec as
  //   smoke.spec.ts-snapshots/<name>-<project>-<platform>.png
  // and are platform-specific. Regenerate with
  //   pnpm test:e2e:update
  // after intentional UI changes. The `maxDiffPixelRatio` in the
  // shared expect config absorbs anti-aliasing jitter.

  test("auth card baseline", async ({ page }) => {
    await page.goto("/auth");
    // Screenshot the auth card itself, not the page, the
    // MeshBackground is canvas-generated decoration that won't be
    // pixel-stable across runs. The card is the user-facing
    // surface we actually care about regressing.
    const card = page.locator("form").locator("..");
    await expect(card).toHaveScreenshot("auth-card.png");
  });

  test("appearance tab baseline", async ({ page }) => {
    await page.goto("/settings/appearance");
    // Wait for the lazy chunk to settle, themes list renders
    // asynchronously and a screenshot snapped mid-render would
    // pin an incomplete baseline.
    await expect(page.locator("textarea").first()).toBeVisible();
    const section = page.locator("section").first();
    await expect(section).toHaveScreenshot("appearance-tab.png");
  });
});

test.describe("layout sanity", () => {
  test("mobile landing has no horizontal overflow", async ({ page }) => {
    // The mobile project sets the viewport to Pixel 7 (412×915).
    // A regression that introduces a `min-w-[420px]` somewhere would
    // bump scrollWidth past innerWidth, that's exactly the kind of
    // bug screenshots-on-a-laptop miss.
    await page.goto("/landing");
    const { scrollWidth, innerWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    // 1px tolerance for sub-pixel rounding on some renderers.
    expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 1);
  });

  test("library route boots without throwing", async ({ page }) => {
    // We don't assert on signed-in content (no fixtures yet), but we
    // do assert the route resolves, i.e. either the library renders
    // or the app gracefully redirects to /auth. A runtime error in
    // the lazy chunk would surface as a blank screen with the route
    // error boundary; we'd fail to find any h1/h2 on the page.
    const pageErrors: Error[] = [];
    page.on("pageerror", (e) => pageErrors.push(e));
    await page.goto("/library");
    await expect(page.locator("h1, h2").first()).toBeVisible();
    expect(pageErrors, "page threw unhandled error").toHaveLength(0);
  });
});
