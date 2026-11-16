import type { Page } from "@playwright/test";

import { composer, type Member, membersPanel, messageRow, unique } from "./app";
import { expect } from "./fixtures";

export async function openDmFromMembers(from: Member, to: Member) {
  await membersPanel(from.page).getByRole("button", { name: to.name, exact: true }).click();
  await from.page.getByRole("button", { name: "Message", exact: true }).click();
  await expect(composer(from.page, `Message ${to.name}`)).toBeVisible();
}

export async function openDmFromList(page: Page, withName: string) {
  const box = composer(page, `Message ${withName}`);
  await expect(async () => {
    if (await box.isVisible()) return;
    await page.getByRole("button", { name: "Direct messages" }).click();
    await page.locator('[data-gryt="dm-row"]', { hasText: withName }).first().click({ timeout: 3000 });
    await expect(box).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 45_000 });
}

export async function send(page: Page, to: string, text: string) {
  const box = composer(page, `Message ${to}`);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(messageRow(page, text)).toBeVisible();
}

/** Each way once, with the DM open on both pages. */
export async function bothWays(a: Member, b: Member, label: string) {
  const ab = unique(`${label} a to b`);
  await send(a.page, b.name, ab);
  await expect(messageRow(b.page, ab)).toBeVisible({ timeout: 30_000 });
  const ba = unique(`${label} b to a`);
  await send(b.page, a.name, ba);
  await expect(messageRow(a.page, ba)).toBeVisible({ timeout: 30_000 });
  return { ab, ba };
}

/** B opens the DM and writes first, so A has a row to open it from. */
export async function establish(a: Member, b: Member) {
  await openDmFromMembers(b, a);
  const hi = unique("hello from b");
  await send(b.page, a.name, hi);
  await openDmFromList(a.page, b.name);
  await expect(messageRow(a.page, hi)).toBeVisible({ timeout: 30_000 });
  return { hi, ...(await bothWays(a, b, "first")) };
}

