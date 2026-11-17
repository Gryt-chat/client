import { messageRow, unique } from "../support/app";
import { establish, send } from "../support/dm";
import { expect, test } from "../support/fixtures";

test("a muted DM still gets its messages, says so in the list, and unmutes from a right-click", async ({ newMember }) => {
  const a = await newMember();
  const b = await newMember();
  await establish(a, b);

  const panel = a.page.locator('[data-gryt="dm-info"]');
  const row = a.page.locator('[data-gryt="dm-row"]', { hasText: b.name });
  const setting = panel.getByRole("button", { name: /Notifications/ });

  await expect(setting).toContainText("Everything");
  await setting.click();
  // A 1:1 has no mentions to filter on, and no server level to fall back to.
  await expect(a.page.getByRole("menuitemradio")).toHaveText(["Everything", "Nothing"]);
  await a.page.getByRole("menuitemradio", { name: "Nothing" }).click();
  await expect(setting).toContainText("Muted");
  await expect(row.getByLabel("Muted")).toBeVisible();

  const quiet = unique("while muted");
  await send(b.page, a.name, quiet);
  await expect(messageRow(a.page, quiet)).toBeVisible({ timeout: 30_000 });

  await row.click({ button: "right" });
  await a.page.getByRole("menuitem", { name: "Notifications" }).hover();
  await a.page.getByRole("menuitemradio", { name: "Everything" }).click();
  await expect(row.getByLabel("Muted")).toHaveCount(0);
  await expect(setting).toContainText("Everything");
});
