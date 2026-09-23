import type { Locator, Page } from "@playwright/test";

import { addChannel, composer, messageRow, sidebarChannelRow, unique, unreadBadge } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";

/** The "N replies" line under a message, with whatever badge it carries. */
function threadLine(page: Page, rootText: string): Locator {
  return messageRow(page, rootText).locator("button", { hasText: /repl(y|ies)/ });
}

async function send(page: Page, box: Locator, text: string): Promise<void> {
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(messageRow(page, text)).toBeVisible();
}

/** Opens a channel for this page and hands back its composer. */
async function open(page: Page, channel: string): Promise<Locator> {
  await sidebarChannelRow(page, channel).click();
  const box = composer(page, `Message #${channel}`);
  await expect(box).toBeVisible();
  return box;
}

/** Starts a thread through the row's menu, which a re-render does not take away
    the way the hover toolbar does. */
async function startThread(page: Page, rootText: string): Promise<Locator> {
  await messageRow(page, rootText).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Start thread" }).click();
  const box = composer(page, "Reply to thread…");
  await expect(box).toBeVisible();
  return box;
}

test.describe("unread counts", () => {
  test.skip(
    !!process.env.GRYT_E2E_SERVER,
    "a mention needs a server whose member list was read after these two joined, so each test owns one",
  );

  /** A server of its own, a room, one guest writing in it and one watching from
      General. Its own, because a server holds who is mentionable for 30s. */
  async function room(
    freshServer: () => Promise<Parameters<typeof addChannel>[1]>,
    newMember: (options: { server: Parameters<typeof addChannel>[1]; label: string }) => Promise<{ page: Page; name: string }>,
  ) {
    const server = await freshServer();
    const sender = await newMember({ server, label: "sender" });
    const watcher = await newMember({ server, label: "watcher" });
    const name = uniqueName("room");
    await addChannel(sender.page, server, name);
    await expect(sidebarChannelRow(watcher.page, name)).toBeVisible();
    return { name, sender, watcher, box: await open(sender.page, name), row: sidebarChannelRow(watcher.page, name) };
  }

  test("a mention is still on the badge after a reload", async ({ freshServer, newMember }) => {
    const { name, sender, watcher, box, row } = await room(freshServer, newMember);

    await send(sender.page, box, `@${watcher.name} ${unique("named")}`);
    await expect(unreadBadge(row)).toHaveText("1");

    // What it counted before was counted from the connection. This can only have
    // come back from the server.
    await watcher.page.reload();
    const after = sidebarChannelRow(watcher.page, name);
    await expect(unreadBadge(after)).toHaveText("1");
    await expect(unreadBadge(after)).toHaveAttribute("title", "1 unread, 1 naming you");
  });

  test("the badge counts mentions it did not see arrive", async ({ freshServer, newMember }) => {
    const { name, sender, watcher, box, row } = await room(freshServer, newMember);

    for (let i = 1; i <= 3; i++) await send(sender.page, box, `@${watcher.name} ${unique(`named${i}`)}`);
    await expect(unreadBadge(row)).toHaveText("3");

    // After the reload the three are mentions and nothing else: no message
    // arrived on this connection. One that does must not hide them.
    await watcher.page.reload();
    const after = sidebarChannelRow(watcher.page, name);
    await expect(unreadBadge(after)).toHaveText("3");
    await send(sender.page, box, unique("plain"));
    await expect(unreadBadge(after)).toHaveAttribute("title", "3 unread, 3 naming you");
  });

  test("a thread reply counts on the channel it hangs off", async ({ freshServer, newMember }) => {
    const { name, sender, watcher, box, row } = await room(freshServer, newMember);

    const root = unique("root");
    await send(sender.page, box, root);
    await expect(unreadBadge(row)).toHaveText("1");

    const thread = await startThread(sender.page, root);
    for (let i = 1; i <= 3; i++) await send(sender.page, thread, unique(`reply${i}`));

    // The message on the timeline and the three replies under it. The replies
    // used to leave the row saying 1.
    await expect(unreadBadge(row)).toHaveText("4");

    // Standing in the channel reads its timeline and not the threads hanging
    // off it: their replies were never on it.
    await open(watcher.page, name);
    await expect(unreadBadge(row)).toHaveText("3");
  });

  test("a mention inside a thread counts once on its channel", async ({ freshServer, newMember }) => {
    const { name, sender, watcher, box, row } = await room(freshServer, newMember);

    const root = unique("root");
    await send(sender.page, box, root);
    const thread = await startThread(sender.page, root);

    // Read the room first, so the thread is the only thing left to count.
    await open(watcher.page, name);
    await expect(messageRow(watcher.page, root)).toBeVisible();
    await expect(unreadBadge(row)).toHaveCount(0);

    await send(sender.page, thread, `@${watcher.name} ${unique("inthread")}`);
    await expect(unreadBadge(row)).toHaveText("1");
    await expect(threadLine(watcher.page, root)).toHaveText(/1 reply\s*1/);

    // The same one mention, from a channel the watcher is not standing in.
    await open(watcher.page, "General");
    await expect(unreadBadge(row)).toHaveText("1");

    // And opening the thread is what reads it.
    await open(watcher.page, name);
    await send(sender.page, thread, `@${watcher.name} ${unique("again")}`);
    await expect(threadLine(watcher.page, root)).toHaveText(/2 replies\s*2/);
    await threadLine(watcher.page, root).click();
    await expect(watcher.page.getByRole("complementary", { name: "Thread" })).toBeVisible();
    await expect(unreadBadge(row)).toHaveCount(0);
  });
});
