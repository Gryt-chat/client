import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { measureOverflow, settled } from "../support/overflow";

async function openServerSettings(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Server settings" }).click();
  const dialog = page.getByRole("dialog", { name: "Server settings" });
  await expect(dialog).toBeVisible();
  await settled(dialog);
  return dialog;
}

/** A webhook URL doesn't wrap, which is what pushed the dialog wide in GRYT-1199. */
async function createWebhook(dialog: Locator) {
  const panel = dialog.getByRole("tabpanel", { name: "Webhooks" });
  await panel.getByRole("button", { name: "Create webhook" }).click();
  await expect(panel.getByText(/\/api\/webhooks\/[^/]+\/[^/]+$/).first()).toBeVisible();
}

async function expectNoOverflow(dialog: Locator, tab: string) {
  const panel = dialog.getByRole("tabpanel", { name: tab });
  await expect(panel).toBeVisible();
  await settled(dialog);
  expect(await measureOverflow(panel), `the ${tab} tab overflows sideways`).toEqual({
    pastEdge: [],
    scrollsSideways: [],
  });
}

test("server settings at 1280px: no tab runs past the dialog", async ({ owner }) => {
  const dialog = await openServerSettings(owner.page);
  const tabs = await dialog.getByRole("tablist", { name: "Server settings" }).getByRole("tab").allInnerTexts();
  expect(tabs.length, "the owner should see every tab").toBeGreaterThanOrEqual(12);

  const pick = async (tab: string) => {
    await dialog.getByRole("tab", { name: tab, exact: true }).click();
    await expect(dialog.getByRole("tab", { name: tab, exact: true })).toHaveAttribute("aria-selected", "true");
  };
  await pick("Webhooks");
  await createWebhook(dialog);

  for (const tab of tabs) {
    await pick(tab);
    await expectNoOverflow(dialog, tab);
  }
});

test("server settings on a 390px phone: no tab runs past the dialog", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  // Ownership goes to whoever joins first, and the worker's owner is a desktop.
  const phone = await newMember({ phone: true, server: await freshServer(), label: "phone owner" });
  await phone.page.getByRole("button", { name: "Open channels" }).click();
  const dialog = await openServerSettings(phone.page);
  await expect(dialog.getByRole("tablist", { name: "Server settings" })).toBeHidden();

  const picker = dialog.locator('[role="combobox"]:not([role="tabpanel"] [role="combobox"])');
  const options = phone.page.getByRole("listbox").getByRole("option");
  await picker.click();
  await expect(options.first()).toBeVisible();
  const tabs = await options.allInnerTexts();
  await phone.page.keyboard.press("Escape");
  await expect(options.first()).toBeHidden();
  expect(tabs.length, "the owner should see every tab").toBeGreaterThanOrEqual(12);

  const pick = async (tab: string) => {
    await picker.click();
    await phone.page.getByRole("option", { name: tab, exact: true }).click();
    await expect(picker).toHaveText(tab);
  };
  await pick("Webhooks");
  await createWebhook(dialog);

  for (const tab of tabs) {
    await pick(tab);
    await expectNoOverflow(dialog, tab);
  }
});
