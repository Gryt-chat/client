import { readFileSync } from "node:fs";

import type { Page } from "@playwright/test";

import {
  attachAndSend, clipboardHoldsImage, composer, CONFIRMED_ROW, fixture, joinServer, type Member, membersPanel, messageRow,
  pasteText, savedFile, sendMessage, sha256, unique,
} from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";
import { pastWindowEdge } from "../support/overflow";

const ENCRYPTED = "This conversation is encrypted.";

async function openDmFromMembers(from: Member, to: Member) {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
  await expect(composer(from.page, `Message ${to.name}`)).toBeVisible();
}

async function openDmFromList(page: Page, withName: string) {
  await page.getByRole("button", { name: "Direct messages" }).click();
  await page.getByRole("button", { name: withName }).click();
  await expect(composer(page, `Message ${withName}`)).toBeVisible();
}

async function send(page: Page, to: string, text: string) {
  const box = composer(page, `Message ${to}`);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(messageRow(page, text)).toBeVisible();
}

test("clicking a member opens a DM with them", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  await openDmFromMembers(bob, alice);

  await expect(bob.page.getByText(`You and ${alice.name}.`)).toBeVisible();
  await expect(bob.page.getByText(ENCRYPTED)).toBeVisible();
});

test("a DM lights no server in the rail, and its header names the server instead", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  const rail = bob.page.locator('[data-gryt="sidebar"]');
  const server = rail.getByRole("button", { name: "Gryt E2E", exact: true });
  const dmButton = rail.getByRole("button", { name: "Direct messages" });
  await expect(server).toHaveAttribute("aria-current", "true");

  await openDmFromMembers(bob, alice);
  await expect(dmButton).toHaveAttribute("aria-pressed", "true");
  // The server is still underneath, holding the conversation's socket. Only the rail stops lighting it.
  await expect(rail.locator("[aria-current]")).toHaveCount(0);
  await expect(server).toHaveCSS("opacity", "0.5");

  const header = bob.page.locator('[data-gryt="chat-header"]');
  await expect(header).toContainText(alice.name);
  await expect(header.getByTitle("Gryt E2E")).toBeVisible();

  const row = bob.page.getByRole("button", { name: alice.name });
  await expect(row.getByRole("img", { name: "Gryt E2E" })).toBeVisible();
  await expect(row).not.toContainText("Gryt E2E");

  await dmButton.click();
  await expect(server).toHaveAttribute("aria-current", "true");
});

test("a DM in a window too narrow for the rail stays inside it, with the list a press away", async ({ newMember }) => {
  // One word with nowhere to wrap, so the header has to cut it short to stay inside the window.
  const alice = await newMember({ nickname: uniqueName("Aurora_Borealis_Nordlys") });
  const bob = await newMember();
  const { page } = bob;
  await openDmFromMembers(bob, alice);
  await send(page, alice.name, unique("in a small window"));

  const back = page.locator('[data-gryt="chat-header"]').getByRole("button", { name: "Back to messages" });
  const box = composer(page, `Message ${alice.name}`);
  for (const width of [520, 400, 300]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(back).toBeVisible();
    await expect.poll(() => pastWindowEdge(page), { message: `the conversation at ${width}px` }).toEqual([]);

    await back.click();
    const row = page.getByRole("button", { name: alice.name });
    await expect(row).toBeVisible();
    await expect(box).toBeHidden();
    await expect.poll(() => pastWindowEdge(page), { message: `the list at ${width}px` }).toEqual([]);

    await row.click();
    await expect(box).toBeVisible();
  }
});

/** The + next to Messages, from wherever the page is. */
async function newMessageDialog(page: Page) {
  const heading = page.getByRole("heading", { name: "Messages" });
  if (!(await heading.isVisible())) await page.getByRole("button", { name: "Direct messages" }).click();
  await page.getByRole("button", { name: "New message" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "New message" })).toBeVisible();
  return dialog;
}

test("the + next to Messages opens a conversation with somebody", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const dialog = await newMessageDialog(bob.page);
  await dialog.getByPlaceholder("Search people").fill(alice.name);
  await expect(dialog.getByRole("button").filter({ hasText: bob.name })).toHaveCount(0);
  await dialog.getByRole("button").filter({ hasText: alice.name }).click();

  await expect(dialog).toBeHidden();
  await expect(composer(bob.page, `Message ${alice.name}`)).toBeVisible();
  await expect(bob.page.getByRole("button", { name: "New group" })).toHaveCount(0);
});

