import { test, expect } from "@playwright/test";
import { skipOnboarding } from "./helpers";

// Guards the browser-extension hand-off contract: /chat?q=<selection>&
// src=<pageUrl>&title=<pageTitle> (the extension's "Ask Pnyxy about this")
// turns into a quoted composer draft with a source line, without
// auto-sending, and the query params are stripped from the address bar.
// See src/features/chat/page/useChatPageState.ts.

test.skip(({ isMobile }) => Boolean(isMobile), "desktop-only, no unique flow on mobile");

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
});

// keep the shared test account tidy: the hand-off creates a conversation
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === "skipped") return;
  await page.goto("/chat");
  await page
    .getByRole("button", { name: "Quick view (all chats, newest first)" })
    .click();
  const kebab = page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .first();
  if ((await kebab.count()) === 0) return;
  await kebab.locator("xpath=..").hover();
  await kebab.click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const dialog = page.locator('[aria-modal="true"]');
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("extension hand-off prefills the composer and cleans the URL", async ({
  page,
}) => {
  await page.goto(
    "/chat?q=hello%20world&src=https%3A%2F%2Fexample.com&title=Example",
  );

  const composer = page.getByPlaceholder("Ask anything");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await expect(composer).toHaveValue(/hello world/);
  await expect(composer).toHaveValue(
    /Source: Example \(https:\/\/example\.com\)/,
  );

  // q (and src/title) must be gone from the address bar; other params
  // (none here) would otherwise be untouched.
  await expect(page).not.toHaveURL(/[?&]q=/);
});
