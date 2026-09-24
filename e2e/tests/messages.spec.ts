import type { Page } from "@playwright/test";

import { accessTokenOf, ask, serverUserIdOf, setProfanityMode, withSocket } from "../support/admin";
import { channelComposer, messageRow, pasteText, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

test("a message sent with one Enter reaches the other members", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const text = unique("hello from the smoke test");
  await sendMessage(alice.page, text);

  await expect(messageRow(bob.page, text)).toBeVisible();
});

test("a pasted address with a port sends on the first Enter", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const url = "http://192.168.50.196:3000";
  const box = channelComposer(alice.page);
  await box.click();
  await alice.page.evaluate((text) => navigator.clipboard.writeText(text), url);
  await alice.page.keyboard.press("ControlOrMeta+V");
  await expect(box).toHaveText(url);

  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(messageRow(bob.page, url)).toBeVisible();
});


test("an oversized paste becomes a text attachment instead of filling the composer", async ({ newMember }) => {
  const alice = await newMember();
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const box = channelComposer(alice.page);
  await pasteText(alice.page, box, "x".repeat(4001));

  await expect(box).toHaveText("");
  await expect(
    alice.page.getByText("pasted-text.txt", { exact: true }),
  ).toBeVisible();
});

test("an oversized paste where files can't be attached says so", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  const server = await freshServer();
  const owner = await newMember({ server, label: "owner" });
  const alice = await newMember({ server });
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const attach = alice.page.getByRole("button", { name: "Attach file" });
  await expect(attach).toBeVisible();
  const accessToken = await accessTokenOf(owner.page, server.host);
  await withSocket(server.httpBase, async (socket) => {
    const state = await ask<{ roles?: { id: string; permissions: string[] }[] }>(
      socket, "server:roles:definitions:list", { accessToken }, "server:roles:definitions",
    );
    const member = state.roles?.find((role) => role.id === "member");
    expect(member?.permissions, "new guests should start as members who can attach").toContain("attach_files");
    const refused = new Promise<never>((_, reject) =>
      socket.once("server:error", (e: { message?: string }) => reject(new Error(`Saving the role was refused: ${e?.message}`))),
    );
    refused.catch(() => undefined);
    socket.emit("server:roles:definitions:save", {
      accessToken, roleId: "member", permissions: member!.permissions.filter((p) => p !== "attach_files"),
    });
    await Promise.race([expect(attach).toHaveCount(0), refused]);
  });

  const box = channelComposer(alice.page);
  await pasteText(alice.page, box, "x".repeat(4001));

  await expect(alice.page.getByText("That's too long to paste. Messages can be up to 4,000 characters, and you can't attach files here.")).toBeVisible();
  await expect(box).toHaveText("");
  await expect(alice.page.getByRole("button", { name: "Remove file" })).toHaveCount(0);
});

test("a message whose upload fails comes back to the composer, and its row says it failed", async ({ newMember }) => {
  const alice = await newMember();
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const text = unique("sent with a long paste");
  const box = channelComposer(alice.page);
  await box.click();
  await alice.page.keyboard.insertText(text);
  await pasteText(alice.page, box, "y".repeat(4001));
  const files = alice.page.getByRole("button", { name: "Remove file" });
  await expect(files).toHaveCount(1);

  await alice.page.route("**/api/uploads", (route) => route.abort("connectionrefused"));
  await box.press("Enter");

  await expect(alice.page.locator("[data-message-id]").filter({ hasText: text })).toContainText("Failed to send");
  await expect(box).toHaveText(text);
  await expect(files).toHaveCount(1);

  // What came back is the whole message: one Enter sends it.
  await alice.page.unroute("**/api/uploads");
  await box.press("Enter");
  await expect(messageRow(alice.page, text)).toBeVisible();
  await expect(messageRow(alice.page, text)).toContainText("pasted-text.txt");
  await expect(box).toHaveText("");
  await expect(files).toHaveCount(0);
});

test("a message the server keeps refusing fails instead of sitting pending", async ({ newMember, owner, gryt }) => {
  const alice = await newMember();
  const token = await accessTokenOf(owner.page, gryt.server.host);

  /* A blocked word is refused every time and leaves the composer open. A mute
     used to stand in for it, and locks the box now instead (GRYT-1400). */
  await setProfanityMode(gryt.server.httpBase, token, "block");

  try {
    const text = `${unique("refused twice over")} shit`;
    const box = channelComposer(alice.page);
    await box.click();
    await alice.page.keyboard.insertText(text);
    await box.press("Enter");

    // One automatic retry, and then the row says so rather than staying pending.
    await expect(alice.page.locator("[data-message-id]").filter({ hasText: text })).toContainText("Failed to send", { timeout: 30_000 });
    await expect(box).toHaveText(text);
  } finally {
    await setProfanityMode(gryt.server.httpBase, token, "censor");
  }
});

