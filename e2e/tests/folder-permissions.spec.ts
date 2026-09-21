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
  const keptDialog = await editRow(owner.page, kept);
  await expect(keptDialog.getByText(`Follows the ${folderLabel} folder.`, { exact: false })).toBeVisible();
  await pick(owner.page, keptDialog.getByRole("combobox").filter({ hasText: template }), "Everyone");
  await expect(keptDialog.getByText(`Has its own permissions instead of the ${folderLabel} folder's.`)).toBeVisible();

  await expect(member.page.getByRole("button", { name: folderLabel })).toBeVisible();
  await expect(member.page.getByText(kept, { exact: true })).toBeVisible();
  await expect(member.page.getByText(hidden, { exact: true })).toBeHidden();

  // Back to following, which takes the folder away again.
  await keptDialog.getByRole("button", { name: "Follow folder" }).click();
  await expect(keptDialog.getByText(`Follows the ${folderLabel} folder.`, { exact: false })).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(keptDialog).toBeHidden();
  await expect(member.page.getByRole("button", { name: folderLabel })).toBeHidden();
  await expect(member.page.getByText(kept, { exact: true })).toBeHidden();

  // Opening a following channel's settings and closing them again changes nothing.
  const hiddenDialog = await editRow(owner.page, hidden);
  await expect(hiddenDialog.getByText(`Follows the ${folderLabel} folder.`, { exact: false })).toBeVisible();
  await owner.page.keyboard.press("Escape");
  await expect(hiddenDialog).toBeHidden();
  const scope = await withSocket(httpBase, (socket) =>
    ask<{ followsFolder?: boolean }>(
      socket, "server:channels:scope:get", { accessToken, channelId: hiddenId }, "server:channels:scope",
    ),
  );
  expect(scope.followsFolder, "closing the dialog gave the channel permissions of its own").toBe(true);
});
