import { channelComposer, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

test("the format bar makes a numbered list, and Tab nests it", async ({ newMember }) => {
  const alice = await newMember();
  const { page } = alice;
  const box = channelComposer(page);
  const first = unique("first");

  await box.click();
  await page.keyboard.insertText(first);
  await page.keyboard.press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Numbered list" }).click();
  await expect(box.locator("ol > li")).toHaveText(first);
  await expect(page.getByRole("button", { name: "Numbered list" })).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("ArrowRight");
  await page.keyboard.insertText("!");
  await expect(box.locator("ol > li").first()).toHaveText(`${first}!`);
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("second");
  await page.keyboard.press("Tab");
  await expect(box).toBeFocused();
  await expect(box.locator("ol ol li")).toHaveText("second");

  await page.keyboard.press("Shift+Enter");
  await page.keyboard.insertText("third");
  await page.keyboard.press("Shift+Tab");
  await expect(box.locator("ol ol li")).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(box).toHaveText("");
  const message = page.locator(".markdown-message").filter({ hasText: first }).last();
  await expect(message.locator("ol ol li")).toHaveText("second");
});

test("typing an arrow turns it into the symbol", async ({ newMember }) => {
  const { page } = await newMember();
  const box = channelComposer(page);
  await box.click();
  await page.keyboard.type("a -> b <- c => d ");
  await expect(box).toHaveText("a → b ← c ⇒ d ");
});

test("Tab and Escape leave the box, and it picks up where it was", async ({ newMember }) => {
  const { page } = await newMember();
  const box = channelComposer(page);
  await box.click();
  await page.keyboard.insertText("just");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Insert emoji" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(box).toBeFocused();
  await page.keyboard.insertText(" text");
  await expect(box).toHaveText("just text");

  await page.keyboard.press("Escape");
  await expect(box).not.toBeFocused();
  await expect(box).toHaveText("just text");
  await page.keyboard.press("Tab");
  await expect(box).not.toBeFocused();
});
