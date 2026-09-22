import { io, type Socket } from "socket.io-client";

import { expect, test, uniqueName } from "../support/fixtures";

/**
 * A server from before GRYT-1306 sends every folder, even one whose only channel
 * is hidden from the viewer, so the client leaves it out as well (GRYT-1305).
 */

/** Emits and waits for one reply, the way the settings dialogs talk to the server. */
function ask<T>(socket: Socket, event: string, payload: object, reply: string): Promise<T | undefined> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { socket.off(reply, answer); resolve(undefined); }, 5_000);
    const answer = (data: T) => { clearTimeout(timer); resolve(data); };
    socket.once(reply, answer);
    socket.emit(event, payload);
  });
}

test("a member doesn't see a folder whose only channel is hidden from them", async ({ owner, newMember, gryt }) => {
  const host = gryt.server.host;
  const accessToken = await owner.page.evaluate(
    (host) => localStorage.getItem(`accessToken_${host}`) ?? sessionStorage.getItem(`accessToken_${host}`),
    host,
  );
  expect(accessToken, "the owner's page should hold a token for this server").toBeTruthy();

  // The token names the host it was issued for, so this has to be the same address the page joined.
  const socket = io(gryt.server.httpBase, { transports: ["websocket"], forceNew: true });
  const refused: string[] = [];
  socket.on("server:error", (e: { error?: string; message?: string }) => refused.push(`${e.error}: ${e.message}`));
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });

  const suffix = uniqueName("");
  const templateId = `tpl${suffix}`;
  const channelId = `chan${suffix}`;
  const folderId = `sb-folder${suffix}`;
  const rowId = `sb-row${suffix}`;
  const folderLabel = uniqueName("Staff");
  const channelName = uniqueName("alerts");

  try {
    // Nobody below moderator reads the channel. A guest is what newMember() joins as.
    socket.emit("server:permissions:template:save", {
      accessToken,
      templateId,
      name: uniqueName("Staff only"),
      rules: [
        { roleId: "guest", permission: "read_messages", effect: "deny" },
        { roleId: "member", permission: "read_messages", effect: "deny" },
      ],
    });
    await expect.poll(async () => {
      const reply = await ask<{ templates: { id: string }[] }>(
        socket, "server:permissions:templates:list", { accessToken }, "server:permissions:templates",
      );
      return reply?.templates.some((t) => t.id === templateId) ?? false;
    }, "the template should be saved before a channel is put on it").toBe(true);

    // A folder holding one channel, sent the way the desktop's sidebar editor sends it.
    socket.emit("server:channels:upsert", { accessToken, channelId, name: channelName, type: "text", description: null });
    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: folderId, kind: "folder", label: folderLabel, position: 1000 });
    socket.emit("server:sidebar:item:upsert", {
      accessToken, itemId: rowId, kind: "channel", channelId, position: 1010, parentItemId: folderId,
    });

    const ownersFolder = owner.page.getByRole("button", { name: folderLabel });
    await expect(ownersFolder, "the owner should see the new folder").toBeVisible();
    await expect(owner.page.getByText(channelName, { exact: true })).toBeVisible();

    // Before the channel is scoped the folder is an ordinary one, so the member sees it too.
    const member = await newMember();
    const membersFolder = member.page.getByRole("button", { name: folderLabel });
    await expect(membersFolder, "an ordinary folder is there for a member").toBeVisible();
    await expect(member.page.getByText(channelName, { exact: true })).toBeVisible();

    socket.emit("server:channels:scope:set", { accessToken, channelId, templateId });

    await expect(member.page.getByText(channelName, { exact: true }), "the channel goes, as before").toBeHidden();
    await expect(membersFolder, "an empty folder isn't drawn for a member").toBeHidden();
    await expect(ownersFolder, "the owner keeps every folder, empty ones too").toBeVisible();
    await expect(owner.page.getByText(channelName, { exact: true })).toBeVisible();

    expect(refused, "the server should have taken every admin event").toEqual([]);
  } finally {
    socket.disconnect();
  }
});

test("dragging a folder carries its channels with it", async ({ owner, gryt }) => {
  const host = gryt.server.host;
  const page = owner.page;
  const accessToken = await page.evaluate(
    (host) => localStorage.getItem(`accessToken_${host}`) ?? sessionStorage.getItem(`accessToken_${host}`),
    host,
  );
  const suffix = uniqueName("");
  const folderId = `sb-drag-folder${suffix}`;
  const folderLabel = uniqueName("Ops");
  const above = uniqueName("lounge");
  const kids = [uniqueName("pager"), uniqueName("runbook")];

  const socket = io(gryt.server.httpBase, { transports: ["websocket"], forceNew: true });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", reject);
  });
  try {
    socket.emit("server:channels:upsert", { accessToken, channelId: `chan-above${suffix}`, name: above, type: "text", description: null });
    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: `sb-above${suffix}`, kind: "channel", channelId: `chan-above${suffix}`, position: 6000 });
    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: folderId, kind: "folder", label: folderLabel, position: 6010 });
    kids.forEach((name, i) => {
      const channelId = `chan-kid${i}${suffix}`;
      socket.emit("server:channels:upsert", { accessToken, channelId, name, type: "text", description: null, parentItemId: folderId });
      socket.emit("server:sidebar:item:upsert", { accessToken, itemId: `sb-kid${i}${suffix}`, kind: "channel", channelId, position: 6011 + i, parentItemId: folderId });
    });
    await expect(page.getByText(kids[1], { exact: true })).toBeVisible();
  } finally {
    socket.disconnect();
  }

  const folderRow = page.getByRole("button", { name: folderLabel });
  const rowTops = async () => Promise.all(
    [folderRow, ...kids.map((k) => page.getByText(k, { exact: true }))].map(async (l) => (await l.boundingBox())!.y),
  );
  await folderRow.hover();
  const before = await rowTops();
  const box = (await folderRow.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 30, { steps: 6 });
  // Mid-drag, the channels are drawn inside the folder's row and move with it.
  const during = await rowTops();
  const moved = during.map((y, i) => y - before[i]);
  expect(moved[0], "the folder should follow the pointer").toBeLessThan(-10);
  for (const d of moved.slice(1)) expect(Math.abs(d - moved[0]), "each channel moves as far as its folder").toBeLessThan(2);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 80, { steps: 10 });
  await page.mouse.up();
  // Reloading before the move has gone out would throw it away.
  await expect.poll(() => owner.frames.some((f) => f.includes("server:sidebar:reorder") && f.includes(folderId))).toBe(true);

  // What the server kept, read back after a reload: the folder above, its channels still in it.
  await page.reload();
  await expect(page.getByText(kids[1], { exact: true })).toBeVisible();
  const order = await page.evaluate(
    (names) => {
      const rows = [...document.querySelectorAll("button, span, div")]
        .filter((el) => el.childElementCount === 0 && names.includes(el.textContent ?? ""));
      return [...new Set(rows.map((el) => el.textContent))];
    },
    [folderLabel, above, ...kids],
  );
  expect(order).toEqual([folderLabel, ...kids, above]);
  const indent = async (name: string) =>
    (await page.getByText(name, { exact: true }).first().boundingBox())!.x;
  expect(await indent(kids[0]), "a channel stays indented under its folder").toBeGreaterThan(await indent(above));
});
