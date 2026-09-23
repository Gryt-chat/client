import type { Locator, Page } from "@playwright/test";

import { accessTokenOf, ask, serverUserIdOf, withSocket } from "../support/admin";
import { composer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

/** The panel itself: what closes it, what Escape means inside it, where it opens. */

/** Wide enough for the panel to sit beside the conversation; `hasRoomForThreadBeside` says 1164. */
const BESIDE = 1280;
/** Under it, so the panel takes the chat pane. The Electron minimum is 300. */
const TAKEOVER = 700;

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

  const root = unique("a thread to be refused in");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("a reply while she may still post"));

  /* A server mute rather than a closed thread: closing takes the composer away
     now, and this refusal leaves one to type the refused reply into. */
  const accessToken = await accessTokenOf(owner.page, gryt.server.host);
  const aliceId = serverUserIdOf(await accessTokenOf(alice.page, gryt.server.host));
  await withSocket(gryt.server.httpBase, async (socket) => {
    await ask(socket, "server:mute", { accessToken, targetServerUserId: aliceId, muted: true }, "server:mute:success");
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

/** Closes the open thread from outside the app: nothing in the UI can. */
async function closeOpenThread(frames: string[], token: string, httpBase: string): Promise<void> {
  const { conversationId, threadId } = openThreadIds(frames);
  await withSocket(httpBase, async (socket) => {
    socket.emit("thread:status:set", { conversationId, threadId, status: "closed", accessToken: token });
    await expect
      .poll(() => frames.some((f) => f.includes('"thread:updated"') && f.includes('"status":"closed"')))
      .toBe(true);
  });
}

test("a closed thread says so instead of drawing a composer", async ({ newMember, owner, gryt }) => {
  const alice = await newMember();

  const root = unique("a thread about to be closed");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("a reply while it is still open"));

  const accessToken = await accessTokenOf(owner.page, gryt.server.host);
  await closeOpenThread(alice.frames, accessToken, gryt.server.httpBase);

  await expect(threadComposer(alice.page), "the composer goes with the thread").toBeHidden();
  await expect(panel(alice.page)).toContainText("This thread is closed, so you can’t reply to it.");
  await expect(panel(alice.page)).toContainText("Closed");

  // Alice started it, so she is the one who can put it back.
  await panel(alice.page).getByRole("button", { name: "Reopen" }).click();
  await expect(threadComposer(alice.page)).toBeVisible();
});

test("the status control is drawn for the author and a moderator, and nobody else", async ({ newMember, owner }) => {
  const alice = await newMember();
  const bob = await newMember();

  const root = unique("a thread only its author can settle");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("a reply so the line shows for everybody"));

  await expect(panel(alice.page).getByRole("button", { name: "Mark solved" }), "hers to settle").toBeVisible();

  await openThread(bob.page, root);
  await expect(
    panel(bob.page).getByRole("button", { name: "Mark solved" }),
    "the server refuses Bob, so he does not get the button",
  ).toHaveCount(0);

  // The owner holds manage_messages, which is what the server checks.
  await openThread(owner.page, root);
  await expect(panel(owner.page).getByRole("button", { name: "Mark solved" })).toBeVisible();
});

test("deleting a threaded message counts the replies going with it", async ({ newMember }) => {
  const alice = await newMember();

  const plain = unique("a message with nothing under it");
  const root = unique("a message with a thread under it");
  await sendMessage(alice.page, plain);
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("the first reply that goes too"));
  await replyInThread(alice.page, unique("the second reply that goes too"));
  await alice.page.getByRole("button", { name: "Close thread" }).click();

  const dialog = alice.page.getByRole("alertdialog");

  const plainRow = messageRow(alice.page, plain);
  await plainRow.hover();
  await plainRow.getByRole("button", { name: "Delete" }).click();
  await expect(dialog).toContainText("This deletes the message for everyone.");
  await dialog.getByRole("button", { name: "Cancel" }).click();

  const rootRow = messageRow(alice.page, root);
  await rootRow.hover();
  await rootRow.getByRole("button", { name: "Delete" }).click();
  await expect(dialog, "the server takes the thread with the root").toContainText(
    "This deletes the message and the 2 replies in its thread.",
  );
});

