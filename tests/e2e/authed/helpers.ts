import { expect, type Page } from "@playwright/test";

// Shared setup for signed-in specs.

const SETTINGS_KEY = "pnyxy-reader:settings";
// Keep in sync with the `version` of the zustand persist config in
// src/stores/settings-store.ts, otherwise the store runs its migrations
// over the injected blob.
const SETTINGS_VERSION = 13;

/**
 * Mark the first-run onboarding tour as completed before any script runs,
 * so the centered tour modal never covers the UI under test. Patches the
 * persisted settings blob in localStorage (creating a minimal one when the
 * setup project's storageState did not capture it).
 */
export async function skipOnboarding(page: Page) {
  await page.addInitScript(
    ({ key, version }) => {
      try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : { state: {}, version };
        parsed.state = { ...(parsed.state ?? {}), onboardingCompleted: true };
        if (typeof parsed.version !== "number") parsed.version = version;
        localStorage.setItem(key, JSON.stringify(parsed));
      } catch {
        /* localStorage unavailable, the test will surface the modal */
      }
    },
    { key: SETTINGS_KEY, version: SETTINGS_VERSION },
  );
}

/**
 * Uploads and other org-scoped writes fail with "No active organization"
 * until the org list has loaded after sign-in (auth-store -> fetchMine).
 * The sidebar OrgSwitcher renders nothing until then, so its trigger
 * (aria-haspopup="listbox") is the signal that the active org exists.
 */
export async function waitForActiveOrg(page: Page) {
  await expect(
    page.locator('button[aria-haspopup="listbox"]').first(),
    "active organization never resolved (OrgSwitcher not rendered)",
  ).toBeAttached({ timeout: 20_000 });
}
