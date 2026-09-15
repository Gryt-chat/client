import { messageRow, unique } from "../support/app";
import { expect, test } from "../support/fixtures";

test("a webhook post with a card shows the card", async ({ owner, newMember, request, gryt }) => {
  const viewer = await newMember();

  await owner.page.getByRole("button", { name: "Server menu" }).click();
  await owner.page.getByRole("menuitem", { name: "Server settings" }).click();
  const dialog = owner.page.getByRole("dialog", { name: "Server settings" });
  await dialog.getByRole("tab", { name: "Webhooks", exact: true }).click();
  const panel = dialog.getByRole("tabpanel", { name: "Webhooks" });
  const urls = panel.getByText(new RegExp(`^${gryt.server.httpBase}/api/webhooks/[^/]+/[^/]+$`));
  const before = await urls.count();
  await panel.getByRole("button", { name: "Create webhook" }).click();
  await expect(urls).toHaveCount(before + 1);
  const url = (await urls.first().textContent()) ?? "";

  const title = unique("Deploy finished");
  const response = await request.post(url, {
    data: {
      display_name: "Build runner",
      cards: [
        {
          title,
          description: "Everything on **main** went out.",
          color: "#22c55e",
          fields: [{ name: "Duration", value: "4m 12s", inline: true }],
          footer: { text: "Smoke test" },
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(200);

  const row = messageRow(viewer.page, title);
  const card = row.locator("article.gryt-webhook-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText(title);
  await expect(card).toContainText("Everything on main went out.");
  await expect(card.locator("strong")).toHaveText("main");
  await expect(card).toContainText("Duration");
  await expect(card).toContainText("4m 12s");
  await expect(card).toContainText("Smoke test");
  // With no text, the server writes the title as a fallback line for old clients. This one draws the card only.
  await expect(row.getByText(title, { exact: true })).toHaveCount(1);
  await expect(viewer.page.getByText("Build runner").first()).toBeVisible();
});
