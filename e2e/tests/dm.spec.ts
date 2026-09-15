import type { Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

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
