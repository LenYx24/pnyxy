import { test, expect, type Locator, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { skipOnboarding, waitForActiveOrg } from "./helpers";

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

test("filter row is visible with type and tag chips", async ({ page }) => {
  // The welcome tour dialog would otherwise sit over the toolbar;
  // open-book.spec skips it the same way.
  await skipOnboarding(page);
  await page.goto("/library");
  // One always-visible filter row under the header: the type chips
  // (aria-pressed) first, then the tag chips. "Books" is a type chip
  // that exists regardless of feature flags; "All" is the first tag chip.
  const typeChip = page.locator('button[data-filter="type"]', {
    hasText: /^books$/i,
  });
  await expect(typeChip).toBeVisible();
  const allTagChip = page.locator('button[data-filter="tag"]', {
    hasText: /^all$/i,
  });
  await expect(allTagChip).toBeVisible();
  await expect(allTagChip).toHaveAttribute("aria-pressed", "true");
});

// Drag & drop intent: nest a book into a folder by dropping on the
// folder row's middle, then pull it back out with the "Up to: ..."
// placeholder that appears above the list while dragging inside a
// folder. Drives dnd-kit's MouseSensor with raw mouse events (8 px
// activation distance, then stepped moves so onDragMove fires).
test.describe("drag & drop nest / un-nest", () => {
  test.skip(({ isMobile }) => Boolean(isMobile), "desktop-only pointer drag");

  const FIXTURE = resolve(process.cwd(), "tests/fixtures/short-12.pdf");
  const TITLE = "short-12";
  const FOLDER = `dnd-e2e-${Date.now().toString(36)}`;

  const row = (page: Page, text: string) =>
    page.locator("[data-list-row]", { hasText: text });

  /** Press on `from`, then move in steps to `to` (a point resolver run
   *  after the drag has started, so drag-only targets can be located). */
  async function dragTo(
    page: Page,
    from: Locator,
    to: () => Promise<{ x: number; y: number }>,
  ) {
    const box = (await from.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 12, { steps: 4 });
    const target = await to();
    await page.mouse.move(target.x, target.y, { steps: 12 });
    // one more nudge so the last onDragMove sees the final pointer
    await page.mouse.move(target.x, target.y + 1, { steps: 2 });
  }

  async function openRowMenuAndDelete(page: Page, target: Locator) {
    await target.hover();
    await target.locator("button").last().click();
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    const dialog = page.locator("div", {
      has: page.getByRole("heading", { name: /^Delete\b/ }),
    });
    await dialog.getByRole("button", { name: "Delete", exact: true }).last().click();
  }

  /** Root-level cleanup: stale dnd-e2e-* folders (deleting one moves
   *  its books back to the root), then every fixture row. Also runs
   *  after a failed attempt so open-book.spec's dedupe upload is not
   *  blocked by a leftover. */
  async function cleanupLeftovers(page: Page) {
    await page.goto("/library");
    await page.getByRole("button", { name: "List view" }).click();
    // the list root only mounts once fetchLibrary has resolved; acting
    // earlier races the in-flight response (it overwrites store writes)
    await expect(page.locator("[data-list-root]")).toBeVisible({ timeout: 20_000 });
    const stale = row(page, "dnd-e2e-");
    for (let i = 0; i < 5; i++) {
      const n = await stale.count();
      if (n === 0) break;
      await openRowMenuAndDelete(page, stale.first());
      await expect(stale).toHaveCount(n - 1, { timeout: 15_000 });
    }
    const books = row(page, TITLE);
    for (let i = 0; i < 5; i++) {
      const n = await books.count();
      if (n === 0) break;
      await openRowMenuAndDelete(page, books.first());
      await expect(books).toHaveCount(n - 1, { timeout: 15_000 });
    }
  }

  test("book row nests into a folder and comes back via the parent placeholder", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await skipOnboarding(page);
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: /your library/i })).toBeVisible();
    await waitForActiveOrg(page);
    await cleanupLeftovers(page);

    try {
      // folder via the Ctrl+Shift+F shortcut -> create modal
      await page.keyboard.press("Control+Shift+F");
      await page.getByPlaceholder(/Fantasy/).fill(FOLDER);
      await page.getByRole("button", { name: "Create Folder" }).click();
      const folderRow = row(page, FOLDER);
      await expect(folderRow).toBeVisible();
      await expect(folderRow).toContainText("0 items");

      // fixture book at the root
      await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(FIXTURE);
      const bookRow = row(page, TITLE);
      await expect(bookRow).toBeVisible({ timeout: 90_000 });

      // 1) drag the book onto the folder row's middle -> nest
      await dragTo(page, bookRow, async () => {
        const b = (await folderRow.boundingBox())!;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      await expect(folderRow.locator(".ring-inset")).toHaveCount(1);
      await page.mouse.up();
      await expect(folderRow).toContainText("1 item", { timeout: 15_000 });
      await expect(bookRow).toHaveCount(0);

      // 2) inside the folder, drag the book onto "Up to: All files" -> root
      await folderRow.click();
      await expect(bookRow).toBeVisible({ timeout: 15_000 });
      const parentZone = page.locator('[data-drop-target="parent"]');
      await expect(parentZone).toBeHidden();
      await dragTo(page, bookRow, async () => {
        await expect(parentZone).toBeVisible();
        const b = (await parentZone.boundingBox())!;
        return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
      });
      await expect(parentZone).toHaveAttribute("data-drop-over", "true");
      await page.mouse.up();
      await expect(bookRow).toHaveCount(0, { timeout: 15_000 });

      // back to the root; the click right after a drop is occasionally
      // swallowed by the drag teardown, so retry until the root shows
      await expect(async () => {
        await page.getByRole("button", { name: "All files" }).click();
        await expect(folderRow).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 20_000 });
      await expect(bookRow).toBeVisible({ timeout: 15_000 });
      await expect(folderRow).toContainText("0 items");
    } finally {
      await cleanupLeftovers(page);
    }
    await expect(row(page, FOLDER)).toHaveCount(0);
    await expect(row(page, TITLE)).toHaveCount(0);
  });
});
