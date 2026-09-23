import type { Page } from "@playwright/test";

import { channelComposer, composer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

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
  await alice.page.getByRole("button", { name: "Close thread" }).click();

  const channels = alice.page.getByRole("navigation", { name: "Channels" });
  await channels.getByRole("button", { name: "Random" }).click();
  await expect(channelComposer(alice.page, "Random")).toBeVisible();
  await channels.getByRole("button", { name: "General" }).click();
  await expect(channelComposer(alice.page)).toBeVisible();

  await expect(replyLine(alice.page, root)).toContainText("1 reply");
});
