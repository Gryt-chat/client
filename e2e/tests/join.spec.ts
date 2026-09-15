import { channelComposer, joinServer, membersPanel } from "../support/app";
import { expect, test } from "../support/fixtures";

test("a guest joins a server from a fresh install", async ({ newMember, gryt }) => {
  const { page, name } = await newMember({ welcome: true, join: false });

  const welcome = page.getByRole("dialog", { name: "Welcome to Gryt" });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "I’ll look myself" }).click();
  await expect(welcome).toBeHidden();

  await joinServer(page, gryt.server.host);

  await expect(page.getByRole("button", { name: "General" })).toBeVisible();
  await expect(channelComposer(page)).toBeVisible();
  await expect(membersPanel(page).getByRole("region", { name: /^member/i })).toContainText(name);
  await expect(membersPanel(page)).toContainText(gryt.ownerName);
});