test("starting a thread with no connection says so", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("a thread nobody can start right now");
  await sendMessage(alice.page, root);

  await alice.context.setOffline(true);
  try {
    // The click lands before socket.io notices the socket is gone, so it is
    // worth asking more than once.
    await expect
      .poll(
        async () => {
          const row = messageRow(alice.page, root);
          await row.hover();
          await row.getByRole("button", { name: "Start thread" }).click({ force: true });
          return alice.page.getByText("Not connected to this server").isVisible();
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(panel(alice.page), "no panel waiting on a thread:created that never comes").toBeHidden();
  } finally {
    await alice.context.setOffline(false);
  }
});

test("the panel and the reply in it survive a resize in both directions", async ({ newMember }) => {
  const alice = await newMember();
  const { page } = alice;

  const root = unique("a thread open while the window moves");
  await sendMessage(page, root);
  await startThread(page, root);

  const draft = unique("half written when the window moved");
  await threadComposer(page).click();
  await page.keyboard.insertText(draft);
  await expect(threadComposer(page)).toHaveText(draft);

  // Beside the conversation: the row behind it is reachable, which it was not
  // when the panel was drawn over the pane at every width (GRYT-1390).
  await expect(panel(page)).toHaveAttribute("data-beside", "yes");
  // The first of the two is the channel's; the panel draws the root a second time.
  await expect(messageRow(page, root).first()).toBeVisible();

  // Down past the breakpoint, and down again past the one where the desktop
  // layout hands over to the phone one. Both used to take the panel with them.
  for (const width of [TAKEOVER, 390, 300]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).toHaveAttribute("data-beside", "no");
    await expect(page.getByRole("button", { name: "Back to the conversation" })).toBeVisible();
    await expect(threadComposer(page)).toHaveText(draft);
  }

  for (const width of [TAKEOVER, BESIDE]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(panel(page)).toBeVisible();
    await expect(threadComposer(page)).toHaveText(draft);
  }
  await expect(panel(page)).toHaveAttribute("data-beside", "yes");

  // The reply is still the one that was typed, not a copy of it.
  await expect(threadComposer(page)).toHaveText(draft);
  await replyInThread(page, `${draft} and then sent`);
});

test("a message row beside the panel takes a click where the panel used to be", async ({ newMember }) => {
  const alice = await newMember();
  const { page } = alice;
  await page.setViewportSize({ width: BESIDE, height: 800 });

  const root = unique("a row to click at its centre");
  await sendMessage(page, root);
  await startThread(page, root);
  await expect(panel(page)).toHaveAttribute("data-beside", "yes");

  const row = messageRow(page, root).first();
  await row.scrollIntoViewIfNeeded();
  const hit = await page.evaluate((text) => {
    const aside = document.querySelector('aside[aria-label="Thread"]');
    const rows = Array.from(document.querySelectorAll("[data-message-id]")) as HTMLElement[];
    const target = rows.find((r) => r.textContent?.includes(text) && !aside?.contains(r));
    const scroller = document.querySelector(".chat-scroll-container");
    if (!target || !scroller) return "no row";
    // Clamped to the part of the row the scroller is actually showing.
    const box = target.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const top = Math.max(box.top, view.top);
    const bottom = Math.min(box.bottom, view.bottom);
    const at = document.elementFromPoint(box.left + box.width / 2, (top + bottom) / 2);
    if (!at) return "nothing";
    if (aside?.contains(at)) return "panel";
    return at.closest("[data-message-id]") === target ? "row" : "something else";
  }, root);
  expect(hit, "the centre of the row belongs to the row, not the panel").toBe("row");

  // And the actions on it are reachable, which is what the overlap cost.
  await row.hover();
  await expect(row.getByRole("button", { name: "Open thread" })).toBeVisible();
});
