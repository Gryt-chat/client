import { fixture, membersPanel } from "../support/app";
import { expect, test } from "../support/fixtures";

test("member card opens its editor directly and Cancel restores the saved preview without uploading", async ({ owner }) => {
  const page = owner.page;
  const uploads: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/uploads/banner")) uploads.push(request.url());
  });
  await membersPanel(page).locator(".member-row").filter({ hasText: owner.name }).click();
  await page.getByRole("button", { name: "Edit my card", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Edit my card", exact: true });
  await expect(editor).toBeVisible();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const savedStyle = await editor.locator(".gmc-frame").getAttribute("style");
  await editor.getByRole("button", { name: "Surprise me" }).click();
  await expect(editor.locator(".gmc-frame")).not.toHaveAttribute("style", savedStyle ?? "");
  await editor.getByRole("tab", { name: "About you" }).click();
  await editor.locator('input[type="file"]').setInputFiles(fixture("gradient.png"));
  const crop = page.getByRole("dialog", { name: "Position banner" });
  await expect(crop).toBeVisible();
  await crop.getByRole("button", { name: "Use crop" }).click();
  await expect(crop).toBeHidden();
  await expect(editor.locator(".gmc-frame")).toHaveAttribute("style", /--img:\s*url\(["']?blob:/);
  expect(uploads).toEqual([]);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "Discard card changes?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await confirm.getByRole("button", { name: "Discard changes" }).click();
  await expect(editor).toBeHidden();
  await expect(settings.locator(".gmc-frame")).toHaveAttribute("style", savedStyle ?? "");
  await expect(settings.locator(".gmc-banner.img")).toHaveCount(0);
  expect(uploads).toEqual([]);
});
