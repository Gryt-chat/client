import type { Page } from "@playwright/test";

import { accessTokenOf, ask, serverUserIdOf, withSocket } from "../support/admin";
import { channelComposer, composer, messageRow, sendMessage, sidebarChannelRow, unique } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";
import type { GrytServer } from "../support/server";

/** The hover toolbar only draws over the row the pointer is on. */
async function threadButton(page: Page, text: string, name: "Start thread" | "Open thread") {
  const row = messageRow(page, text);
  await row.hover();
  return row.getByRole("button", { name });
}

async function startThread(page: Page, rootText: string): Promise<void> {
  await (await threadButton(page, rootText, "Start thread")).click();
  await expect(page.getByRole("complementary", { name: "Thread" })).toBeVisible();
}

async function replyInThread(page: Page, text: string): Promise<void> {
  const box = composer(page, "Reply to thread…");
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(
    page.getByRole("complementary", { name: "Thread" }).locator("[data-message-id]").filter({ hasText: text }),
  ).toBeVisible();
}

/* The line under a root message. Its name carries the unread badge too, so
   "1 reply" reads as "1 reply 1" for somebody who has not opened it. */
function replyLine(page: Page, rootText: string) {
  return messageRow(page, rootText).getByRole("button", { name: /repl(y|ies)/ });
}

test("a reload keeps a channel's reply counts", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const root = unique("a root worth threading");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("first reply"));

  await expect(replyLine(alice.page, root)).toContainText("1 reply");

  await alice.page.reload();
  await expect(messageRow(alice.page, root)).toBeVisible();
  /* The suite runs against the published server image, and the summaries ride
     on chat:history. This turns itself back on when that image carries them. */
  test.skip(
    !alice.frames.some((frame) => frame.includes('"chat:history"') && frame.includes('"threads":')),
    "this server image sends chat:history without thread summaries (GRYT-1386)",
  );
  await expect(replyLine(alice.page, root)).toContainText("1 reply");
  await expect(await threadButton(alice.page, root, "Open thread")).toBeVisible();

  // A member who never saw the thread:created has to read the same count.
  await expect(replyLine(bob.page, root)).toContainText("1 reply");
  await bob.page.reload();
  await expect(channelComposer(bob.page)).toBeVisible();
  await expect(replyLine(bob.page, root)).toContainText("1 reply");
});

test("the count survives a channel switch inside the history cache window", async ({ newMember }) => {
  const alice = await newMember();

  const root = unique("threaded before switching away");
  await sendMessage(alice.page, root);
  await startThread(alice.page, root);
  await replyInThread(alice.page, unique("a reply to come back to"));
  await alice.page.getByRole("button", { name: "Close the thread panel" }).click();

  const channels = alice.page.getByRole("navigation", { name: "Channels" });
  await channels.getByRole("button", { name: "Random" }).click();
  await expect(channelComposer(alice.page, "Random")).toBeVisible();
  await channels.getByRole("button", { name: "General" }).click();
  await expect(channelComposer(alice.page)).toBeVisible();

  await expect(replyLine(alice.page, root)).toContainText("1 reply");
});

/** A forum channel made with the owner's token, waited for in the owner's sidebar. */
async function addForumChannel(owner: Page, server: GrytServer, name: string): Promise<void> {
  const accessToken = await accessTokenOf(owner, server.host);
  await withSocket(server.httpBase, async (socket) => {
    socket.emit("server:channels:upsert", { accessToken, name, type: "text", layout: "forum" });
    await expect(sidebarChannelRow(owner, name)).toBeVisible();
  });
}

async function openChannel(page: Page, name: string): Promise<void> {
  await sidebarChannelRow(page, name).click();
  await expect(page.getByRole("button", { name: "New topic" })).toBeVisible();
}

async function createTopic(page: Page, title: string, body: string): Promise<void> {
  await page.getByRole("button", { name: "New topic" }).click();
  const dialog = page.getByRole("dialog", { name: "New topic" });
  await dialog.getByPlaceholder("Title").fill(title);
  await dialog.getByPlaceholder(/Describe/).fill(body);
  await dialog.getByRole("button", { name: "Create topic" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(title) })).toBeVisible();
}

test("the author closes a topic from the panel, and it leaves All for Closed", async ({ newMember, owner, gryt }) => {
  const forum = uniqueName("forum");
  await addForumChannel(owner.page, gryt.server, forum);

  const alice = await newMember();
  await openChannel(alice.page, forum);
  const title = unique("a topic that gets closed");
  await createTopic(alice.page, title, "Something that stops being worth replying to.");

  const row = alice.page.getByRole("button", { name: new RegExp(title) });
  await row.click();
  const panel = alice.page.getByRole("complementary", { name: "Thread" });
  await expect(panel).toBeVisible();

  // Hers to close: the server lets the author settle their own topic.
  await panel.getByRole("button", { name: "More for this topic" }).click();
  await alice.page.getByRole("menuitem", { name: "Close topic" }).click();
  await expect(panel).toContainText("This thread is closed, so you can’t reply to it.");
  await expect(panel).toContainText("Closed");
  await expect(panel.getByRole("button", { name: "More for this topic" })).toHaveCount(0);

  await expect(row, "All leaves closed topics out").toHaveCount(0);
  await alice.page.getByRole("button", { name: /^Closed/ }).click();
  await expect(row, "and Closed is the way back to them").toBeVisible();
  await expect(row).toContainText("Closed");

  // And back, so closing is not a one-way door.
  await panel.getByRole("button", { name: "Reopen" }).click();
  await expect(composer(alice.page, "Reply to thread…")).toBeVisible();
  await alice.page.getByRole("button", { name: /^All/ }).click();
  await expect(row).toBeVisible();
});

test("a topic whose first post you cannot see says so", async ({ newMember, owner, gryt }) => {
  const forum = uniqueName("forum");
  await addForumChannel(owner.page, gryt.server, forum);

  const bob = await newMember();
  await openChannel(bob.page, forum);
  const title = unique("a topic by somebody about to be blocked");
  await createTopic(bob.page, title, "The first post of a topic nobody else will read.");

  const alice = await newMember();
  await openChannel(alice.page, forum);
  const row = alice.page.getByRole("button", { name: new RegExp(title) });
  await expect(row).toBeVisible();

  /* thread:fetch drops a blocked sender's root, and the index does not, so this
     is the one way to open a topic with nothing above the divider. */
  const aliceToken = await accessTokenOf(alice.page, gryt.server.host);
  const bobId = serverUserIdOf(await accessTokenOf(bob.page, gryt.server.host));
  await withSocket(gryt.server.httpBase, async (socket) => {
    await ask(socket, "user:block", { accessToken: aliceToken, serverUserId: bobId }, "user:blocked");
  });

  await row.click();
  const panel = alice.page.getByRole("complementary", { name: "Thread" });
  await expect(panel).toBeVisible();
  await expect(panel, "a blank panel reads as a broken app").toContainText(
    "The message this thread started from is gone.",
  );
});
