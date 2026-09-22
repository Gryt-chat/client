import { type Locator, type Page } from "@playwright/test";
import type { Socket } from "socket.io-client";

import { accessTokenOf, ask, withSocket } from "../support/admin";
import { expect, test, uniqueName } from "../support/fixtures";

/**
 * Permissions set in a folder's own settings reach every channel in it that follows
 * it, and a member who can see none of them is never sent the folder at all.
 */

/** An older server ignores the event, where a newer one says there's no such folder. */
function hasFolderScopes(socket: Socket, accessToken: string): Promise<boolean> {
  return new Promise((resolve) => {
    const answer = (e: { error?: string }) => {
      if (e?.error !== "not_found") return;
      clearTimeout(timer);
      socket.off("server:error", answer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off("server:error", answer);
      resolve(false);
    }, 3_000);
    socket.on("server:error", answer);
    socket.emit("server:folders:scope:get", { accessToken, folderId: "no-such-folder" });
  });
}

/** Right-click a sidebar row and open its settings. */
async function editRow(page: Page, rowName: string): Promise<Locator> {
  await page.getByText(rowName, { exact: true }).first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pick(page: Page, combobox: Locator, option: string): Promise<void> {
  await combobox.click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("a folder's permissions hide it, and a channel with its own keeps them", async ({ owner, newMember, gryt }) => {
  const { host, httpBase } = gryt.server;
  const accessToken = await accessTokenOf(owner.page, host);

  const suffix = uniqueName("");
  const folderId = `sb-folder-perms${suffix}`;
  const folderLabel = uniqueName("Quartermasters");
  const template = uniqueName("Staff only");
  const kept = uniqueName("notices");
  const hidden = uniqueName("rota");
  const hiddenId = `chan-rota${suffix}`;

  const supported = await withSocket(httpBase, async (socket) => {
    if (!(await hasFolderScopes(socket, accessToken))) return false;

    // Nobody below moderator reads it. A guest is what newMember() joins as.
    socket.emit("server:permissions:template:save", {
      accessToken,
      name: template,
      rules: [
        { roleId: "guest", permission: "read_messages", effect: "deny" },
        { roleId: "member", permission: "read_messages", effect: "deny" },
      ],
    });
    await expect.poll(async () => {
      const reply = await ask<{ templates: { name: string }[] }>(
        socket, "server:permissions:templates:list", { accessToken }, "server:permissions:templates",
      );
      return reply.templates.some((t) => t.name === template);
    }, "the template should be saved before the folder is put on it").toBe(true);

    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: folderId, kind: "folder", label: folderLabel, position: 2000 });
    for (const [channelId, name, position] of [[`chan-notices${suffix}`, kept, 2010], [hiddenId, hidden, 2020]] as const) {
      socket.emit("server:channels:upsert", { accessToken, channelId, name, type: "text", description: null, parentItemId: folderId });
      socket.emit("server:sidebar:item:upsert", {
        accessToken, itemId: `sb-${channelId}`, kind: "channel", channelId, position, parentItemId: folderId,
      });
    }
    // Open until the server has them: events that land with the disconnect are dropped.
    await expect(owner.page.getByText(hidden, { exact: true })).toBeVisible();
    return true;
  });
  test.skip(!supported, "the server image has no folder permissions yet (GRYT-1306)");

  // The owner puts the folder on the template from the folder's own settings.
  const folderDialog = await editRow(owner.page, folderLabel);
  await expect(folderDialog.getByText("Who can use this folder")).toBeVisible();
  await pick(owner.page, folderDialog.getByRole("combobox"), template);
  await expect(folderDialog.getByText("Uses a template.", { exact: false })).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(folderDialog).toBeHidden();

  const member = await newMember();
  await expect(member.page.getByRole("button", { name: folderLabel })).toBeHidden();
  await expect(member.page.getByText(kept, { exact: true })).toBeHidden();
  const seen = member.frames.join("\n");
  for (const name of [folderLabel, kept, hidden]) {
    expect(seen, `"${name}" reached the member's socket`).not.toContain(name);
  }

  // One channel gets its own permissions, and the folder comes back holding only it.
  const follow = `Follow the ${folderLabel} folder`;
  const keptDialog = await editRow(owner.page, kept);
  await expect(keptDialog.getByRole("combobox").filter({ hasText: follow })).toBeVisible();
  await expect(keptDialog.getByText(`The ${folderLabel} folder decides who can use this channel.`, { exact: false })).toBeVisible();
  await pick(owner.page, keptDialog.getByRole("combobox").filter({ hasText: follow }), "Everyone");
  await expect(keptDialog.getByText(`Has its own permissions instead of the ${folderLabel} folder's.`)).toBeVisible();

  await expect(member.page.getByRole("button", { name: folderLabel })).toBeVisible();
  await expect(member.page.getByText(kept, { exact: true })).toBeVisible();
  await expect(member.page.getByText(hidden, { exact: true })).toBeHidden();

  // Back to following, which takes the folder away again.
  await pick(owner.page, keptDialog.getByRole("combobox").filter({ hasText: "Everyone" }), follow);
  await expect(keptDialog.getByText(`The ${folderLabel} folder decides who can use this channel.`, { exact: false })).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(keptDialog).toBeHidden();
  await expect(member.page.getByRole("button", { name: folderLabel })).toBeHidden();
  await expect(member.page.getByText(kept, { exact: true })).toBeHidden();

  // Opening a following channel's settings and closing them again changes nothing.
  const hiddenDialog = await editRow(owner.page, hidden);
  await expect(hiddenDialog.getByRole("combobox").filter({ hasText: follow })).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(hiddenDialog).toBeHidden();
  const scope = await withSocket(httpBase, (socket) =>
    ask<{ followsFolder?: boolean }>(
      socket, "server:channels:scope:get", { accessToken, channelId: hiddenId }, "server:channels:scope",
    ),
  );
  expect(scope.followsFolder, "closing the dialog gave the channel permissions of its own").toBe(true);
});

