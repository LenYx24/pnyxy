import { defineConfig, devices } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env.test (gitignored) before defining the config so authed
// projects can see TEST_USER_*. Public/unauthenticated tests don't
// need any env at all. We deliberately keep this inline rather than
// pulling in `dotenv` — it's six lines and there's no value lost.
const __dirname = dirname(fileURLToPath(import.meta.url));
const envFile = resolve(__dirname, ".env.test");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf-8").split("\n")) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"](.*)['"]$/, "$1");
    }
  }
}

const HAS_TEST_CREDS = Boolean(
  process.env.TEST_USER_EMAIL && process.env.TEST_USER_PASSWORD,
);

// Where the signed-in storageState lands. Gitignored. Setup project
// writes it once at the start of each run; authed projects load it
// to skip going through the sign-in form for every test.
const STORAGE_STATE = "playwright/.auth/user.json";

// Playwright config for the e2e smoke suite.
//
// Project layout:
//   - setup            → signs in once, writes STORAGE_STATE (skipped
//                        when TEST_USER_* env vars are missing)
//   - chromium-desktop → public/unauthed tests, Desktop Chrome viewport
//   - chromium-mobile  → same, Pixel 7 viewport
//   - …-authed         → same viewports but load STORAGE_STATE and only
//                        run files under tests/e2e/authed/

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
    // Sub-pixel font rendering can flip a handful of pixels between
    // runs even when nothing changed; the threshold absorbs that
    // noise while still flagging real visual regressions.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts$/,
    },
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
      // Authed specs live under /authed/ and are only run by the
      // -authed projects below, so exclude them here.
      testIgnore: /\/authed\//,
    },
    {
      name: "chromium-mobile",
      use: { ...devices["Pixel 7"] },
      testIgnore: /\/authed\//,
    },
    ...(HAS_TEST_CREDS
      ? [
          {
            name: "chromium-desktop-authed",
            use: {
              ...devices["Desktop Chrome"],
              storageState: STORAGE_STATE,
            },
            testMatch: /\/authed\/.*\.spec\.ts$/,
            dependencies: ["setup"],
          },
          {
            name: "chromium-mobile-authed",
            use: {
              ...devices["Pixel 7"],
              storageState: STORAGE_STATE,
            },
            testMatch: /\/authed\/.*\.spec\.ts$/,
            dependencies: ["setup"],
          },
        ]
      : []),
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
