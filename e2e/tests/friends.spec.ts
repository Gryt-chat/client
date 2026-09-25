import type { Locator, Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

/* GRYT-1471. Friends per server, made by a request the other person accepts. The
   app keeps its own list and asks it, not the server, before it lets a ring ring. */

async function memberMenu(from: Member, to: Member): Promise<Page> {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click({ button: "right" });
  return from.page;
}

/** Skips on a server from before friends, which never answers `friend:list`. */
async function addFriend(from: Member, to: Member): Promise<void> {
  const page = await memberMenu(from, to);
  const item = page.getByRole("menuitem", { name: "Add friend" });
  const hasFriends = await item.waitFor({ timeout: 5_000 }).then(() => true, () => false);
  test.skip(!hasFriends, "the server predates friends (GRYT-1471)");
  await item.click();
}

function friendsDialog(page: Page): Locator {
  return page.locator('[data-gryt="friends-dialog"]');
}

/** From the messages space, going in first if needed: the rail button goes back out when you're in. */
async function openFriends(member: Member): Promise<Locator> {
  const open = member.page.locator('[data-gryt="friends-open"]');
  if (!(await open.isVisible())) await member.page.getByRole("button", { name: "Direct messages" }).click();
  await open.click();
  const dialog = friendsDialog(member.page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Out of the Friends list and the messages space, back to the server and its member list. */
async function closeFriends(member: Member): Promise<void> {
  await member.page.keyboard.press("Escape");
  await expect(friendsDialog(member.page)).toBeHidden();
  await member.page.locator('[data-gryt="sidebar"]').getByRole("button", { name: "Gryt E2E", exact: true }).click();
  await expect(membersPanel(member.page)).toBeVisible();
}

function row(dialog: Locator, who: Member): Locator {
  return dialog.locator('[data-gryt="friend-row"]', { hasText: who.name });
}

async function write(from: Member, to: Member, text: string): Promise<void> {
  // Not exact: a row with unread in it carries the count in its name.
  await membersPanel(from.page).getByRole("button", { name: to.name }).first().click();
  const box = composer(from.page, `Message ${to.name}`);
  await box.click();
  await from.page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(messageRow(from.page, text)).toBeVisible();
}

async function watchForRing(member: Member, caller: string): Promise<() => Promise<boolean>> {
  await member.page.evaluate((label) => {
    const w = window as unknown as { __rang?: boolean };
    w.__rang = false;
    new MutationObserver(() => {
      if (document.querySelector(`[role="alertdialog"][aria-label="${label}"]`)) w.__rang = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, `${caller} is calling`);
  return () => member.page.evaluate(() => (window as unknown as { __rang?: boolean }).__rang === true);
}

test("a request, accepted: friends on both sides, and a friend's ring rings", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  await addFriend(alice, bob);
  await expect(bob.page.getByText(`${alice.name} sent you a friend request`)).toBeVisible();

  // The waiting count on the Friends button, then Accept in the list.
  await bob.page.getByRole("button", { name: "Direct messages" }).click();
  await expect(bob.page.locator('[data-gryt="friends-waiting"]')).toHaveText("1");
  const bobs = await openFriends(bob);
  await row(bobs, alice).getByRole("button", { name: "Accept" }).click();
  await expect(row(bobs, alice).getByRole("button", { name: "Remove" })).toBeVisible();
  await expect(bob.page.locator('[data-gryt="friends-waiting"]')).toHaveCount(0);
  await closeFriends(bob);

  const alices = await openFriends(alice);
  await expect(row(alices, bob).getByRole("button", { name: "Remove" })).toBeVisible();
  // Added on this device, so there's nothing to confirm.
  await expect(row(alices, bob).getByRole("button", { name: "Confirm" })).toHaveCount(0);
  await closeFriends(alice);

  // Bob never wrote to Alice, and she can ring him because they're friends.
  const rang = await watchForRing(bob, alice.name);
  await membersPanel(alice.page).getByRole("button", { name: bob.name, exact: true }).click();
  await alice.page.locator('[data-gryt="chat-header"]').getByRole("button", { name: "Call", exact: true }).click();
  await expect.poll(rang).toBe(true);
});

test("once you have a friend, somebody you only wrote to can't ring", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  const carol = await newMember();

  // Carol and Bob have talked, so with no friends she counts as one for calls.
  await write(carol, bob, unique("hi bob"));
  await write(bob, carol, unique("hi carol"));

  await addFriend(alice, bob);
  const bobs = await openFriends(bob);
  await row(bobs, alice).getByRole("button", { name: "Accept" }).click();
  await expect(row(bobs, alice).getByRole("button", { name: "Remove" })).toBeVisible();
  await closeFriends(bob);

  await carol.page.locator('[data-gryt="chat-header"]').getByRole("button", { name: "Call", exact: true }).click();
  await expect(carol.page.getByText("They're not taking calls from you on this server.")).toBeVisible();
});

test("declined: gone for the recipient, still waiting for the sender, who can cancel", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  await addFriend(alice, bob);
  const bobs = await openFriends(bob);
  await row(bobs, alice).getByRole("button", { name: "Decline" }).click();
  await expect(row(bobs, alice)).toHaveCount(0);
  await closeFriends(bob);

  const alices = await openFriends(alice);
  const sent = row(alices, bob);
  await expect(sent.getByRole("button", { name: "Cancel" })).toBeVisible();
  await sent.getByRole("button", { name: "Cancel" }).click();
  await expect(row(alices, bob)).toHaveCount(0);
  await closeFriends(alice);

  // The menu offers it again once nothing is waiting.
  await memberMenu(alice, bob);
  await expect(alice.page.getByRole("menuitem", { name: "Add friend" })).toBeVisible();
});
