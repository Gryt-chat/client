import type { Locator, Page } from "@playwright/test";

import { accessTokenOf, withSocket } from "../support/admin";
import { userValue } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";
import type { GrytServer } from "../support/server";

function channelsNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Channels" });
}

interface DrawnRow {
  name: string;
  /** Where the row's button starts, from layout. A hovered row is scaled, which moves its box. */
  left: number;
}

/** The sidebar's rows in drawn order. The header's buttons have labels, and the rows don't. */
function drawnRows(page: Page): Promise<DrawnRow[]> {
  return channelsNav(page).evaluate((nav) =>
    [...nav.querySelectorAll<HTMLElement>("button:not([aria-label])")].map((button) => {
      let left = 0;
      for (let node: HTMLElement | null = button; node; node = node.offsetParent as HTMLElement | null) left += node.offsetLeft;
      return { name: (button.textContent ?? "").trim(), left };
    }),
  );
}

/** The first row is always at the top level, so it's where an unindented row starts. */
async function topLevelLeft(page: Page): Promise<number | undefined> {
  return (await drawnRows(page))[0]?.left;
}

/** `count` rows from the one called `first`, by name. */
async function rowsFrom(page: Page, first: string, count: number): Promise<string[]> {
  const names = (await drawnRows(page)).map((row) => row.name);
  const at = names.indexOf(first);
  return at < 0 ? [] : names.slice(at, at + count);
}

async function leftOf(page: Page, name: string): Promise<number | undefined> {
  return (await drawnRows(page)).find((row) => row.name === name)?.left;
}

/** Arrows down an open menu to `name` and presses Enter on it, the way a keyboard user would. */
async function chooseWithKeyboard(page: Page, name: string) {
  const item = page.getByRole("menuitem", { name, exact: true });
  await expect(item).toBeVisible();
  for (let step = 0; step < 12; step++) {
    if (await item.evaluate((el) => el.hasAttribute("data-highlighted"))) break;
    await page.keyboard.press("ArrowDown");
  }
  await expect(item).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("Enter");
}

