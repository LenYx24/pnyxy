import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One-time sign-in for the authed projects. Saves the resulting
// browser storage (Supabase session in localStorage) to a file the
// authed projects load into a fresh context, so individual signed-in
// tests don't pay the sign-in cost themselves.
//
// Credentials come from .env.test (gitignored). When that file is
// absent the setup test is skipped — playwright.config.ts also gates
// the authed projects on the same env vars, so the suite degrades
// gracefully to just the public smoke tests.

const STORAGE_STATE = "playwright/.auth/user.json";

setup("sign in test user and persist session", async ({ page }) => {
  const email = process.env.TEST_USER_EMAIL;
  const password = process.env.TEST_USER_PASSWORD;

  setup.skip(
    !email || !password,
    "TEST_USER_EMAIL / TEST_USER_PASSWORD not set in .env.test",
  );

  // Ensure the destination directory exists — Playwright won't create
  // nested directories for storageState writes.
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });

  await page.goto("/auth");

  // The Sign in tab is the default; fill the two visible inputs.
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[type="password"]').fill(password!);

  // The button text is i18n'd ("Sign in" / "Bejelentkezés"), but the
  // submit button is the only form submit on this page; targeting by
  // role + type-attr is more stable than matching the label.
  await page
    .locator('form button[type="submit"]')
    .click();

  // Successful sign-in routes through /auth/welcome before landing
  // elsewhere; either is fine, but waiting for the URL to change off
  // /auth proves the session was accepted. If credentials are wrong
  // we stay on /auth with an error banner — the timeout below catches
  // that case and surfaces it as a setup failure.
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/forgot") && !url.pathname.startsWith("/auth/reset") && url.pathname !== "/auth", {
    timeout: 15_000,
  });

  // Belt-and-suspenders: confirm the auth-store decided we're signed
  // in by checking localStorage for the Supabase session token. If
  // the page navigated away but the session wasn't actually stored
  // (e.g. a race in the auth flow), the storageState we write would
  // be useless.
  const hasSession = await page.evaluate(() => {
    return Object.keys(localStorage).some((k) =>
      k.startsWith("sb-") && k.endsWith("-auth-token"),
    );
  });
  expect(hasSession, "Supabase session not present in localStorage").toBe(true);

  await page.context().storageState({ path: STORAGE_STATE });
});
