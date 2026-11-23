import type { Locator, Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

/**
 * Hiding a conversation, which is this device's own: nothing about it is sent
 * to the server, and the row comes back when somebody writes (GRYT-1379).
 */

function list(page: Page): Locator {
  return page.locator('[data-gryt="dm-list"]');
}

/** The rail's button is a toggle and the space is already open when a DM was
    opened from the member list, so this presses until the list is there. */
async function openMessages(page: Page) {
  /* The rail's icon and, on a phone, the sheet's row carrying an unread count.
     Whichever of the two is on screen is the one to press. */
  const button = page.getByRole("button", { name: /^Direct messages/ }).filter({ visible: true }).first();
  await expect(button).toBeVisible();
  await expect
    .poll(async () => {
      if (await list(page).isVisible()) return true;
      await button.click();
      return list(page).isVisible();
    })
    .toBe(true);
}

/* Not an exact name: the row carries the server's icon and the time beside the
   title, and all three are part of what a screen reader reads out. */
function row(page: Page, name: string): Locator {
  return list(page).getByRole("button", { name });
}

async function openDm(from: Member, to: Member) {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
  // The row opens their card now, and Message on the card opens the conversation.
  await from.page.getByRole("button", { name: "Message", exact: true }).click();
  await expect(composer(from.page, `Message ${to.name}`)).toBeVisible();
}

/** The other end, who has the conversation already and a badge on the member row. */
async function openFromList(page: Page, name: string) {
  await openMessages(page);
  await row(page, name).click();
  await expect(composer(page, `Message ${name}`)).toBeVisible();
}

async function say(page: Page, to: string, text: string) {
  const box = composer(page, `Message ${to}`);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(messageRow(page, text)).toBeVisible();
}

/** A conversation with something in it, which is what the list draws. */
async function conversationBetween(a: Member, b: Member): Promise<void> {
  await openDm(a, b);
  await say(a.page, b.name, unique("hello"));
}

async function hide(page: Page, name: string) {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menuitem", { name: /Hide this conversation/ }).click();
}

test("hides a conversation at once and offers it straight back", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);

  // No question first, and no Hidden list: it's simply gone from the list.
  await expect(bob.page.getByRole("alertdialog")).toHaveCount(0);
  await expect(row(bob.page, alice.name)).toHaveCount(0);
  await expect(list(bob.page).getByRole("button", { name: /^Hidden/ })).toHaveCount(0);

  await bob.page.getByRole("button", { name: "Undo" }).click();
  await expect(row(bob.page, alice.name)).toBeVisible();
});

test("comes back when you message them again", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);
  await expect(row(bob.page, alice.name)).toHaveCount(0);

  // Back to the server, where her card is, the way a person would go.
  await bob.page.getByRole("button", { name: /^Direct messages/ }).filter({ visible: true }).first().click();
  await expect(list(bob.page)).toBeHidden();
  await openDm(bob, alice);
  await openMessages(bob.page);
  await expect(row(bob.page, alice.name)).toBeVisible();
});

test("comes back when they write, including while the app was shut", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);
  await openFromList(alice.page, bob.name);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);
  await expect(row(bob.page, alice.name)).toHaveCount(0);

  await say(alice.page, bob.name, unique("still here?"));

  // Back in the list on its own.
  await expect(row(bob.page, alice.name)).toBeVisible();

  // Again, with nothing listening: the answer is in the list the server sends.
  await hide(bob.page, alice.name);
  await expect(row(bob.page, alice.name)).toHaveCount(0);
  await bob.page.close();

  await say(alice.page, bob.name, unique("and again"));

  const back = await bob.context.newPage();
  await back.goto("/");
  await openMessages(back);
  await expect(row(back, alice.name)).toBeVisible();
  await back.close();
});

test("is this device's answer, and nobody else's", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);
  await expect(row(bob.page, alice.name)).toHaveCount(0);

  // Alice was never told, because nothing was sent. Her list is untouched.
  await openMessages(alice.page);
  await expect(row(alice.page, bob.name)).toBeVisible();
});
