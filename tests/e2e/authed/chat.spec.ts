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

/** Conversation rows in the sidebar tree: the dnd-kit row (role=button) that
 *  contains the hover kebab ("Conversation actions"). */
function conversationRows(page: Page) {
  const kebab = page.getByRole("button", {
    name: "Conversation actions",
    exact: true,
  });
  return page
    .getByRole("button", { name: /Conversation actions/ })
    .filter({ has: kebab });
}

/** Delete the newest (top) conversation row through its kebab menu + confirm. */
async function deleteTopConversation(page: Page) {
  const row = conversationRows(page).first();
  if ((await row.count()) === 0) return;
  await row.hover();
  await row
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
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
  await expect(conversationRows(page).first()).toBeVisible({ timeout: 15_000 });
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