/** Fills the create dialog from the keyboard: the name field has focus, and Enter creates. */
async function createFromDialog(page: Page, name: string, folder: string | null) {
  const dialog = page.getByRole("dialog", { name: "Create channel" });
  await expect(dialog).toBeVisible();
  if (folder) await expect(dialog.getByRole("combobox").filter({ hasText: folder })).toBeVisible();
  const field = dialog.getByPlaceholder("support");
  await expect(field).toBeFocused();
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

/** A folder holding a channel at each position given, sent the way the desktop's sidebar editor sends it. */
async function seedFolder(owner: Page, server: GrytServer, positions: number[]) {
  const accessToken = await accessTokenOf(owner, server.host);
  const suffix = uniqueName("");
  const folder = uniqueName("Folder");
  const folderId = `sb-folder${suffix}`;
  const names = positions.map((_, i) => uniqueName(`room${i + 1}`));

  await withSocket(server.httpBase, async (socket) => {
    const refused: string[] = [];
    socket.on("server:error", (e: { error?: string; message?: string }) => refused.push(`${e.error}: ${e.message}`));
    socket.emit("server:sidebar:item:upsert", { accessToken, itemId: folderId, kind: "folder", label: folder, position: 5000 });
    positions.forEach((position, i) => {
      const channelId = `chan${suffix}-${i}`;
      socket.emit("server:channels:upsert", { accessToken, channelId, name: names[i], type: "text", description: null });
      socket.emit("server:sidebar:item:upsert", {
        accessToken, itemId: `sb-row${suffix}-${i}`, kind: "channel", channelId, position, parentItemId: folderId,
      });
    });
    await expect.poll(() => rowsFrom(owner, folder, names.length + 1), "the seeded folder should be drawn").toEqual([folder, ...names]);
    expect(refused, "the server should have taken every setup event").toEqual([]);
  });
  return { folder, names };
}

test("the + in the server header makes a channel or a folder", async ({ owner }) => {
  const page = owner.page;
  const plus = channelsNav(page).getByRole("button", { name: "Create channel or folder" });
  await expect(plus).toBeVisible();

  await plus.click();
  await expect(page.getByRole("menuitem")).toHaveText(["Channel", "Folder"]);
  await page.getByRole("menuitem", { name: "Channel", exact: true }).click();
  const name = uniqueName("plus");
  const dialog = page.getByRole("dialog", { name: "Create channel" });
  await dialog.getByPlaceholder("support").fill(name);
  await dialog.getByRole("button", { name: "Create channel" }).click();
  await expect(dialog).toBeHidden();

  // Last in the list and not in a folder, so not indented.
  await expect.poll(async () => (await drawnRows(page)).at(-1)?.name, "the new channel should be the last row").toBe(name);
  expect(await leftOf(page, name)).toBe(await topLevelLeft(page));

  const folders = channelsNav(page).getByRole("button", { name: "New folder", exact: true });
  const before = await folders.count();
  await plus.click();
  await page.getByRole("menuitem", { name: "Folder", exact: true }).click();
  await expect(folders).toHaveCount(before + 1);

  // Both used to be in the server menu. They are only under the + now.
  await channelsNav(page).getByRole("button", { name: "Server menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Unpin sidebar" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: /^Create/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitem", { name: "Unpin sidebar" })).toBeHidden();
});

test("the pin is in the server menu, and a member who can't manage channels gets no +", async ({ newMember }) => {
  const { page } = await newMember();
  const nav = channelsNav(page);
  await expect(nav.getByRole("button", { name: "Server menu" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Create channel or folder" })).toHaveCount(0);
  await expect(nav.getByRole("button", { name: /pin sidebar/i })).toHaveCount(0);

  await nav.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Unpin sidebar" }).click();
  await expect.poll(() => userValue<boolean>(page, "pinChannelsSidebar")).toBe(false);

  // Unpinned, the list folds away once the pointer is somewhere else.
  await page.mouse.move(900, 400);
  await expect(nav.getByRole("button", { name: "General", exact: true })).toBeHidden();
});

test("Create channel in this folder picks the folder and puts the channel last in it", async ({ owner, gryt }) => {
  const page = owner.page;
  const { folder, names } = await seedFolder(page, gryt.server, [5010, 5020]);
  const folderRow = channelsNav(page).getByRole("button", { name: folder, exact: true });

  // The edit dialog used to call a folder a spacer.
  await folderRow.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Folder settings" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Folder settings" })).toBeHidden();

  await folderRow.click({ button: "right" });
  await expect(page.getByRole("group", { name: folder }), "the menu is headed with the folder's name").toBeVisible();
  await chooseWithKeyboard(page, "Create channel in this folder");
  const name = uniqueName("inside");
  await createFromDialog(page, name, folder);

  await expect.poll(() => rowsFrom(page, folder, 4), "the new channel should be last in the folder").toEqual([folder, ...names, name]);
  expect(await leftOf(page, name), "indented like the folder's other channels").toBe(await leftOf(page, names[0]));
  expect(await leftOf(page, name)).toBeGreaterThan((await topLevelLeft(page)) ?? Infinity);

  // Shutting the folder takes the new channel with it.
  await folderRow.click();
  await expect(channelsNav(page).getByRole("button", { name, exact: true })).toBeHidden();
  await channelsNav(page).getByRole("button", { name: new RegExp(`^${folder}`) }).click();
  await expect(channelsNav(page).getByRole("button", { name, exact: true })).toBeVisible();
});

test("Create channel below puts the channel right under the one clicked, in its folder", async ({ owner, gryt }) => {
  const page = owner.page;
  // The second pair are one apart, so there's no whole number between them and it takes a reorder.
  const { folder, names } = await seedFolder(page, gryt.server, [5010, 5020, 5021]);
  const [first, second, third] = names;

  // Keyboard only: focus the row, open its menu with the menu key, arrow to the item.
  await channelsNav(page).getByRole("button", { name: first, exact: true }).focus();
  await page.keyboard.press("ContextMenu");
  await chooseWithKeyboard(page, "Create channel below");
  const roomy = uniqueName("below");
  await createFromDialog(page, roomy, folder);
  await expect.poll(() => rowsFrom(page, folder, 5)).toEqual([folder, first, roomy, second, third]);

  await channelsNav(page).getByRole("button", { name: second, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Create channel below", exact: true }).click();
  const tight = uniqueName("tight");
  await createFromDialog(page, tight, folder);
  await expect.poll(() => rowsFrom(page, folder, 6)).toEqual([folder, first, roomy, second, tight, third]);

  for (const name of [roomy, tight]) {
    expect(await leftOf(page, name), `${name} should be inside the folder`).toBe(await leftOf(page, first));
  }
});
