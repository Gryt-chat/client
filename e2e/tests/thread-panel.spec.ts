import type { Locator, Page } from "@playwright/test";

import { accessTokenOf, withSocket } from "../support/admin";
import { composer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

/** The panel itself: what closes it, what Escape means inside it, where it opens. */

function panel(page: Page): Locator {
  return page.getByRole("complementary", { name: "Thread" });
}

function threadComposer(page: Page): Locator {
  return composer(page, "Reply to thread…");
}

async function startThread(page: Page, rootText: string): Promise<void> {
  const row = messageRow(page, rootText);
  await row.hover();
  await row.getByRole("button", { name: "Start thread" }).click();
  await expect(panel(page)).toBeVisible();
}

async function openThread(page: Page, rootText: string): Promise<void> {
  const row = messageRow(page, rootText);
  await row.hover();
  await row.getByRole("button", { name: "Open thread" }).click();
  await expect(panel(page)).toBeVisible();
}

async function replyInThread(page: Page, text: string): Promise<void> {
  const box = threadComposer(page);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(panel(page).locator("[data-message-id]").filter({ hasText: text })).toBeVisible();
}

/** The open thread, read off the wire: the panel draws no ids. */
function openThreadIds(frames: string[]): { conversationId: string; threadId: string } {
  const history = frames.filter((f) => f.includes('"thread:history"')).at(-1);
  const conversationId = history && /"conversation_id":"([^"]+)"/.exec(history)?.[1];
  const threadId = history && /"thread_id":"([^"]+)"/.exec(history)?.[1];
  if (!conversationId || !threadId) throw new Error("no thread:history frame to read ids from");
  return { conversationId, threadId };
}

async function deleteMessage(page: Page, text: string): Promise<void> {
  const row = messageRow(page, text);
  await row.hover();
  await row.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).last().click();
  await expect(messageRow(page, text)).toHaveCount(0);
}

test("a thread deleted elsewhere leaves your panel open", async ({ newMember, owner }) => {
  const alice = await newMember();

  const keep = unique("the thread that stays open");
  const doomed = unique("the thread somebody else deletes");
  await sendMessage(alice.page, keep);
  await sendMessage(alice.page, doomed);

  // Both need a thread, or there is no thread:deleted to arrive.
  await startThread(alice.page, doomed);
  await replyInThread(alice.page, unique("a reply in the doomed thread"));
  await alice.page.getByRole("button", { name: "Close thread" }).click();
  await startThread(alice.page, keep);
  await replyInThread(alice.page, unique("a reply worth keeping in view"));

  await expect(messageRow(owner.page, doomed)).toBeVisible();
  await deleteMessage(owner.page, doomed);
  await expect(messageRow(alice.page, doomed)).toHaveCount(0);

  await expect(panel(alice.page), "somebody else's thread went, not yours").toBeVisible();
  await expect(threadComposer(alice.page)).toBeVisible();
});

test("Escape closes the mention list before it closes the panel", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("a thread to type into");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);

  await threadComposer(alice.page).click();
  await alice.page.keyboard.type("@");
  const mentions = alice.page.locator(".mention-autocomplete");
  await expect(mentions).toBeVisible();

  await alice.page.keyboard.press("Escape");
  await expect(mentions).toBeHidden();
  await expect(panel(alice.page), "the list went, the panel stayed").toBeVisible();

  await alice.page.keyboard.press("Escape");
  await expect(panel(alice.page)).toBeHidden();
});

test("Escape hands a half-written reply back when the thread is reopened", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("a thread with an unsent reply");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);

  const draft = unique("half written and not sent");
  await threadComposer(alice.page).click();
  await alice.page.keyboard.insertText(draft);
  await alice.page.keyboard.press("Escape");
  await expect(panel(alice.page)).toBeHidden();

  await openThread(alice.page, root);
  await expect(threadComposer(alice.page)).toHaveText(draft);
});

test("a thread opens at its newest reply", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("a thread long enough to scroll");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);

  // Tall rather than many: the send limit is 20 in 10 seconds, and eight
  // wrapped replies already overflow a 380px panel.
  const filler = "a reply long enough to wrap over several lines in a narrow panel. ".repeat(4);
  for (let i = 1; i < 8; i++) await replyInThread(alice.page, `${unique(`reply ${i}`)} ${filler}`);
  const last = unique("the newest reply, the one to land on");
  await replyInThread(alice.page, `${last} ${filler}`);

  await alice.page.getByRole("button", { name: "Close thread" }).click();
  await openThread(alice.page, root);

  const newest = panel(alice.page).locator("[data-message-id]").filter({ hasText: last });
  await expect(newest).toBeInViewport();
});

test("a refused reply is retried once, then gives the text back", async ({ newMember, owner, gryt }) => {
  const alice = await newMember();

  const root = unique("a thread about to be closed");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("a reply while it is still open"));

  // Closed to new replies, which the panel does not offer and does not gate on,
  // so the next reply goes out and the server refuses it.
  const { conversationId, threadId } = openThreadIds(alice.frames);
  const accessToken = await accessTokenOf(owner.page, gryt.server.host);
  // thread:updated goes to the joined clients, and this socket is not one, so
  // the confirmation to wait on is the one Alice's page receives.
  await withSocket(gryt.server.httpBase, async (socket) => {
    socket.emit("thread:status:set", { conversationId, threadId, status: "closed", accessToken });
    await expect
      .poll(() => alice.frames.some((f) => f.includes('"thread:updated"') && f.includes('"status":"closed"')))
      .toBe(true);
  });

  const refused = unique("this one is refused");
  const box = threadComposer(alice.page);
  await box.click();
  await alice.page.keyboard.insertText(refused);
  await box.press("Enter");

  const row = panel(alice.page).locator("[data-message-id]").filter({ hasText: refused });
  await expect(row).toContainText("Failed to send", { timeout: 30_000 });
  await expect(box, "the text is back in the box to send somewhere else").toHaveText(refused);
});

test("a refused fetch says so where the replies would be", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("a thread to ask for too often");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);

  /* The fetch limit is 15 in 10 seconds and the reply line asks again on every
     press, which is the one refusal a test can provoke on its own. */
  const line = messageRow(alice.page, root).getByRole("button", { name: /repl(y|ies)/ });
  const retry = panel(alice.page).getByRole("button", { name: "Try again" });
  for (let i = 0; i < 25 && !(await retry.isVisible()); i++) {
    await line.click({ force: true });
  }

  await expect(panel(alice.page)).toContainText("Too fast");
  await expect(panel(alice.page)).not.toContainText("Loading…");
  await expect(panel(alice.page).getByRole("button", { name: "Try again" })).toBeVisible();
});
