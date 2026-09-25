import type { Locator, Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";
import { settled } from "../support/overflow";

/* GRYT-1470. Your settings are checked twice: by the server, and by your own app
   against a server that ignores them. Against an older server only the app's holds. */

async function openPrivacy(page: Page): Promise<Locator> {
  await page.locator('[data-tour="profile"]').click();
  // By its tour id: a server's context menu has a Settings item too.
  await page.locator('[data-tour="menu-settings"]').click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await settled(dialog);
  await dialog.getByRole("button", { name: "Account & security" }).click();
  await dialog.getByRole("button", { name: "Privacy", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "Privacy" })).toBeVisible();
  return dialog;
}

function choice(dialog: Locator, setting: string, label: string): Locator {
  return dialog.locator(`[data-setting="${setting}"]`).getByRole("button", { name: label, exact: true });
}

async function takeMessagesFromNobody(member: Member): Promise<void> {
  const dialog = await openPrivacy(member.page);
  await choice(dialog, "who-can-send-me-messages", "Nobody").click();
  await expect(choice(dialog, "who-can-send-me-messages", "Nobody")).toHaveAttribute("aria-pressed", "true");
  // Nobody can message you, so the looser call answers can't be picked.
  await expect(choice(dialog, "who-can-call-me", "Friends")).toBeDisabled();
  await member.page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

test("messages from nobody: a DM never surfaces, whichever side stops it", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await takeMessagesFromNobody(bob);

  const rail = bob.page.locator('[data-gryt="sidebar"]');
  const dmBadge = rail.locator("div.relative", { has: rail.getByRole("button", { name: "Direct messages" }) }).locator(".gryt-badge");

  await membersPanel(alice.page).getByRole("button", { name: bob.name, exact: true }).click();
  const refusal = alice.page.getByText("They're not taking messages from you on this server.");
  const box = composer(alice.page, `Message ${bob.name}`);
  await expect(refusal.or(box).first()).toBeVisible();

  if (await refusal.isVisible()) {
    // A server from GRYT-1470 on refuses the conversation before it exists.
    await expect(box).toBeHidden();
    await expect(dmBadge).toHaveCount(0);
  } else {
    // An older server lets it through, and Bob's app holds it back.
    const text = unique("held back");
    await box.click();
    await alice.page.keyboard.insertText(text);
    await box.press("Enter");
    await expect(messageRow(alice.page, text)).toBeVisible();

    await bob.page.getByRole("button", { name: "Direct messages" }).click();
    const filtered = bob.page.locator('[data-gryt="dm-filtered"]');
    await expect(filtered.locator('[data-gryt="dm-filtered-count"]')).toHaveText("1");
    await expect(bob.page.getByRole("button", { name: alice.name, exact: true })).toHaveCount(0);
    await expect(dmBadge).toHaveCount(0);

    // Opening it is how somebody reads what was held back.
    await filtered.getByRole("button", { name: /Filtered/ }).click();
    await filtered.locator('[data-gryt="dm-filtered-item"]').click();
    await expect(messageRow(bob.page, text)).toBeVisible();
  }
});

test("a server's own answer sits over the one in settings", async ({ newMember }) => {
  const bob = await newMember();
  const rail = bob.page.locator('[data-gryt="sidebar"]');
  await rail.getByRole("button", { name: "Gryt E2E", exact: true }).click({ button: "right" });
  await bob.page.getByRole("menuitem", { name: "Who can send me messages" }).hover();
  await bob.page.getByRole("menuitemradio", { name: "Nobody" }).click();
  // A radio item leaves its menu open, the way the notification levels do.
  await bob.page.keyboard.press("Escape");
  await bob.page.keyboard.press("Escape");
  await expect(bob.page.getByRole("menu")).toHaveCount(0);

  await rail.getByRole("button", { name: "Gryt E2E", exact: true }).click({ button: "right" });
  await bob.page.getByRole("menuitem", { name: "Who can send me messages" }).hover();
  await expect(bob.page.getByRole("menuitemradio", { name: "Nobody" })).toHaveAttribute("aria-checked", "true");
  await expect(bob.page.getByRole("menuitemradio", { name: "Default (anyone on the server)" })).toBeVisible();
  await bob.page.keyboard.press("Escape");
  await bob.page.keyboard.press("Escape");
  await expect(bob.page.getByRole("menu")).toHaveCount(0);

  // The default is untouched: this server has its own answer.
  const dialog = await openPrivacy(bob.page);
  await expect(choice(dialog, "who-can-send-me-messages", "Anyone on the server")).toHaveAttribute("aria-pressed", "true");
});

async function write(from: Member, to: Member, text: string): Promise<void> {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
  await reply(from, to, text);
}

async function reply(from: Member, to: Member, text: string): Promise<void> {
  const box = composer(from.page, `Message ${to.name}`);
  await box.click();
  await from.page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(messageRow(from.page, text)).toBeVisible();
}

/** Whether a ringing card for this caller was ever drawn. The e2e server has no SFU, so
    the caller's join fails and the ring is withdrawn after a moment. */
async function watchForRing(member: Member, caller: string): Promise<() => Promise<boolean>> {
  await member.page.evaluate((label) => {
    const w = window as unknown as { __rang?: boolean };
    w.__rang = false;
    const seen = () => !!document.querySelector(`[role="alertdialog"][aria-label="${label}"]`);
    new MutationObserver(() => {
      if (seen()) w.__rang = true;
    }).observe(document.body, { childList: true, subtree: true });
  }, `${caller} is calling`);
  return () => member.page.evaluate(() => (window as unknown as { __rang?: boolean }).__rang === true);
}

test("calls from friends by default: a stranger's ring never rings, and writing back lets it through", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await write(alice, bob, unique("hello"));
  await bob.page.getByRole("button", { name: "Direct messages" }).click();
  const rang = await watchForRing(bob, alice.name);

  const refusal = alice.page.getByText("They're not taking calls from you on this server.");
  const filtered = bob.page.locator('[data-gryt="dm-filtered"]');
  const callButton = alice.page.locator('[data-gryt="chat-header"]').getByRole("button", { name: "Call", exact: true });
  await callButton.click();

  // The server refuses it (GRYT-1470 on), or an older one rings and Bob's app holds it back.
  await expect.poll(async () => (await refusal.isVisible()) || (await filtered.isVisible())).toBe(true);
  expect(await rang()).toBe(false);
  if (await filtered.isVisible()) {
    await filtered.getByRole("button", { name: /Filtered/ }).click();
    const item = filtered.locator('[data-gryt="dm-filtered-item"]', { hasText: "Called you" });
    await expect(item).toBeVisible();
    await item.click();
  } else {
    await bob.page.locator('[data-gryt="dm-list"]').getByRole("button", { name: alice.name }).first().click();
  }

  // Bob writes back, which makes Alice a friend until friend requests exist.
  await reply(bob, alice, unique("hi back"));
  // An older server let the first ring out, and it's still going on Alice's side.
  const either = alice.page.locator('[data-gryt="chat-header"]').getByRole("button", { name: /^(Call|Cancel)$/ });
  await expect
    .poll(async () => {
      const label = (await either.textContent())?.trim();
      if (label === "Cancel") await either.click();
      return label;
    })
    .toBe("Call");
  await callButton.click();
  await expect.poll(rang).toBe(true);
});
