import { test, expect } from "@playwright/test";

// Unauthenticated auth-surface smoke. Complements auth.setup.ts (which
// only exercises the happy-path sign-in) by covering the flows a first
// user actually hits on day one: switching to the sign-up tab, the
// sign-up consent gate, a rejected sign-in, the forgot-password
// round-trip, and the reset-password page opened without a token.
//
// These run in both the chromium-desktop and chromium-mobile projects
// (they live outside /authed/ and /reader/), so they double as the
// "does the auth screen work on a phone viewport" check.
//
// Text assertions use bilingual regexes because the app auto-detects
// EN/HU from the browser and we don't pin a locale in the config.
// Structural hooks (input ids, form submit, danger/success classes)
// are preferred where they exist so a copy tweak never fails a test.

const uniqueEmail = () => `e2e-nobody-${Date.now().toString(36)}@example.com`;

const CREATE_TAB = /create account|fiók létrehoz/i;
const SIGNIN_TAB = /^sign in$|bejelentkez/i;
const FORGOT_LINK = /forgot password|elfelejtett/i;

test.describe("auth surface (unauthenticated)", () => {
  test("sign-in ↔ create-account toggle reveals the right fields", async ({
    page,
  }) => {
    await page.goto("/auth");

    // Default is the sign-in tab: no display-name field, and the
    // "Forgot password?" link is offered.
    await expect(page.locator("#display-name")).toHaveCount(0);
    await expect(page.getByRole("link", { name: FORGOT_LINK })).toBeVisible();

    // Switch to create-account: display-name + consent checkbox appear,
    // the forgot-password link is gone. .first() picks the tab button
    // over the submit button, which shares the same label.
    await page.getByRole("button", { name: CREATE_TAB }).first().click();
    await expect(page.locator("#display-name")).toBeVisible();
    await expect(page.getByRole("link", { name: FORGOT_LINK })).toHaveCount(0);

    // Switch back: the sign-up-only fields disappear again.
    await page.getByRole("button", { name: SIGNIN_TAB }).first().click();
    await expect(page.locator("#display-name")).toHaveCount(0);
  });

  test("signing up without consent is blocked and creates no account", async ({
    page,
  }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: CREATE_TAB }).first().click();
    await page.locator("#email").fill(uniqueEmail());
    await page.locator("#password").fill("test-password-123");

    // Submit with the consent box unchecked: handleSubmit returns before
    // calling signUp, so an inline error shows and we stay on /auth (no
    // network account is created).
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator(".text-danger").first()).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("signing in with wrong credentials surfaces an error", async ({
    page,
  }) => {
    await page.goto("/auth");
    await page.locator("#email").fill(uniqueEmail());
    await page.locator("#password").fill("definitely-the-wrong-password");
    await page.locator('form button[type="submit"]').click();

    // Real round-trip to Supabase: bad credentials are always rejected,
    // so the error banner must appear and we must not leave /auth.
    await expect(page.locator(".text-danger").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("forgot-password flow reaches a resolved state", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("link", { name: FORGOT_LINK }).click();
    await expect(page).toHaveURL(/\/auth\/forgot-password/);

    await page.locator("#email").fill(uniqueEmail());
    await page.locator('form button[type="submit"]').click();

    // The request completes and the UI responds. We assert "success OR a
    // handled error" rather than only success: whether an email is queued
    // depends on Supabase's per-hour email limits, but either outcome
    // proves the reset request round-tripped and the form didn't hang.
    await expect(
      page.locator(".text-success, .text-danger").first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("reset-password without a token renders the invalid-link state", async ({
    page,
  }) => {
    const pageErrors: Error[] = [];
    page.on("pageerror", (e) => pageErrors.push(e));

    await page.goto("/auth/reset-password");

    // With no recovery token in the URL, the page waits ~500ms for a
    // session, finds none, and shows the "request a new link" fallback
    // instead of the password form. It must render, not crash.
    await expect(
      page.getByRole("button", { name: /request|kérj|új link/i }),
    ).toBeVisible({ timeout: 5_000 });
    expect(pageErrors, "reset-password threw an unhandled error").toHaveLength(
      0,
    );
  });

  // Full sign-up creates a real auth.users row (and, with email
  // confirmation off for the pilot, an immediate session), which would
  // accumulate throwaway accounts on every run. Kept opt-in: run with
  //   E2E_SIGNUP=1 pnpm exec playwright test tests/e2e/auth-flows.spec.ts
  // to verify the end-to-end happy path when you actually want to.
  test("full sign-up creates a session (opt-in)", async ({ page }) => {
    test.skip(
      process.env.E2E_SIGNUP !== "1",
      "set E2E_SIGNUP=1 to run the account-creating happy path",
    );

    await page.goto("/auth");
    await page.getByRole("button", { name: CREATE_TAB }).first().click();
    await page.locator("#display-name").fill("E2E Signup");
    await page.locator("#email").fill(`e2e-signup-${Date.now()}@example.com`);
    await page.locator("#password").fill("test-password-123");
    // Tick the required pilot-consent checkbox (first checkbox on the tab).
    await page.getByRole("checkbox").first().click();
    await page.locator('form button[type="submit"]').click();

    // With confirmation off we land in-app; with it on, the "check your
    // email" panel shows. Either is a pass for the form itself.
    await expect
      .poll(async () => {
        if (/\/auth\/welcome|\/library/.test(page.url())) return "in-app";
        if (await page.locator(".text-success").count()) return "confirm";
        return "pending";
      }, { timeout: 15_000 })
      .not.toBe("pending");
  });
});