/** Drags a sidebar row right, which drops it into the folder above it. */
async function dragIntoFolderAbove(page: Page, rowName: string): Promise<void> {
  const row = page.getByText(rowName, { exact: true }).first();
  // Hover waits for the row to stop moving, which it does for a moment after the last drop.
  await row.hover();
  const box = await row.boundingBox();
  if (!box) throw new Error(`No row for ${rowName}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y, { steps: 12 });
  await page.mouse.up();
}

test("a channel dragged into a folder follows it, and one with its own permissions asks first", async ({ owner, newMember, gryt }) => {
  const { host, httpBase } = gryt.server;
  const accessToken = await accessTokenOf(owner.page, host);

  const suffix = uniqueName("");
  const folderId = `sb-folder-move${suffix}`;
  const folderLabel = uniqueName("Back office");
  const template = uniqueName("Staff only");
  const names = { plain: uniqueName("lobby"), mine: uniqueName("minutes"), kept: uniqueName("payroll") };
  const ids = { plain: `chan-lobby${suffix}`, mine: `chan-minutes${suffix}`, kept: `chan-payroll${suffix}` };
  // Something harmless, so the channel has permissions of its own that a guest can still read through.
  const ownRules = [{ roleId: "guest", permission: "add_reactions", effect: "deny" }];

  const followsFolder = (channelId: string) =>
    withSocket(httpBase, (socket) =>
      ask<{ followsFolder?: boolean; folder?: { id: string } | null }>(
        socket, "server:channels:scope:get", { accessToken, channelId }, "server:channels:scope",
        (reply) => (reply as { channelId?: string }).channelId === channelId,
      ),
    );

  const supported = await withSocket(httpBase, async (socket) => {
    if (!(await hasFolderScopes(socket, accessToken))) return false;

    socket.emit("server:permissions:template:save", {
      accessToken,
      name: template,
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
      templateId = reply.templates.find((t) => t.name === template)?.id;
      return Boolean(templateId);
    }, "the template should be saved before the folder is put on it").toBe(true);

    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: folderId, kind: "folder", label: folderLabel, position: 5000 });
    socket.emit("server:folders:scope:set", { accessToken, folderId, templateId });
    let position = 5010;
    for (const key of ["plain", "mine", "kept"] as const) {
      socket.emit("server:channels:upsert", { accessToken, channelId: ids[key], name: names[key], type: "text", description: null });
      socket.emit("server:sidebar:item:upsert", {
        accessToken, itemId: `sb-${ids[key]}`, kind: "channel", channelId: ids[key], position, parentItemId: null,
      });
      position += 10;
    }
    // Scopes only once the channels exist, or the server has nothing to put them on.
    await expect(owner.page.getByText(names.kept, { exact: true })).toBeVisible();
    // Everyone picked by hand, so it stops following folders without a scope of its own.
    socket.emit("server:channels:scope:set", { accessToken, channelId: ids.plain, templateId: null });
    for (const key of ["mine", "kept"] as const) {
      socket.emit("server:channels:scope:set", { accessToken, channelId: ids[key], custom: true, rules: ownRules });
      await expect.poll(async () => {
        const reply = await ask<{ channelId: string; scopeId?: string | null }>(
          socket, "server:channels:scope:get", { accessToken, channelId: ids[key] }, "server:channels:scope",
          (r) => r.channelId === ids[key],
        );
        return Boolean(reply.scopeId);
      }, `${names[key]} should have permissions of its own`).toBe(true);
    }
    return true;
  });
  test.skip(!supported, "the server image has no folder permissions yet (GRYT-1306)");

  const member = await newMember();
  for (const name of Object.values(names)) await expect(member.page.getByText(name, { exact: true })).toBeVisible();

  const confirm = owner.page.getByRole("alertdialog");

  // Nothing of its own: it goes in and follows, with no question.
  await dragIntoFolderAbove(owner.page, names.plain);
  await expect(member.page.getByText(names.plain, { exact: true })).toBeHidden();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await followsFolder(ids.plain)).followsFolder).toBe(true);

  // Its own permissions, kept: it moves and a guest can still read it.
  await dragIntoFolderAbove(owner.page, names.mine);
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(`#${names.mine} has its own permissions.`);
  await confirm.getByRole("button", { name: "Keep its own" }).click();
  await expect(confirm).toBeHidden();
  await expect.poll(async () => (await followsFolder(ids.mine)).folder?.id).toBe(folderId);
  expect((await followsFolder(ids.mine)).followsFolder).toBe(false);
  await expect(member.page.getByText(names.mine, { exact: true })).toBeVisible();

  // Called off: it stays where it was.
  await dragIntoFolderAbove(owner.page, names.kept);
  await expect(confirm).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  expect((await followsFolder(ids.kept)).folder ?? null).toBeNull();

  // Following instead: the folder's template takes it away from the guest.
  await dragIntoFolderAbove(owner.page, names.kept);
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Follow folder" }).click();
  await expect(member.page.getByText(names.kept, { exact: true })).toBeHidden();
  await expect.poll(async () => (await followsFolder(ids.kept)).followsFolder).toBe(true);
});
