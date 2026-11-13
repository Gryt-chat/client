import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { measureOverflow, settled } from "../support/overflow";

async function openUserSettings(page: Page): Promise<Locator> {
  await page.locator('[data-tour="profile"]').click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(dialog).toBeVisible();
  await settled(dialog);
  return dialog;
}

/** Measured from the dialog down, so the search field and the picker have to fit as well as the page. */
async function expectNoOverflow(dialog: Locator, page: string) {
  await settled(dialog);
  expect(await measureOverflow(dialog), `the ${page} page overflows sideways`).toEqual({
    pastEdge: [],
    scrollsSideways: [],
  });
}

/** The narrow layout's rail is a drawer behind a menu button. */
async function openMenu(dialog: Locator): Promise<Locator> {
  const nav = dialog.locator('nav[aria-label="Settings pages"]');
  if ((await nav.getAttribute("data-open")) === "true") return nav;
  await dialog.getByRole("button", { name: "Settings pages" }).click();
  await expect(nav).toHaveAttribute("data-open", "true");
  return nav;
}

test("user settings at 1280px: no page runs past the dialog", async ({ owner }) => {
  const dialog = await openUserSettings(owner.page);
  const destinations = dialog.locator("button.gryt-settings-nav:not(.gryt-settings-subnav)");
  const names = await destinations.allInnerTexts();
  expect(names.length, "the rail should list every destination").toBeGreaterThanOrEqual(8);

  let pages = 0;
  for (const [i, name] of names.entries()) {
    const destination = destinations.nth(i);
    await destination.click();
    if ((await destination.getAttribute("aria-expanded")) === null) {
      await expect(destination).toHaveAttribute("data-active", "true");
      await expectNoOverflow(dialog, name);
      pages++;
      continue;
    }

    // The category that just closed is still animating out, so wait for one open group.
    const group = dialog.locator(".gryt-settings-subnav-group");
    await expect(group).toHaveCount(1);
    await expect.poll(
      () => group.evaluate((el) => el.scrollHeight <= el.clientHeight),
      `${name} subnav should expand to its full height`,
    ).toBe(true);
    const subpages = group.getByRole("button");
    for (const [j, page] of (await subpages.allInnerTexts()).entries()) {
      await subpages.nth(j).click();
      await expect(subpages.nth(j)).toHaveAttribute("aria-current", "page");
      await expectNoOverflow(dialog, `${name} / ${page}`);
      pages++;
    }
  }
  expect(pages, "every page should have been measured").toBeGreaterThanOrEqual(15);
});

test("user settings on a 390px phone: no page runs past the dialog", async ({ newMember }) => {
  const phone = await newMember({ phone: true, label: "phone" });
  const dialog = await openUserSettings(phone.page);
  const nav = dialog.locator('nav[aria-label="Settings pages"]');
  await expect(nav).toHaveAttribute("data-open", "false");

  const destinations = nav.locator("button.gryt-settings-nav:not(.gryt-settings-subnav)");
  await openMenu(dialog);
  const names = await destinations.allInnerTexts();
  expect(names.length, "the drawer should list every destination").toBeGreaterThanOrEqual(8);

  let pages = 0;
  for (const [i, name] of names.entries()) {
    await openMenu(dialog);
    const destination = destinations.nth(i);
    await destination.click();
    if ((await destination.getAttribute("aria-expanded")) === null) {
      await expect(nav).toHaveAttribute("data-open", "false");
      await expectNoOverflow(dialog, name);
      pages++;
      continue;
    }
    // A category keeps the drawer open so its pages can be picked.
    await expect(nav).toHaveAttribute("data-open", "true");
    const group = nav.locator(".gryt-settings-subnav-group");
    await expect(group).toHaveCount(1);
    const count = await group.getByRole("button").count();
    for (let j = 0; j < count; j++) {
      if (j > 0) await openMenu(dialog);
      const page = group.getByRole("button").nth(j);
      const label = await page.innerText();
      await page.click();
      await expect(nav).toHaveAttribute("data-open", "false");
      await expectNoOverflow(dialog, `${name} / ${label}`);
      pages++;
    }
  }
  expect(pages, "every page should have been measured").toBeGreaterThanOrEqual(15);
});

test("user settings on a 390px phone: the drawer stays on the screen and scrolls", async ({ newMember }) => {
  const phone = await newMember({ phone: true, label: "phone" });
  const dialog = await openUserSettings(phone.page);
  const nav = await openMenu(dialog);
  await expect(nav).toBeInViewport({ ratio: 1 });

  const last = nav.locator("button.gryt-settings-nav").last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
});

test("user settings on a 390px phone: the keyboard and search still reach a page", async ({ newMember }) => {
  const phone = await newMember({ phone: true, label: "phone" });
  const dialog = await openUserSettings(phone.page);
  const nav = dialog.locator('nav[aria-label="Settings pages"]');

  // Esc closes the drawer first and leaves settings open.
  await openMenu(dialog);
  await phone.page.keyboard.press("Escape");
  await expect(nav).toHaveAttribute("data-open", "false");
  await expect(dialog).toBeVisible();

  // Search lives in the drawer; picking a result closes it and lands on the setting.
  await openMenu(dialog);
  const search = dialog.getByPlaceholder("Search settings");
  await search.fill("unread message badge");
  const result = dialog.getByRole("button", { name: /^Unread message badge/ });
  await expect(result).toBeVisible();
  await result.click();
  await expect(nav).toHaveAttribute("data-open", "false");
  await expect(dialog.getByText("Chat & notifications › Notifications")).toBeVisible();
  await expect(dialog.locator('[data-setting="unread-message-badge"]')).toBeInViewport();

  // The query stays, so opening the drawer again brings the same results back.
  await openMenu(dialog);
  await expect(search).toHaveValue("unread message badge");
  await expect(result).toBeVisible();
});
