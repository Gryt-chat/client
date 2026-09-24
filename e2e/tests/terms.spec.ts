import { TERMS_STORAGE_KEY, TERMS_VERSION } from "@gryt/core";
import { channelComposer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

test("the first message waits until you agree to the terms, and a reload doesn't ask again", async ({ newMember }) => {
  const alice = await newMember({ agreed: false });
  const bob = await newMember();
  const { page } = alice;
  const sends = () => alice.frames.filter((frame) => frame.startsWith('42["chat:send"'));

  const text = unique("my first message");
  const box = channelComposer(page);
  await box.click();
  await page.keyboard.insertText(text);
  await box.press("Enter");

  const prompt = page.getByRole("alertdialog", { name: "Before you post" });
  await expect(prompt).toBeVisible();
  await expect(prompt.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "https://gryt.chat/terms");
  await expect(prompt.getByRole("link", { name: "Community Guidelines" })).toHaveAttribute(
    "href",
    "https://gryt.chat/community-guidelines",
  );
  await expect(prompt).toContainText("Abusive content and abusive people aren’t tolerated.");
  await expect(prompt.getByRole("button", { name: "Not now" }), "a second Enter should say no, not open a link").toBeFocused();

  await prompt.getByRole("button", { name: "Not now" }).click();
  await expect(prompt).toBeHidden();
  await expect(box, "Not now should keep the draft").toHaveText(text);

  await box.press("Enter");
  await expect(prompt, "a second try should ask again").toBeVisible();
  expect(sends(), "nothing should be sent before Agree").toEqual([]);
  await expect(messageRow(bob.page, text)).toHaveCount(0);

  await prompt.getByRole("button", { name: "Agree" }).click();
  await expect(prompt).toBeHidden();
  await expect(box).toHaveText("");
  await expect(messageRow(bob.page, text)).toBeVisible();

  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), TERMS_STORAGE_KEY);
  expect(stored?.version).toBe(TERMS_VERSION);

  await page.reload();
  const later = unique("after a reload");
  await sendMessage(page, later);
  await expect(prompt).toHaveCount(0);
  await expect(messageRow(bob.page, later)).toBeVisible();
});
