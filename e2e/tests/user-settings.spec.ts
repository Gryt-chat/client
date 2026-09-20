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

/** The narrow layout's picker comes before the page, which has Selects of its own. */
function pickerIn(dialog: Locator): Locator {
  return dialog.getByRole("combobox").first();
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
  await expect(dialog.locator("button.gryt-settings-nav").first()).toBeHidden();

  const picker = pickerIn(dialog);
  const options = phone.page.getByRole("listbox").getByRole("option");
  await picker.click();
  await expect(options.first()).toBeVisible();
  const pages = await options.allInnerTexts();
  await phone.page.keyboard.press("Escape");
  await expect(options.first()).toBeHidden();
  expect(pages.length, "the picker should list every page").toBeGreaterThanOrEqual(15);

  // Account and About each have a page with the category's own name, so pick by position.
  for (const [i, page] of pages.entries()) {
    await picker.click();
    await options.nth(i).click();
    await expect(picker).toHaveText(page);
    await expectNoOverflow(dialog, page);
  }
});

test("user settings on a 390px phone: a tapped picker stays on the screen and scrolls", async ({ newMember }) => {
  const phone = await newMember({ phone: true, label: "phone" });
  const dialog = await openUserSettings(phone.page);
  const list = phone.page.getByRole("listbox");
  const options = list.getByRole("option");

  // A tap opens the popup below the trigger, where only its max height keeps it on the screen.
  // Before @gryt/ui 0.34.2 it had none, and the last pages sat past the bottom (GRYT-1283).
  await pickerIn(dialog).tap();
  await expect(options.first()).toBeVisible();
  await expect(list).toBeInViewport({ ratio: 1 });
  await expect.poll(() => list.evaluate((el) => el.scrollHeight > el.clientHeight), "the list should scroll").toBe(true);

  await options.last().scrollIntoViewIfNeeded();
  await expect(options.last()).toBeInViewport({ ratio: 1 });
});

test("user settings on a 390px phone: the keyboard and search still reach a page", async ({ newMember }) => {
  const phone = await newMember({ phone: true, label: "phone" });
  const dialog = await openUserSettings(phone.page);
  const picker = pickerIn(dialog);
  await expect(picker).toHaveText("Profile");

  const option = (name: string) => phone.page.getByRole("option", { name, exact: true });
  await picker.focus();
  await phone.page.keyboard.press("Enter");
  await expect(option("Profile")).toBeFocused();
  await phone.page.keyboard.press("ArrowDown");
  await expect(option("Account")).toBeFocused();
  await phone.page.keyboard.press("Enter");
  await expect(option("Account")).toBeHidden();
  await expect(picker).toHaveText("Account");

  // The results take the picker's and the page's place, and picking one hands it back.
  const search = dialog.getByPlaceholder("Search settings");
  await search.fill("unread message badge");
  const result = dialog.getByRole("button", { name: /^Unread message badge/ });
  await expect(result).toBeVisible();
  await expect(picker).toBeHidden();
  await result.click();
  await expect(picker).toHaveText("Notifications");
  await expect(dialog.locator('[data-setting="unread-message-badge"]')).toBeInViewport();

  // The query stays, so going back to the field brings the same results back.
  await expect(result).toBeHidden();
  await search.click();
  await expect(result).toBeVisible();
  await expect(search).toHaveValue("unread message badge");
});
