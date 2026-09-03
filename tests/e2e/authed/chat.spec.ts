import { test, expect, type Page } from "@playwright/test";
import { skipOnboarding } from "./helpers";
import {
  CHUNK_MS,
  FIRST_WORDS,
  LAST_WORD,
  chatTurnCalls,
  installProxyMock,
} from "./ai-proxy-mock";

// Guards: the plain /chat send -> stream -> render loop and Stop. The
// ai-chat-proxy edge function is mocked in-page, see ai-proxy-mock.ts.

/** First conversation row's kebab in the sidebar list. The row wrapper only
 *  has role=button in folder view (dnd-kit), so anchor on the kebab itself;
 *  it is width-collapsed until its row is hovered, so assert attachment,
 *  not visibility. */
function firstRowKebab(page: Page) {
  return page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .first();
}

/** Delete the newest (top) conversation row through its kebab menu + confirm. */
async function deleteTopConversation(page: Page) {
  const kebab = firstRowKebab(page);
  if ((await kebab.count()) === 0) return;
  // The sidebar list can re-render right after a turn (title autogen, stream
  // finish), detaching the just-opened menu. Retry the open + Delete click as
  // a unit, closing any stray menu first, until it sticks.
  await expect(async () => {
    await page.keyboard.press("Escape").catch(() => {});
    // hover the row (the kebab's parent) so the width-collapsed kebab expands
    await kebab.locator("xpath=..").hover();
    await kebab.click();
    await page
      .getByRole("menuitem", { name: "Delete", exact: true })
      .click({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  const dialog = page.locator('[aria-modal="true"]');
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

async function openFreshChat(page: Page) {
  // ChatPage auto-opens the most recent conversation once the list has
  // loaded, and openConversation() writes that thread's messages/leaf
  // into the store when its fetch resolves. Creating a new conversation
  // before that lands leaves the new thread with a stale leaf (the user
  // bubble goes missing, the reply lands in the wrong branch). Wait for
  // both requests before clicking "New conversation".
  const listLoaded = page.waitForResponse(
    (r) =>
      r.url().includes("/rest/v1/chat_conversations") &&
      r.request().method() === "GET",
  );
  const messagesLoaded = page
    .waitForResponse(
      (r) =>
        r.url().includes("/rest/v1/chat_messages") &&
        r.request().method() === "GET",
      { timeout: 15_000 },
    )
    .then(() => "messages" as const)
    .catch(() => "none" as const);
  await page.goto("/chat");
  await listLoaded;
  // empty account: main pane shows "No conversations yet" (the sidebar
  // adds a trailing dot); otherwise the auto-opened thread's composer
  const empty = page.getByText(/^No conversations yet\.?$/).first();
  await expect(page.getByPlaceholder("Ask anything").or(empty).first()).toBeVisible({
    timeout: 15_000,
  });
  if (!(await empty.isVisible())) await messagesLoaded;

  // always start a fresh conversation so earlier runs cannot interfere;
  // the empty state is the centered headline (the old helper line under
  // it was removed on purpose)
  await page.getByRole("button", { name: "New conversation" }).first().click();
  await expect(
    page.getByRole("heading", { name: "What are we learning today?" }),
  ).toBeVisible({ timeout: 15_000 });
  const composer = page.getByPlaceholder("Ask anything");
  await expect(composer).toBeVisible();
  return composer;
}

// Desktop-only core flow: the mobile layout moves the same actions into a
// drawer and a list layout, covered by the smoke suite instead.
test.skip(({ isMobile }) => Boolean(isMobile), "desktop-only core flow");

test.beforeEach(async ({ page }) => {
  await skipOnboarding(page);
  await installProxyMock(page);
});

// keep the shared test account tidy: drop the conversation the test made
test.afterEach(async ({ page, isMobile }, testInfo) => {
  // hooks also run for skipped tests; nothing to clean up then
  if (isMobile || testInfo.status === "skipped") return;
  await page.goto("/chat");
  // folder view no longer lists unfoldered chats, the quick view does
  await page
    .getByRole("button", { name: "Quick view (all chats, newest first)" })
    .click();
  await expect(firstRowKebab(page)).toBeAttached({ timeout: 15_000 });
  await deleteTopConversation(page);
});

test("sending a message renders the user bubble and the streamed reply", async ({
  page,
}) => {
  const composer = await openFreshChat(page);
  const userText = `e2e ping ${Date.now()}`;
  await composer.fill(userText);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  await expect(page.getByText(userText).first()).toBeVisible();
  await expect(page.getByText(new RegExp(FIRST_WORDS)).first()).toBeVisible({
    timeout: 10_000,
  });
  // whole stream drains (26 chunks * CHUNK_MS)
  await expect(page.getByText(new RegExp(LAST_WORD)).first()).toBeVisible({
    timeout: 15_000,
  });

  // exactly one real chat turn hit the proxy (helper prompts aside), with
  // the user text as the last message
  const turns = await chatTurnCalls(page);
  expect(turns).toHaveLength(1);
  const parsed = JSON.parse(turns[0].body) as {
    messages: { role: string; content: unknown }[];
  };
  const last = parsed.messages[parsed.messages.length - 1];
  expect(last.role).toBe("user");
  expect(JSON.stringify(last.content)).toContain(userText);
});

test("scrolling up mid-stream is not yanked back to the bottom", async ({
  page,
}) => {
  // Regression guard for the follow-gate bug: while a reply streams, an
  // upward scroll must stick (reading earlier text), not snap back down on
  // every token. useThreadScroll releases the follow gate on wheel-up and
  // only re-arms at the true bottom.
  const composer = await openFreshChat(page);
  // A short viewport guarantees the thread overflows (a page-height thread
  // may fit), so there is real scroll range to hold onto. Keep desktop width
  // so the layout stays the desktop one this test targets.
  await page.setViewportSize({ width: 1280, height: 300 });
  // A multi-line message so the thread is comfortably taller than 380px.
  const tall = Array.from(
    { length: 30 },
    (_, i) => `Paragraph ${i}: lorem ipsum dolor sit amet consectetur elit.`,
  ).join("\n\n");
  await composer.fill(`${tall}\n\ne2e scroll ${Date.now()}`);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  // reply is streaming (first words in, last word not yet)
  const reply = page.getByText(new RegExp(FIRST_WORDS)).first();
  await expect(reply).toBeVisible({ timeout: 10_000 });

  // The scroll container that actually holds this thread's reply (there can
  // be more than one .chat-scroll mounted).
  const scroller = page
    .locator(".chat-scroll")
    .filter({ has: page.getByText(new RegExp(FIRST_WORDS)) })
    .first();
  await expect(scroller).toBeVisible();

  // Let the send-time SMOOTH scroll-to-bottom finish before we scroll up,
  // otherwise its in-flight animation settles during the assertions and
  // pulls us back down (a race, not the follow gate).
  await page.waitForTimeout(600);

  const box = (await scroller.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -3000);

  // Distance from the bottom is the real invariant: as tokens append below,
  // scrollHeight grows, so a held position only gets FARTHER from the
  // bottom. The bug snapped scrollTop to the bottom (dist ~0) every token.
  const dist = () =>
    scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  // the scroll released the follow gate; confirm we left the bottom. The
  // threshold is well above a snapped-to-bottom thread (dist ~0) and below
  // the real scroll range, which the clamped message bubble keeps modest.
  await expect.poll(() => dist(), { timeout: 3_000 }).toBeGreaterThan(40);
  // the jump-to-latest button appears once we leave the bottom
  const toLatest = page.getByRole("button", { name: /scroll to latest/i });
  await expect(toLatest).toBeVisible();

  // over the next stretch of streaming we must never snap back to the bottom
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(CHUNK_MS);
    expect(await dist()).toBeGreaterThan(40);
  }
  await expect(toLatest).toBeVisible();

  // the button returns us to the bottom and re-arms follow
  await toLatest.click();
  await expect(page.getByText(new RegExp(LAST_WORD)).first()).toBeVisible({
    timeout: 15_000,
  });
});

test("Stop mid-stream keeps the partial assistant text", async ({ page }) => {
  // Regression guard: pressing Stop must keep the text streamed so far
  // (chat-stream.ts keeps the partial across the AbortError).
  const composer = await openFreshChat(page);
  const userText = `e2e stop ${Date.now()}`;
  await composer.fill(userText);
  await page.getByRole("button", { name: "Send", exact: true }).click();

  const reply = page.getByText(new RegExp(FIRST_WORDS)).first();
  await expect(reply).toBeVisible({ timeout: 10_000 });

  const stop = page.getByRole("button", { name: "Stop generating" });
  await expect(stop).toBeVisible();
  await stop.click();

  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeVisible({
    timeout: 5_000,
  });
  const partial = (await reply.textContent()) ?? "";
  expect(partial).toContain("Mocked");
  expect(partial).not.toContain(LAST_WORD);

  // nothing keeps streaming into the bubble after Stop
  await page.waitForTimeout(CHUNK_MS * 8);
  expect(await reply.textContent()).toBe(partial);
  expect(await page.getByText(new RegExp(LAST_WORD)).count()).toBe(0);
});
