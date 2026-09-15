import { channelComposer, setUserValue, userValue } from "../support/app";
import { APP_VERSION } from "../support/external";
import { expect, test } from "../support/fixtures";

test("What's new after an update shows a pill for each change", async ({ newMember }) => {
  const { page } = await newMember();

  // A fresh install records the running version as seen, so pretend this one updated from 1.10.0.
  await expect.poll(() => userValue<string>(page, "whatsNewSeenVersion")).toBe(APP_VERSION);
  await setUserValue(page, "whatsNewSeenVersion", "1.10.0");

  const changelog = page.waitForResponse("https://gryt.chat/changelog.json");
  await page.reload();
  await changelog;
  await expect(channelComposer(page)).toBeVisible();

  const dialog = page.getByRole("dialog", { name: "Here’s what’s new in Gryt Chat" });
  await expect(dialog).toBeVisible();
  const changes = dialog.locator("li.whats-new-change");
  await expect(changes).toHaveCount(3);
  await expect(changes.locator(".whats-new-kind")).toHaveText(["New", "Fixed", "Fixed"]);
  await expect(changes.locator("p")).toHaveText([
    "Every change in this dialog gets its own pill.",
    "The first Enter after a pasted address sends it.",
    "Server settings fit on a phone.",
  ]);

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => userValue<string>(page, "whatsNewSeenVersion")).toBe(APP_VERSION);
});
