import { readFileSync } from "node:fs";

import { accessTokenOf } from "../support/admin";
import { channelComposer, fixture, membersPanel } from "../support/app";
import { expect, test } from "../support/fixtures";

test("chat and card pickers put this server's custom emoji first and keep Unicode searchable", async ({ owner, gryt, request }) => {
  const page = owner.page;
  const token = await accessTokenOf(page, gryt.server.host);
  const name = "card_test_custom";
  const upload = await request.post(`${gryt.server.httpBase}/api/emojis`, {
    headers: { Authorization: `Bearer ${token}` },
    multipart: { name, file: { name: "custom.png", mimeType: "image/png", buffer: readFileSync(fixture("gradient.png")) } },
  });
  expect(upload.status(), await upload.text()).toBe(201);
  await page.getByRole("button", { name: "Insert emoji", exact: true }).click();
  const chatPicker = page.locator(".gryt-emoji-picker");
  await expect(chatPicker.getByRole("button", { name: "This server", exact: true })).toBeVisible();
  await expect(chatPicker.locator("[data-emoji-category]").first()).toHaveAttribute("aria-label", "This server");
  await chatPicker.getByRole("button", { name: `:${name}:`, exact: true }).click();
  await expect(channelComposer(page).getByRole("img", { name: `:${name}:`, exact: true })).toBeVisible();
  await expect(chatPicker).toBeHidden();
  await page.getByRole("button", { name: "Insert emoji", exact: true }).click();
  await chatPicker.getByPlaceholder("Search emojis...").fill("thumbsup");
  await chatPicker.getByTitle(":thumbsup:", { exact: true }).click();
  await expect(channelComposer(page)).toContainText("👍");

  await membersPanel(page).locator(".member-row").filter({ hasText: owner.name }).click();
  await page.getByRole("button", { name: "Edit my card", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit my card", exact: true });
  await editor.getByRole("tab", { name: "Pattern", exact: true }).click();
  await editor.getByRole("button", { name: "An emoji", exact: true }).click();
  await editor.getByRole("button", { name: /^Choose emoji/ }).click();
  const cardPicker = page.locator(".gryt-emoji-picker");
  await expect(cardPicker.locator("[data-emoji-category]").first()).toHaveAttribute("aria-label", "This server");
  await cardPicker.getByRole("button", { name: `:${name}:`, exact: true }).click();
  await expect(editor.getByRole("button", { name: /^Choose emoji/ })).toContainText("server emoji");
  await expect.poll(() => editor.locator(".gmc-frame").evaluate((element) =>
    (element as HTMLElement).style.getPropertyValue("--pat-img"))).toMatch(/%3Cimage|<image/);
});
