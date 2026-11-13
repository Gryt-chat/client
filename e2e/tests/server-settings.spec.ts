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
  // The rail is a drawer behind a menu button; closed, it's inert and out of the way.
  const nav = dialog.locator('nav[aria-label="Settings pages"]');
  await expect(nav).toHaveAttribute("data-open", "false");
  const openMenu = async () => {
    if ((await nav.getAttribute("data-open")) === "true") return;
    await dialog.getByRole("button", { name: "Settings pages" }).click();
    await expect(nav).toHaveAttribute("data-open", "true");
  };

  await openMenu();
  await expect(nav).toBeInViewport({ ratio: 1 });
  const tabs = await nav.getByRole("tab").allInnerTexts();
  expect(tabs.length, "the owner should see every tab").toBeGreaterThanOrEqual(12);

  const pick = async (tab: string) => {
    await openMenu();
    await nav.getByRole("tab", { name: tab, exact: true }).click();
    await expect(nav).toHaveAttribute("data-open", "false");
    await expect(dialog.getByText(tab, { exact: true }).first()).toBeVisible();
  };
  await pick("Webhooks");
  await createWebhook(dialog);

  for (const tab of tabs) {
    await pick(tab);
    await expectNoOverflow(dialog, tab);
  }
});
