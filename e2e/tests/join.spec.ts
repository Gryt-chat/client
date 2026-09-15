import { channelComposer, joinServer, membersPanel, userValue } from "../support/app";
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

test("adding a server you're in at another address says Already joined", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  const server = await freshServer({ instanceId: "test-den-e1bf65" });
  const port = server.host.split(":")[1];
  const { page } = await newMember({ server, label: "member" });

  // The rail keeps /info's id until the socket connects, then the socket's own.
  const info = (await (await page.request.get(`${server.httpBase}/info`)).json()) as { serverId?: string };
  expect(info.serverId).toBe("test-den-e1bf65");
  const stored = () => userValue<Record<string, { serverId?: string }>>(page, "servers");
  await expect.poll(async () => (await stored())?.[server.host]?.serverId).toBe(`gryt_e2e_${port}_test-den-e1bf65`);

  await page.locator('[data-tour="add-server"]').click();
  const dialog = page.getByRole("dialog", { name: "Join a server" });
  await dialog.getByLabel("Invite or server address").fill(`localhost:${port}`);
  await expect(dialog.getByText("Joined", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Already joined" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);

  expect(Object.keys((await stored()) ?? {})).toEqual([server.host]);
});
