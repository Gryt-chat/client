import { io } from "socket.io-client";

import { accessTokenOf, ask, withSocket } from "../support/admin";
import { channelComposer, composer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";

/**
 * Neither an unjoined socket nor a member gated out of a channel should be
 * sent its activity (GRYT-1245, fixed in server#192 / server 1.10.15).
 */

test("a raw socket that never joined gets none of a public channel's message events", async ({ newMember, gryt }) => {
  const alice = await newMember();

  // No accessToken, no join event: this is what anyone on the internet can open.
  const raw = io(gryt.server.httpBase, { transports: ["websocket"], forceNew: true });
  // "server:info" is sent to any connection, joined or not; it carries no channel activity.
  const seen: string[] = [];
  raw.onAny((event) => { if (event !== "server:info") seen.push(event); });
  await new Promise<void>((resolve, reject) => {
    raw.once("connect", () => resolve());
    raw.once("connect_error", reject);
  });

  try {
    const text = unique("a message the raw socket should never see");
    const row = await sendMessage(alice.page, text);

    await row.hover();
    await row.getByTitle("React with another emoji").click();
    await alice.page.getByPlaceholder("Search emojis...").fill("thumbsup");
    await alice.page.getByTitle(":thumbsup:").click();
    await expect(row.getByRole("button", { name: "👍 1" })).toBeVisible();

    const after = `${text} (edited)`;
    await row.click({ button: "right" });
    await alice.page.getByRole("menuitem", { name: "Edit Message" }).click();
    const box = channelComposer(alice.page);
    await expect(box).toHaveText(text);
    await alice.page.keyboard.press("ControlOrMeta+A");
    await alice.page.keyboard.insertText(after);
    await box.press("Enter");
    const editedRow = messageRow(alice.page, after);
    await expect(editedRow).toBeVisible();

    await editedRow.hover();
    await editedRow.getByTitle(/^(Start|Open) thread$/).click();
    const thread = alice.page.getByRole("complementary", { name: "Thread" });
    await expect(thread).toBeVisible();
    const reply = unique("first reply");
    const threadBox = composer(alice.page, "Reply to thread…");
    await threadBox.click();
    await alice.page.keyboard.insertText(reply);
    await threadBox.press("Enter");
    await expect(thread.getByText(reply, { exact: true })).toBeVisible();
    await alice.page.keyboard.press("Escape");
    await expect(thread).toBeHidden();

    await editedRow.hover();
    await editedRow.getByTitle("Delete", { exact: true }).click();
    const confirm = alice.page.getByRole("alertdialog", { name: "Delete message?" });
    await confirm.getByRole("button", { name: "Delete" }).click();
    await expect(messageRow(alice.page, after)).toHaveCount(0);

    // Every step above waited for the member's own page to confirm the server
    // had processed it, so anything the raw socket was going to get would have arrived by now.
    expect(seen, "an unjoined socket received server events it was never sent to").toEqual([]);
  } finally {
    raw.disconnect();
  }
});

test("a member who joined but can't see a gated channel gets nothing from it", async ({ owner, newMember, gryt }) => {
  const { host, httpBase } = gryt.server;
  const accessToken = await accessTokenOf(owner.page, host);

  const suffix = uniqueName("");
  const channelId = `chan-gated${suffix}`;
  const channelName = uniqueName("boardroom");
  const templateName = uniqueName("Staff only");

  await withSocket(httpBase, async (socket) => {
    socket.emit("server:permissions:template:save", {
      accessToken,
      name: templateName,
      rules: [
        { roleId: "guest", permission: "read_messages", effect: "deny" },
        { roleId: "member", permission: "read_messages", effect: "deny" },
      ],
    });
    let templateId: string | undefined;
    await expect.poll(async () => {
      const reply = await ask<{ templates: { id: string; name: string }[] }>(
        socket, "server:permissions:templates:list", { accessToken }, "server:permissions:templates",
      );
      templateId = reply.templates.find((t) => t.name === templateName)?.id;
      return Boolean(templateId);
    }, "the template should be saved before the channel is put on it").toBe(true);

    socket.emit("server:channels:upsert", { accessToken, channelId, name: channelName, type: "text", description: null });
    // Still unscoped here, so the owner can click in before it's gated for anyone else.
    await owner.page.getByRole("button", { name: channelName, exact: true }).click();
    await expect(channelComposer(owner.page, channelName)).toBeVisible();

    socket.emit("server:channels:scope:set", { accessToken, channelId, templateId });
    // The scope has to be committed before the member below joins, or they
    // can catch the channel still unscoped in their initial sync.
    await expect.poll(async () => {
      const reply = await ask<{ channelId: string; scopeId?: string | null }>(
        socket, "server:channels:scope:get", { accessToken, channelId }, "server:channels:scope",
        (r) => r.channelId === channelId,
      );
      return Boolean(reply.scopeId);
    }, "the channel should be gated before the member joins").toBe(true);
  });

  // Joined after the channel was already gated, so it's never in what they're sent.
  const member = await newMember();
  await expect(member.page.getByText(channelName, { exact: true })).toBeHidden();

  const text = unique("a message the gated member should never see");
  await sendMessage(owner.page, text, channelName);

  const seen = member.frames.join("\n");
  for (const needle of [text, channelName]) {
    expect(seen, `"${needle}" reached the gated member's socket`).not.toContain(needle);
  }
});
