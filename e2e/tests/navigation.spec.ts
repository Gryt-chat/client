import type { Page } from "@playwright/test";

import { accessTokenOf, withSocket } from "../support/admin";
import { channelComposer, joinAnotherServer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";
import type { GrytServer } from "../support/server";

interface Kept {
  body: string;
  onclick: (() => void) | null;
}

/** Stands in for the browser's Notification and keeps each one, so the test can click it. */
function keepNotifications() {
  const kept: Kept[] = [];
  (window as unknown as { keptNotifications: Kept[] }).keptNotifications = kept;
  class KeptNotification {
    static permission = "granted";
    static requestPermission = () => Promise.resolve("granted");
    body: string;
    onclick: (() => void) | null = null;
    constructor(_title: string, options?: { body?: string }) {
      this.body = options?.body ?? "";
      kept.push(this);
    }
    close() {}
  }
  Object.defineProperty(window, "Notification", { configurable: true, writable: true, value: KeptNotification });
}

function channelRow(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true });
}

function railButton(page: Page, name: string) {
  return page.locator('[data-gryt="sidebar"]').getByRole("button", { name, exact: true });
}

/** A text channel made with the owner's token, and waited for in the owner's sidebar. */
async function addChannel(owner: Page, server: GrytServer, name: string) {
  const accessToken = await accessTokenOf(owner, server.host);
  await withSocket(server.httpBase, async (socket) => {
    const refused = new Promise<never>((_, reject) =>
      socket.once("server:error", (e: { message?: string }) => reject(new Error(`Making #${name} was refused: ${e?.message}`))),
    );
    refused.catch(() => undefined);
    socket.emit("server:channels:upsert", { accessToken, name, type: "text" });
    // The new channel list goes to members, not to this socket.
    await Promise.race([expect(channelRow(owner, name)).toBeVisible(), refused]);
  });
}

test("a notification from another server opens its channel, and each server keeps its own", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs servers of its own, and GRYT_E2E_SERVER gives one");

  const [alpha, bravo] = await Promise.all([freshServer({ displayName: "Alpha" }), freshServer({ displayName: "Bravo" })]);
  // First into both, so it owns them and can make the channels.
  const viewer = await newMember({ server: alpha, label: "viewer" });
  await addChannel(viewer.page, alpha, "alpha-notes");
  await joinAnotherServer(viewer.page, bravo.host);
  await addChannel(viewer.page, bravo, "bravo-notes");
  await viewer.context.addInitScript(keepNotifications);
  await viewer.page.reload();

  const sender = await newMember({ server: bravo, label: "sender" });
  await channelRow(sender.page, "bravo-notes").click();
  await expect(channelComposer(sender.page, "bravo-notes")).toBeVisible();

  // Bravo has no channel with alpha-notes' id, which is what sent the click to #General.
  await railButton(viewer.page, "Bravo").click();
  await expect(channelComposer(viewer.page)).toBeVisible();
  await railButton(viewer.page, "Alpha").click();
  await channelRow(viewer.page, "alpha-notes").click();
  await expect(channelComposer(viewer.page, "alpha-notes")).toBeVisible();

  const text = unique("over on Bravo");
  await sendMessage(sender.page, text, "bravo-notes");
  const notified = (body: string) =>
    viewer.page.evaluate(
      (body) => (window as unknown as { keptNotifications: Kept[] }).keptNotifications.some((n) => n.body.includes(body)),
      body,
    );
  await expect.poll(() => notified(text), "no notification came for the message on Bravo").toBe(true);
  await viewer.page.evaluate(
    (body) => (window as unknown as { keptNotifications: Kept[] }).keptNotifications.find((n) => n.body.includes(body))?.onclick?.(),
    text,
  );

  await expect(channelComposer(viewer.page, "bravo-notes")).toBeVisible();
  await expect(messageRow(viewer.page, text)).toBeVisible();

  await test.step("going back to each server finds the channel it was on", async () => {
    await railButton(viewer.page, "Alpha").click();
    await expect(channelComposer(viewer.page, "alpha-notes")).toBeVisible();
    await railButton(viewer.page, "Bravo").click();
    await expect(channelComposer(viewer.page, "bravo-notes")).toBeVisible();
  });
});