test("Create group makes a group everybody in it can see, then asks for a name", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  const carol = await newMember();

  const dialog = await newMessageDialog(carol.page);
  await dialog.getByRole("button", { name: "Create group" }).click();
  await expect(dialog.getByRole("heading", { name: "New group" })).toBeVisible();
  for (const who of [alice, bob]) {
    await dialog.getByPlaceholder("Search people").fill(who.name);
    await dialog.locator("label").filter({ hasText: who.name }).getByRole("checkbox").click();
  }
  await dialog.getByRole("button", { name: "Create group" }).click();

  // The group is open behind the name step before anybody has written in it.
  await expect(dialog.getByRole("heading", { name: "Name and picture" })).toBeVisible();
  const name = unique("Weekend plans");
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(composer(carol.page, `Message ${name}`)).toBeVisible();
  await expect(carol.page.getByRole("button", { name: "Group settings" })).toBeVisible();

  for (const who of [alice, bob]) {
    await who.page.getByRole("button", { name: "Direct messages" }).click();
    await who.page.getByRole("button").filter({ hasText: name }).click();
    await expect(composer(who.page, `Message ${name}`)).toBeVisible();
  }

  // A group's header carries Group settings where a DM's has nothing, and still fits.
  await carol.page.setViewportSize({ width: 300, height: 800 });
  await expect(carol.page.getByRole("button", { name: "Group settings" })).toBeVisible();
  await expect.poll(() => pastWindowEdge(carol.page), { message: "the group at 300px" }).toEqual([]);
});

test("an encrypted DM: each side reads the other's message", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const question = unique("are you reading this");
  await openDmFromMembers(bob, alice);
  await expect(bob.page.getByText(ENCRYPTED)).toBeVisible();
  await send(bob.page, alice.name, question);

  await openDmFromList(alice.page, bob.name);
  await expect(alice.page.getByText(ENCRYPTED)).toBeVisible();
  await expect(messageRow(alice.page, question)).toBeVisible();

  const answer = unique("loud and clear");
  await send(alice.page, bob.name, answer);
  await expect(messageRow(bob.page, answer)).toBeVisible();

  for (const member of [alice, bob]) {
    // Both apps and the server do MLS, so the messages go as MLS ciphertext rather than as sealed ones.
    const mlsSend = member.frames.filter((frame) => /^4\d*-?\d*\["mls:send"/.test(frame));
    expect(mlsSend, `${member.name}'s socket carried no MLS message at all`).not.toEqual([]);
    const leaked = member.frames.filter((frame) => frame.includes(question) || frame.includes(answer));
    expect(leaked, `${member.name} sent or got a DM in plain text over the socket`).toEqual([]);
  }
});

