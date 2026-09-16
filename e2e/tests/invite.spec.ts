import type { Page } from "@playwright/test";

import { accessTokenOf, ask, createInvite, serverUserIdOf, withSocket } from "../support/admin";
import { channelComposer, joinServer } from "../support/app";
import { expect, test } from "../support/fixtures";
import { measureOverflow, settled } from "../support/overflow";
import { PUBLIC_ALIAS } from "../support/server";

function inviteDialog(page: Page) {
  return page.getByRole("dialog", { name: "Server Invite" });
}

/** The path gryt.chat's "Open in the browser" lands on. An open server's link has no code. */
function invitePath(host: string, code?: string): string {
  return `/invite?host=${encodeURIComponent(host)}${code ? `&code=${encodeURIComponent(code)}` : ""}`;
}

test("a link with only the host joins a server anyone can join", async ({ newMember, gryt }) => {
  const { page } = await newMember({ join: false });

  await page.goto(invitePath(gryt.server.host));
  const dialog = inviteDialog(page);
  await expect(dialog.getByText("Anyone can join this server.")).toBeVisible();
  await expect(dialog.getByLabel("Invite code")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Join", exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(channelComposer(page)).toBeVisible();
});

test("a link with only the host asks for a code on an invite-only server", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  const server = await freshServer({ joinPolicy: "invite" });
  // Whoever joins first owns the server, whatever its policy, so the owner goes first.
  const owner = await newMember({ server, label: "owner" });
  const { page } = await newMember({ server, join: false, label: "guest" });

  await page.goto(invitePath(server.host));
  const dialog = inviteDialog(page);
  await expect(dialog.getByText("This server needs an invite code.")).toBeVisible();
  const join = dialog.getByRole("button", { name: "Join", exact: true });
  await expect(join).toBeDisabled();

  const code = await createInvite(server.httpBase, await accessTokenOf(owner.page, server.host));
  await dialog.getByLabel("Invite code").fill(code);
  await join.click();

  await expect(dialog).toBeHidden();
  await expect(channelComposer(page)).toBeVisible();
});

test("a code link to an open server still spends the code, so its role is given", async ({ owner, newMember, gryt }) => {
  const token = await accessTokenOf(owner.page, gryt.server.host);
  const roleId = `trusted${Date.now() % 1_000_000}`;
  const roleIds = (httpBase: string) =>
    withSocket(httpBase, async (socket) => {
      const state = await ask<{ roles?: { id: string; grantableByInvite?: boolean }[] }>(
        socket, "server:roles:definitions:list", { accessToken: token }, "server:roles:definitions",
      );
      return (state.roles ?? []).filter((r) => r.grantableByInvite).map((r) => r.id);
    });

  await withSocket(gryt.server.httpBase, async (socket) => {
    const refused = new Promise<never>((_, reject) =>
      socket.once("server:error", (e: { message?: string }) => reject(new Error(`Saving the role was refused: ${e?.message}`))),
    );
    refused.catch(() => undefined);
    socket.emit("server:roles:definitions:save", {
      accessToken: token, roleId, name: "Trusted", rank: 20, permissions: [], grantableByInvite: true,
    });
    await Promise.race([expect.poll(() => roleIds(gryt.server.httpBase)).toContain(roleId), refused]);
  });
  const code = await createInvite(gryt.server.httpBase, token, { grantsRole: roleId });

  const { page } = await newMember({ join: false });
  await page.goto(invitePath(gryt.server.host, code));
  const dialog = inviteDialog(page);
  await expect(dialog.getByText("You've been invited to join this server.", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "Accept Invite" }).click();
  await expect(dialog).toBeHidden();
  await expect(channelComposer(page)).toBeVisible();

  const member = serverUserIdOf(await accessTokenOf(page, gryt.server.host));
  const rolesOfMember = () =>
    withSocket(gryt.server.httpBase, async (socket) => {
      const list = await ask<{ roles?: { serverUserId: string; roles?: string[] }[] }>(
        socket, "server:roles:list", { accessToken: token }, "server:roles",
      );
      return list.roles?.find((r) => r.serverUserId === member)?.roles ?? [];
    });
  await expect.poll(rolesOfMember, "the invite's role wasn't given, so the join skipped the code").toContain(roleId);
});

test("a visitor with no account is asked to sign in, and comes back to the same invite", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  const server = await freshServer({ identityTiers: "account" });
  const { page } = await newMember({ server, join: false, label: "visitor" });

  await page.goto(invitePath(server.host));
  const dialog = inviteDialog(page);
  const signIn = dialog.getByRole("button", { name: "Sign in to join" });
  await expect(signIn).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);

  // The fixture's Keycloak sends every sign-in straight back unauthenticated, which is still the round trip.
  const origin = new URL(page.url()).origin;
  const leaves = page.waitForRequest((r) => r.isNavigationRequest() && r.url().includes("/protocol/openid-connect/auth"));
  const returns = page.waitForResponse((r) => r.request().isNavigationRequest() && r.url().startsWith(origin));
  await signIn.click();
  await leaves;
  await returns;

  await expect(inviteDialog(page)).toBeVisible();
  await expect(inviteDialog(page).getByText(server.host, { exact: true })).toBeVisible();
  await expect(inviteDialog(page).getByRole("button", { name: "Sign in to join" })).toBeVisible();
});

test("an open server's invite link names a public address and carries no code", async ({ newMember, freshServer }) => {
  test.skip(!!process.env.GRYT_E2E_SERVER, "needs a server of its own, and GRYT_E2E_SERVER gives one");

  const server = await freshServer();
  const alias = `${PUBLIC_ALIAS}:${server.host.split(":")[1]}`;
  const link = `https://gryt.chat/invite?host=${encodeURIComponent(alias)}`;
  const { page, context } = await newMember({ server, join: false, label: "owner at a public address" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await joinServer(page, alias);
  const copied = () => page.evaluate(() => navigator.clipboard.readText());

  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Copy invite link" }).click();
  await expect.poll(copied).toBe(link);

  await page.evaluate(() => navigator.clipboard.writeText(""));
  await page.getByRole("button", { name: "Gryt E2E", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Copy invite link" }).click();
  await expect.poll(copied).toBe(link);

  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Server settings" }).click();
  const settings = page.getByRole("dialog", { name: "Server settings" });
  await settings.getByRole("tab", { name: "Invites", exact: true }).click();
  await expect(settings.getByLabel("Invite link")).toHaveValue(link);
  // The codes stay on an open server, for roles and limits.
  await expect(settings.getByRole("button", { name: "Create invite" })).toBeVisible();
  await settled(settings);
  expect(await measureOverflow(settings.getByRole("tabpanel", { name: "Invites" })), "the link runs past the dialog").toEqual({
    pastEdge: [],
    scrollsSideways: [],
  });
});

test("Copy invite link won't copy an address only this machine can reach", async ({ newMember }) => {
  const { page, context } = await newMember();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate(() => navigator.clipboard.writeText("untouched"));

  await page.getByRole("button", { name: "Server menu" }).click();
  await page.getByRole("menuitem", { name: "Copy invite link" }).click();

  await expect(page.getByText("This server has no public address, so there's no link to copy.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("untouched");
});
