import { channelComposer, messageRow, sendMessage, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

test("a message sent with one Enter reaches the other members", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const text = unique("hello from the smoke test");
  await sendMessage(alice.page, text);

  await expect(messageRow(bob.page, text)).toBeVisible();
});

test("a pasted address with a port sends on the first Enter", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();
  await alice.context.grantPermissions(["clipboard-read", "clipboard-write"]);

  const url = "http://192.168.50.196:3000";
  const box = channelComposer(alice.page);
  await box.click();
  await alice.page.evaluate((text) => navigator.clipboard.writeText(text), url);
  await alice.page.keyboard.press("ControlOrMeta+V");
  await expect(box).toHaveText(url);

  await box.press("Enter");
  await expect(box).toHaveText("");
  await expect(messageRow(bob.page, url)).toBeVisible();
});

test("editing a message changes it for everyone", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const before = unique("typo in this mesage");
  const after = before.replace("mesage", "message");
  const row = await sendMessage(alice.page, before);
  await expect(messageRow(bob.page, before)).toBeVisible();

  await row.click({ button: "right" });
  await alice.page.getByRole("menuitem", { name: "Edit Message" }).click();
  const box = channelComposer(alice.page);
  await expect(box).toHaveText(before);
  // The editor focuses and puts the caret at the end a frame after the text lands.
  await expect(box).toBeFocused();
  await expect(async () => {
    await box.press("ControlOrMeta+A");
    expect(await box.evaluate(() => getSelection()?.toString())).toBe(before);
  }).toPass();
  await alice.page.keyboard.insertText(after);
  await box.press("Enter");

  await expect(messageRow(alice.page, after)).toBeVisible();
  await expect(messageRow(bob.page, after)).toBeVisible();
  await expect(messageRow(bob.page, before)).toHaveCount(0);
});

test("deleting a message removes it for everyone", async ({ newMember }) => {
  const alice = await newMember();
  const bob = await newMember();

  const text = unique("this one goes away");
  const row = await sendMessage(alice.page, text);
  await expect(messageRow(bob.page, text)).toBeVisible();

  await row.hover();
  await row.getByTitle("Delete", { exact: true }).click();
  const confirm = alice.page.getByRole("alertdialog", { name: "Delete message?" });
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(messageRow(alice.page, text)).toHaveCount(0);
  await expect(messageRow(bob.page, text)).toHaveCount(0);
});

test("history is still there after a reload", async ({ newMember }) => {
  const alice = await newMember();

  const text = unique("still here after a reload");
  await sendMessage(alice.page, text);

  await alice.page.reload();
  await expect(channelComposer(alice.page)).toBeVisible();
  await expect(messageRow(alice.page, text)).toBeVisible();
});
