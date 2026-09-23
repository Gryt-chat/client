import type { Locator, Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test, uniqueName } from "../support/fixtures";

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

function hiddenToggle(page: Page): Locator {
  return list(page).getByRole("button", { name: /^Hidden, / });
}

/* Not an exact name: the row carries the server's icon and the time beside the
   title, and all three are part of what a screen reader reads out. */
function row(page: Page, name: string): Locator {
  return list(page).getByRole("button", { name });
}

function hiddenRow(page: Page, name: string): Locator {
  return list(page).getByRole("button", { name: `${name}, hidden`, exact: true });
}

async function openDm(from: Member, to: Member) {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
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

test("hides a conversation and offers it straight back", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  // Nothing hidden, so there is no group to unfold.
  await expect(hiddenToggle(bob.page)).toHaveCount(0);

  await hide(bob.page, alice.name);

  await expect(row(bob.page, alice.name)).toHaveCount(0);
  await expect(hiddenToggle(bob.page)).toBeVisible();
  await expect(hiddenToggle(bob.page)).toHaveAttribute("aria-expanded", "false");

  // Everything hidden: the toggle is the only row left in the list.
  await expect(list(bob.page).getByRole("button", { name: new RegExp(alice.name) })).toHaveCount(0);

  await bob.page.getByRole("button", { name: "Undo" }).click();
  await expect(row(bob.page, alice.name)).toBeVisible();
  await expect(hiddenToggle(bob.page)).toHaveCount(0);
});

test("keeps a hidden conversation readable, and puts it back from its own menu", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);

  const toggle = hiddenToggle(bob.page);
  await expect(toggle).toContainText("Hidden");
  await expect(toggle).toContainText("1");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  // Drawn back, and named as hidden for anybody who cannot see that it is.
  const dimmed = hiddenRow(bob.page, alice.name);
  await expect(dimmed).toBeVisible();
  await expect(dimmed).toHaveCSS("opacity", "0.55");

  // It opens and reads like any other conversation, without coming back.
  await dimmed.click();
  await expect(composer(bob.page, `Message ${alice.name}`)).toBeVisible();
  await expect(hiddenToggle(bob.page)).toBeVisible();

  await hiddenRow(bob.page, alice.name).click({ button: "right" });
  await bob.page.getByRole("menuitem", { name: "Show in list" }).click();

  await expect(row(bob.page, alice.name)).toBeVisible();
  await expect(hiddenToggle(bob.page)).toHaveCount(0);
});

test("comes back when they write, including while the app was shut", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);
  await openFromList(alice.page, bob.name);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);
  await expect(hiddenToggle(bob.page)).toBeVisible();

  await say(alice.page, bob.name, unique("still here?"));

  // Back in the list on its own, and the group it was in goes with it.
  await expect(row(bob.page, alice.name)).toBeVisible();
  await expect(hiddenToggle(bob.page)).toHaveCount(0);

  // Again, with nothing listening: the answer is in the list the server sends.
  await hide(bob.page, alice.name);
  await expect(hiddenToggle(bob.page)).toBeVisible();
  await bob.page.close();

  await say(alice.page, bob.name, unique("and again"));

  const back = await bob.context.newPage();
  await back.goto("/");
  await openMessages(back);
  await expect(row(back, alice.name)).toBeVisible();
  await expect(hiddenToggle(back)).toHaveCount(0);
  await back.close();
});

test("is this device's answer, and nobody else's", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await conversationBetween(bob, alice);

  await openMessages(bob.page);
  await hide(bob.page, alice.name);
  await expect(hiddenToggle(bob.page)).toBeVisible();

  // Alice was never told, because nothing was sent. Her list is untouched.
  await openMessages(alice.page);
  await expect(row(alice.page, bob.name)).toBeVisible();
  await expect(hiddenToggle(alice.page)).toHaveCount(0);
});

test("fits a phone, with the count at the edge and the name cut short", async ({ newMember }) => {
  const alice = await newMember({ nickname: uniqueName("Aurora-Borealis-Nordlys-Very-Long") });
  const bob = await newMember({ phone: true });
  // From Alice's side: a phone has no member list to click through.
  await openDm(alice, bob);
  await say(alice.page, bob.name, unique("hello"));

  /* The phone's sheet holds the list, and opening the space closes it, so the
     way in is: sheet, Messages, sheet again. */
  const sheet = () => bob.page.getByRole("button", { name: "Open channels" }).click();
  await sheet();
  // By its text, which the rail's icon button does not have.
  await bob.page.getByRole("button", { name: /^Direct messages/ }).filter({ hasText: "Direct messages" }).click();
  await sheet();
  await expect(list(bob.page)).toBeVisible();

  await hide(bob.page, alice.name);

  const toggle = hiddenToggle(bob.page);
  await expect(toggle).toBeVisible();
  const edge = await toggle.evaluate((el) => {
    const parent = el.parentElement as HTMLElement;
    const count = el.querySelector("span.tabular-nums") as HTMLElement;
    return {
      fits: el.getBoundingClientRect().right <= parent.getBoundingClientRect().right + 1,
      countFromRight: parent.getBoundingClientRect().right - count.getBoundingClientRect().right,
    };
  });
  expect(edge.fits, "the Hidden row ran past the list it is in").toBe(true);
  // Tucked against the right edge, beside the caret rather than after the word.
  expect(edge.countFromRight).toBeLessThan(40);

  await toggle.click();
  const dimmed = hiddenRow(bob.page, alice.name);
  await expect(dimmed).toBeVisible();
  const cut = await dimmed.evaluate((el) => {
    const name = el.querySelector("span.truncate") as HTMLElement;
    return {
      truncated: name.scrollWidth > name.clientWidth,
      inside: el.getBoundingClientRect().right <= window.innerWidth + 1,
    };
  });
  expect(cut.truncated, "a name too long for the row was not cut short").toBe(true);
  expect(cut.inside, "the hidden row ran off the side of the phone").toBe(true);
});