test("a send past the rate limit goes out when the wait is over", async ({ owner }) => {
  test.setTimeout(150_000);
  const page = owner.page;
  const box = channelComposer(page);

  // Until the limiter refuses one, which swaps the placeholder for the wait.
  const texts: string[] = [];
  for (let i = 0; i < 25 && (await box.isVisible().catch(() => false)); i++) {
    const text = unique(`too fast ${i}`);
    try {
      await box.click({ timeout: 2000 });
      await page.keyboard.insertText(text);
      await box.press("Enter", { timeout: 2000 });
      texts.push(text);
    } catch {
      break;
    }
  }
  const refused = texts[texts.length - 1];
  const waiting = page.locator('[role="textbox"][aria-placeholder^="Please wait"]');
  await expect(waiting, "eleven sends in a row should trip the limiter").toBeVisible();

  /* The countdown used to be cleared by the next render, so it sat at thirty,
     the composer never came back and the refused message never left. */
  await expect(waiting).toHaveCount(0, { timeout: 60_000 });
  await expect(messageRow(page, refused)).toBeVisible({ timeout: 30_000 });
});

test("editing a message changes it for everyone", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const before = unique("typo in this mesage");
  const after = before.replace("mesage", "message");
  const row = await sendMessage(alice.page, before);
  await expect(messageRow(bob.page, before)).toBeVisible();

  await row.click({ button: "right" });
  await alice.page.getByRole("menuitem", { name: "Edit Message" }).click();
  const box = channelComposer(alice.page);
  await expect(box).toHaveText(before);
  // The editor focuses and puts the caret at the end a frame after the text lands.
  await expect(box).toBeFocused();
  await expect(async () => {
    await box.press("ControlOrMeta+A");
    expect(await box.evaluate(() => getSelection()?.toString())).toBe(before);
  }).toPass();
  await alice.page.keyboard.insertText(after);
  await box.press("Enter");

  await expect(messageRow(alice.page, after)).toBeVisible();
  await expect(messageRow(bob.page, after)).toBeVisible();
  await expect(messageRow(bob.page, before)).toHaveCount(0);
});

test("deleting a message removes it for everyone", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const text = unique("this one goes away");
  const row = await sendMessage(alice.page, text);
  await expect(messageRow(bob.page, text)).toBeVisible();

  await row.hover();
  await row.getByTitle("Delete", { exact: true }).click();
  const confirm = alice.page.getByRole("alertdialog", { name: "Delete message?" });
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(messageRow(alice.page, text)).toHaveCount(0);
  await expect(messageRow(bob.page, text)).toHaveCount(0);
});

test("history is still there after a reload", async ({ newMember }) => {
  const alice = await newMember();

  const text = unique("still here after a reload");
  await sendMessage(alice.page, text);

  await alice.page.reload();
  await expect(channelComposer(alice.page)).toBeVisible();
  await expect(messageRow(alice.page, text)).toBeVisible();
});


/** The box itself, which a mute renames, so one locator covers before and after. */
function editorBox(page: Page) {
  return page.locator(".chat-editor-textarea").first();
}

async function setMute(
  server: { host: string; httpBase: string },
  ownerToken: string,
  targetServerUserId: string,
  muted: boolean,
  expiresInMinutes?: number,
) {
  await withSocket(server.httpBase, (socket) =>
    ask(socket, "server:mute", { accessToken: ownerToken, targetServerUserId, muted, expiresInMinutes: expiresInMinutes ?? null }, "server:mute:success"),
  );
}

test("a mute reaches the composer while somebody is typing, and keeps what they wrote", async ({ owner, newMember, gryt }) => {
  const alice = await newMember();
  const ownerToken = await accessTokenOf(owner.page, gryt.server.host);
  const aliceId = serverUserIdOf(await accessTokenOf(alice.page, gryt.server.host));

  const box = editorBox(alice.page);
  await box.click();
  await alice.page.keyboard.insertText("half a thought");
  await expect(box).toHaveText("half a thought");

  await setMute(gryt.server, ownerToken, aliceId, true, 60);

  await expect(alice.page.getByText(/You\u2019re muted on this server until /)).toBeVisible();
  await expect(box).toHaveText("half a thought");
  await expect(box).toHaveAttribute("contenteditable", "false");

  await setMute(gryt.server, ownerToken, aliceId, false);

  await expect(alice.page.getByText(/You\u2019re muted on this server/)).toHaveCount(0);
  await expect(box).toHaveAttribute("contenteditable", "true");
  await expect(box).toHaveText("half a thought");
});

test("a mute with no end is drawn, and survives a reload with only the member list to go on", async ({ owner, newMember, gryt }) => {
  const alice = await newMember();
  const ownerToken = await accessTokenOf(owner.page, gryt.server.host);
  const aliceId = serverUserIdOf(await accessTokenOf(alice.page, gryt.server.host));

  // Muted with no end, which is the case the server sends no expiresAt for.
  await setMute(gryt.server, ownerToken, aliceId, true);
  await expect(alice.page.getByText("You\u2019re muted on this server.")).toBeVisible();

  /* The mute is drawn off a push here. A reload has only the member list to go
     on, and that is the other way somebody finds out. */
  await alice.page.reload();
  await expect(alice.page.getByText("You\u2019re muted on this server.")).toBeVisible();
  await expect(editorBox(alice.page)).toHaveAttribute("contenteditable", "false");

  await setMute(gryt.server, ownerToken, aliceId, false);
  await expect(alice.page.getByText("You\u2019re muted on this server.")).toHaveCount(0);
});
