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
    const sealedSend = member.frames.filter((frame) => frame.startsWith('42["chat:send"') && frame.includes("gryt-sealed-message"));
    expect(sealedSend, `${member.name}'s socket carried no sealed message at all`).not.toEqual([]);
    const leaked = member.frames.filter((frame) => frame.includes(question) || frame.includes(answer));
    expect(leaked, `${member.name} sent or got a DM in plain text over the socket`).toEqual([]);
  }
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

/** A member whose app never publishes a message key, so a DM with them can't be encrypted. */
function neverPublishKey() {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (this: WebSocket, data: string | ArrayBufferLike | Blob | ArrayBufferView) {
    if (typeof data === "string" && data.includes('"dm:key:publish"')) return;
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
