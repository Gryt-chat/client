import { channelComposer, pasteText, sendMessage, unique } from "../support/app";
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

test("pasted Markdown shows formatted, and sends the same", async ({ newMember }) => {
  const { page, context } = await newMember();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const box = channelComposer(page);
  const first = unique("first");

  await pasteText(page, box, `Plan:\n\n1. ${first}\n2. **second**\n   - nested\n\n> quoted`);
  await expect(box.locator("ol > li").first()).toHaveText(first);
  await expect(box.locator("ol strong, ol b")).toHaveText("second");
  await expect(box.locator("ol ul li")).toHaveText("nested");
  await expect(box.locator("blockquote")).toHaveText("quoted");
  await expect(box).not.toContainText("**");

  await page.keyboard.press("Enter");
  await expect(box).toHaveText("");
  const message = page.locator(".markdown-message").filter({ hasText: first }).last();
  await expect(message.locator("ol ul li")).toHaveText("nested");
  await expect(message.locator("blockquote")).toContainText("quoted");
});

test("a paste stays where the caret is, and stays raw in a code block", async ({ newMember }) => {
  const { page, context } = await newMember();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const box = channelComposer(page);
  const paste = async (text: string) => {
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await page.keyboard.press("ControlOrMeta+V");
  };

  await box.click();
  await page.keyboard.insertText("before  after");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowLeft");
  await paste("**bold**");
  await expect(box).toHaveText("before bold after");
  await expect(box.locator("strong, b")).toHaveText("bold");

  await page.keyboard.press("ControlOrMeta+A");
  await paste("```\nx\n```");
  await expect(box.locator("code")).toContainText("x");
  await paste("**raw**");
  await expect(box.locator("code")).toContainText("**raw**");
});

test("a message is spaced the way the box draws it", async ({ newMember }) => {
  const { page, context } = await newMember();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const box = channelComposer(page);
  const first = unique("first");
  await pasteText(page, box, `${first}\nnext line\n\nnew paragraph`);
  await expect(box.locator("p")).toHaveCount(3 + 1);
  const inBox = await box.locator("p").evaluateAll((ps) => ps.map((p) => p.getBoundingClientRect().top));
  await page.keyboard.press("Enter");

  const message = page.locator(".markdown-message").filter({ hasText: first }).last();
  await expect(message).toContainText("new paragraph");
  const tops = await message.evaluate((root) => {
    const range = document.createRange();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const out: [string, number][] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      range.selectNodeContents(n);
      if (n.textContent?.trim()) out.push([n.textContent, range.getBoundingClientRect().top]);
    }
    return out;
  }).then((nodes) => nodes.map(([, top]) => top));
  expect(Math.round(tops[1] - tops[0])).toBe(Math.round(inBox[1] - inBox[0]));
  expect(Math.round(tops[2] - tops[0])).toBe(Math.round(inBox[3] - inBox[0]));

});

test("cancelling an edit takes one click, though leaving the box shrinks it", async ({ newMember }) => {
  const { page } = await newMember();
  const box = channelComposer(page);
  const text = unique("edit me");
  const row = await sendMessage(page, text);

  await row.click({ button: "right" });
  await page.getByRole("menuitem", { name: "Edit Message" }).click();
  await expect(box).toBeFocused();
  for (let i = 0; i < 6; i++) await page.keyboard.press("Shift+Enter");
  const cancel = page.getByRole("button", { name: "Cancel editing" });
  // The box takes a moment to finish growing, which moves the button.
  await page.waitForTimeout(500);
  const at = (await cancel.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.up();
  await expect(cancel).toHaveCount(0);
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
