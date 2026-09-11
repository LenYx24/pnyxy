// Dev "grid" launcher: opens several isolated browser windows against the
// local dev server at once, so you can test multiple accounts + viewports
// without logging in and out. Each window is its own browser context (its
// own localStorage), so their Supabase sessions never collide.
//
// Prereq: the dev server is already running (`pnpm dev` at :5173).
// Run:     node scripts/dev-grid.mjs   (or `pnpm dev:grid`)
// Stop:    Ctrl+C (closes every window).
//
// Credentials come from .env.test / .env.test.local (gitignored), the same
// files the e2e suite uses. Set a second account's TEST_USER2_EMAIL /
// TEST_USER2_PASSWORD there to get a distinct logged-in window; the guest
// window needs nothing. Windows with missing creds are still opened, just
// signed out (with a note in the console).
import { chromium, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const BASE_URL = process.env.DEV_GRID_URL ?? "http://localhost:5173";

// Load TEST_USER* from the gitignored env files (six-line loader, matching
// playwright.config.ts so there's no extra dependency).
for (const name of [".env.test", ".env.test.local"]) {
  const envFile = resolve(ROOT, name);
  if (!existsSync(envFile)) continue;
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"](.*)['"]$/, "$1");
  }
}

// One entry per window. `account` picks which TEST_USER* pair to sign in
// with (null = stay a guest). `device` is a Playwright device preset for
// mobile emulation; omit for a plain desktop viewport.
const WINDOWS = [
  { label: "Account 1 - desktop", account: "TEST_USER", viewport: { width: 1366, height: 900 } },
  { label: "Account 1 - mobile", account: "TEST_USER", device: "Pixel 7" },
  { label: "Account 2 - desktop", account: "TEST_USER2", viewport: { width: 1366, height: 900 } },
  { label: "Guest - desktop", account: null, viewport: { width: 1280, height: 800 } },
];

function creds(prefix) {
  const email = process.env[`${prefix}_EMAIL`];
  const password = process.env[`${prefix}_PASSWORD`];
  return email && password ? { email, password } : null;
}

async function signIn(page, { email, password }) {
  await page.goto(`${BASE_URL}/auth`);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL((url) => url.pathname !== "/auth" && !url.pathname.startsWith("/auth/"), {
    timeout: 15_000,
  });
}

const browser = await chromium.launch({ headless: false });
console.log(`\nDev grid -> ${BASE_URL}\n`);

for (const win of WINDOWS) {
  const contextOpts = win.device ? { ...devices[win.device] } : { viewport: win.viewport };
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const account = win.account ? creds(win.account) : null;

  try {
    if (win.account && !account) {
      console.log(`  [${win.label}] no ${win.account}_EMAIL/PASSWORD set -> opening as guest`);
      await page.goto(BASE_URL);
    } else if (account) {
      await signIn(page, account);
      await page.goto(BASE_URL);
      console.log(`  [${win.label}] signed in as ${account.email}`);
    } else {
      await page.goto(BASE_URL);
      console.log(`  [${win.label}] guest`);
    }
  } catch (err) {
    console.log(`  [${win.label}] setup failed: ${err.message}`);
  }
}

console.log("\nAll windows open. Press Ctrl+C to close them.\n");

// Keep the process (and the windows) alive until interrupted.
const shutdown = async () => {
  await browser.close().catch(() => {});
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await new Promise(() => {});