test("an MLS DM carries a reply, an edit, a file and a delete, and hides the lines for older apps", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  const hello = unique("hello over MLS");
  await openDmFromMembers(bob, alice);
  await send(bob.page, alice.name, hello);
  await openDmFromList(alice.page, bob.name);
  await expect(messageRow(alice.page, hello)).toBeVisible();

  const helloRow = messageRow(alice.page, hello);
  await helloRow.click({ button: "right" });
  await alice.page.getByRole("menuitem", { name: "Reply" }).click();
  const reply = unique("a reply");
  await send(alice.page, bob.name, reply);
  await expect(messageRow(bob.page, reply)).toContainText(hello);

  // Reactions go over MLS too, both ways, and a second tap takes one off (GRYT-1524).
  const bobsReply = messageRow(bob.page, reply);
  // Hovered again if the row was still sliding in and the toolbar went with the pointer.
  await expect(async () => {
    await bobsReply.hover();
    await bobsReply.getByTitle("React with another emoji").click({ timeout: 2000 });
  }).toPass();
  await bob.page.getByPlaceholder("Search emojis...").fill("thumbsup");
  await bob.page.getByTitle(":thumbsup:").click();
  await expect(bobsReply.getByRole("button", { name: "👍 1" })).toBeVisible();
  const alicesReply = messageRow(alice.page, reply);
  await expect(alicesReply.getByRole("button", { name: "👍 1" })).toBeVisible();
  await alicesReply.getByRole("button", { name: "👍 1" }).click();
  await expect(bobsReply.getByRole("button", { name: "👍 2" })).toBeVisible();
  await bobsReply.getByRole("button", { name: "👍 2" }).click();
  await expect(alicesReply.getByRole("button", { name: "👍 1" })).toBeVisible();
  await expect(bobsReply.getByRole("button", { name: "👍 1" })).toBeVisible();
  // Report is offered now that the server takes the reporter's copy (server 1.10.38, GRYT-1557).
  await bobsReply.click({ button: "right" });
  await expect(bob.page.getByRole("menuitem", { name: "Reply" })).toBeVisible();
  await expect(bob.page.getByRole("menuitem", { name: "Report" })).toBeVisible();
  await bob.page.keyboard.press("Escape");

  const edited = `${hello} (edited)`;
  await messageRow(bob.page, hello).first().click({ button: "right" });
  await bob.page.getByRole("menuitem", { name: "Edit Message" }).click();
  const box = composer(bob.page, `Message ${alice.name}`);
  await expect(box).toHaveText(hello);
  await expect(async () => {
    await box.press("ControlOrMeta+A");
    expect(await box.evaluate(() => getSelection()?.toString())).toBe(hello);
  }).toPass();
  await bob.page.keyboard.insertText(edited);
  await box.press("Enter");
  await expect(messageRow(alice.page, edited).first()).toBeVisible();

  await attachAndSend(bob.page, [fixture("gradient.png")], box);
  const image = alice.page.locator(`${CONFIRMED_ROW} img[alt="gradient.png"]`);
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(96);

  const doomed = messageRow(bob.page, edited).first();
  await doomed.hover();
  await doomed.getByTitle("Delete", { exact: true }).click();
  await bob.page.getByRole("alertdialog", { name: "Delete message?" }).getByRole("button", { name: "Delete" }).click();
  await expect(messageRow(alice.page, edited)).toHaveCount(0);

  // Still there after a reload, from the archive, and no "update Gryt" lines among them.
  await alice.page.locator('[data-gryt="sidebar"]').getByRole("button", { name: "Gryt E2E", exact: true }).click();
  await alice.page.reload();
  // A confirmed row means her socket is joined again, so the DM's history can load.
  await sendMessage(alice.page, unique("back from a reload"));
  await openDmFromList(alice.page, bob.name);
  await expect(messageRow(alice.page, reply)).toBeVisible();
  await expect(messageRow(alice.page, reply).getByRole("button", { name: "👍 1" })).toBeVisible();
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect(alice.page.getByText("Update Gryt to read it")).toHaveCount(0);
  await expect(alice.page.locator(CONFIRMED_ROW).filter({ hasText: "Not encrypted" })).toHaveCount(0);
  await expect(messageRow(alice.page, edited)).toHaveCount(0);
});

test("messages that arrive before a DM's history loads go below it", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const older = [unique("older one"), unique("older two"), unique("older three")];
  const newer = [unique("newer one"), unique("newer two")];

  await openDmFromMembers(bob, alice);
  for (const text of older) await send(bob.page, alice.name, text);

  // A reload empties alice's cache, so the older messages are only on the server now.
  await alice.page.reload();
  // A confirmed row means her socket is joined again, so she hears what bob sends next.
  await sendMessage(alice.page, unique("back from a reload"));

  for (const text of newer) await send(bob.page, alice.name, text);
  // Unread counts start at the reload, so 2 is both newer messages reaching the closed DM.
  const dmButton = alice.page.getByRole("button", { name: "Direct messages" });
  await expect(dmButton.locator("xpath=..")).toContainText("2");

  await openDmFromList(alice.page, bob.name);
  const texts = [...older, ...newer];
  const order = async () => {
    const rows = await alice.page.locator(CONFIRMED_ROW).allTextContents();
    return rows.map((row) => texts.findIndex((text) => row.includes(text))).filter((i) => i >= 0);
  };
  await expect.poll(order).toEqual([0, 1, 2, 3, 4]);
});

