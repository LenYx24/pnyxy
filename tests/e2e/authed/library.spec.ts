import { test, expect } from "@playwright/test";

// Authed smoke. Signed-in via the shared storageState produced by
// tests/e2e/auth.setup.ts. Kept minimal until we have a story for
// deterministic seed data, without seeded folders / books the
// library renders an empty state that's stable to assert on, but
// not very useful for screenshot regression.

test("library page renders the header for a signed-in user", async ({
  page,
}) => {
  await page.goto("/library");
  // The library header text "Your library" / "Your Library" lives
  // under the `library.yourLibrary` i18n key; assert on the role +
  // a startsWith so a copy tweak doesn't fail this.
  const heading = page.getByRole("heading", {
    name: /your library/i,
  });
  await expect(heading).toBeVisible();
});

test("library toolbar chevron toggles the filter panel", async ({ page }) => {
  await page.goto("/library");
  const toggle = page.getByRole("button", { name: /toggle|view options/i });
  await expect(toggle).toBeVisible();
  // We're not asserting on a specific collapsed/expanded state since
  // the default depends on viewport (mobile collapsed, desktop
  // expanded) and the user's persisted pick. Just confirm the
  // toggle exists and is interactive.
  await toggle.click();
  await toggle.click();
});