test("an encrypted DM's files save and copy as the files that were sent, with no link to the ciphertext", async ({ newMember, gryt }) => {
  const alice = await newMember();
  const bob = await newMember();
  const hashOf = (name: string) => sha256(readFileSync(fixture(name)));

  await openDmFromMembers(bob, alice);
  await expect(bob.page.getByText(ENCRYPTED)).toBeVisible();
  await attachAndSend(bob.page, [fixture("gradient.png"), fixture("notes.txt"), fixture("clip.webm")], composer(bob.page, `Message ${alice.name}`));

  const page = alice.page;
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const fileFetches: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(`${gryt.server.httpBase}/api/uploads/files/`)) fileFetches.push(request.url());
  });
  await openDmFromList(page, bob.name);

  const image = page.locator(`${CONFIRMED_ROW} img[alt="gradient.png"]`);
  await expect(image).toHaveAttribute("src", /^blob:/);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(96);

  await image.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Save As" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Copy Link" })).toHaveCount(0);
  await expect(page.getByRole("menuitem", { name: "Open in Browser" })).toHaveCount(0);
  expect(await savedFile(page, () => page.getByRole("menuitem", { name: "Save As" }).click())).toEqual({
    name: "gradient.png",
    sha256: hashOf("gradient.png"),
  });

  await image.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy Image" }).click();
  await expect.poll(() => clipboardHoldsImage(page, "gradient.png")).toBe(true);

  await image.click();
  const lightboxSave = page.getByRole("button", { name: "Save image" });
  expect(await savedFile(page, () => lightboxSave.click())).toEqual({ name: "gradient.png", sha256: hashOf("gradient.png") });
  await page.keyboard.press("Escape");
  await expect(lightboxSave).toBeHidden();

  const card = page.locator(".chat-file-card").filter({ hasText: "notes.txt" });
  expect(await savedFile(page, () => card.getByRole("button", { name: "Download" }).click())).toEqual({
    name: "notes.txt",
    sha256: hashOf("notes.txt"),
  });

  const player = page.locator(`${CONFIRMED_ROW} .chat-video-player`).filter({ hasText: "clip.webm" });
  await player.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Copy Link" })).toHaveCount(0);
  expect(await savedFile(page, () => page.getByRole("menuitem", { name: "Save As" }).click())).toEqual({
    name: "clip.webm",
    sha256: hashOf("clip.webm"),
  });
  const video = player.locator("video");
  await expect(video, "Save As started the video").not.toHaveAttribute("src", /.+/);

  // The encrypted player's own button, over the inert one inside it.
  await player.locator(':scope > button[aria-label="Play video"]').click();
  await expect(video).toHaveAttribute("src", /^blob:/);
  const fetchesAfterPlay = fileFetches.length;
  await player.click({ button: "right" });
  expect(await savedFile(page, () => page.getByRole("menuitem", { name: "Save As" }).click())).toEqual({
    name: "clip.webm",
    sha256: hashOf("clip.webm"),
  });
  expect(fileFetches.length, "Save As downloaded a video that was already decrypted for play").toBe(fetchesAfterPlay);
});

test("an encrypted DM's video has its own shape before it is decrypted, and keeps it when it plays", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  await openDmFromMembers(bob, alice);
  await expect(bob.page.getByText(ENCRYPTED)).toBeVisible();
  await attachAndSend(bob.page, [fixture("clip.webm")], composer(bob.page, `Message ${alice.name}`));

  const page = alice.page;
  await openDmFromList(page, bob.name);
  const player = page.locator(`${CONFIRMED_ROW} .chat-video-player`).filter({ hasText: "clip.webm" });
  const frame = player.locator(".gryt-video-player");
  await expect(frame).toBeVisible();

  // clip.webm is 160x120. The size came inside the sealed message; the server never saw it.
  const before = (await frame.boundingBox())!;
  expect(before.width / before.height).toBeCloseTo(4 / 3, 2);

  await player.locator(':scope > button[aria-label="Play video"]').click();
  await expect(player.locator("video")).toHaveJSProperty("videoWidth", 160);
  const after = (await frame.boundingBox())!;
  expect({ width: after.width, height: after.height }).toEqual({ width: before.width, height: before.height });
});

/** A member whose app never publishes a message key or does MLS, so a DM with them can't be encrypted. */
function neverPublishKey() {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data === "string" && (data.includes('"dm:key:publish"') || data.includes('"mls:'))) return;
    send.call(this, data);
  };
}

test("backing out of sending unencrypted puts the text and the file back", async ({ newMember, gryt }) => {
  const alice = await newMember();
  const bob = await newMember({ join: false });
  await bob.context.addInitScript(neverPublishKey);
  await bob.page.reload();
  await joinServer(bob.page, gryt.server.host);
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await openDmFromMembers(alice, bob);
  const text = unique("not in the clear");
  const box = composer(alice.page, `Message ${bob.name}`);
  await box.click();
  await alice.page.keyboard.insertText(text);
  await pasteText(alice.page, box, "z".repeat(4001));
  const files = alice.page.getByRole("button", { name: "Remove file" });
  await expect(files).toHaveCount(1);
  await box.press("Enter");

  const ask = alice.page.getByRole("alertdialog", { name: "Send this without encryption?" });
  await ask.getByRole("button", { name: "Cancel" }).click();
  await expect(ask).toBeHidden();

  await expect(box).toHaveText(text);
  await expect(files).toHaveCount(1);
  await expect(alice.page.locator("[data-message-id]").filter({ hasText: text })).toHaveCount(0);
});
