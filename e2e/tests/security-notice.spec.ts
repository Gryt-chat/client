import { readFileSync } from "node:fs";

import type { Locator, Page } from "@playwright/test";

import { channelComposer, membersPanel } from "../support/app";
import { serveSecurityNotices } from "../support/external";
import { expect, test } from "../support/fixtures";

interface Notice {
  id: string;
  fixedIn: string;
  url: string;
}

/** Made-up fixes far above any real release. `later` was published second, with the lower fix. */
function notices(): { later: Notice; first: Notice } {
  const [later, first] = JSON.parse(
    readFileSync(new URL("../fixtures/security-notices.json", import.meta.url), "utf8"),
  ) as Notice[];
  // Fresh ids each run, because the owner's dismissals outlive a test and a retry would start dismissed.
  const run = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return { later: { ...later, id: `${later.id}-${run}` }, first: { ...first, id: `${first.id}-${run}` } };
}

function securityNotice(page: Page): Locator {
  return page.getByRole("status", { name: "Security notice" });
}

/** The member's context menu has a Roles submenu, and each role in it toggles. */
async function toggleRole(page: Page, memberName: string, role: string) {
  await membersPanel(page).getByRole("button", { name: memberName, exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "Roles" }).click();
  await page.getByRole("menuitem", { name: role, exact: true }).click();
}

test("the owner of a server below a security fix is told, until they dismiss it", async ({ owner }) => {
  const { page } = owner;
  const { later, first } = notices();

  await serveSecurityNotices(page, [first]);
  await page.reload();
  await expect(channelComposer(page)).toBeVisible();

  const notice = securityNotice(page);
  await expect(notice).toContainText(`This server has a known security issue. Update it to ${first.fixedIn} or later.`);
  await expect(notice.getByRole("link", { name: "Details" })).toHaveAttribute("href", first.url);

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();

  // A notice published later brings it back. It links there, since the first is still dismissed after
  // the reload, and asks for the first one's fix because this server is below both.
  await serveSecurityNotices(page, [later, first]);
  await page.reload();
  await expect(channelComposer(page)).toBeVisible();
  await expect(notice).toContainText(`Update it to ${first.fixedIn} or later.`);
  await expect(notice.getByRole("link", { name: "Details" })).toHaveAttribute("href", later.url);

  await notice.getByRole("button", { name: "Dismiss" }).click();
  await expect(notice).toBeHidden();
});

test("a member isn't told about a security fix, and becomes told as an admin", async ({ owner, newMember }) => {
  const member = await newMember();
  const { first } = notices();

  await serveSecurityNotices(member.page, [first]);
  await member.page.reload();
  await expect(channelComposer(member.page)).toBeVisible();
  await expect(securityNotice(member.page)).toBeHidden();

  // Made an admin by the owner, and it appears without a reload.
  await toggleRole(owner.page, member.name, "Admin");
  await expect(securityNotice(member.page)).toContainText(`Update it to ${first.fixedIn} or later.`);

  // And it goes again with the role.
  await toggleRole(owner.page, member.name, "Admin");
  await expect(securityNotice(member.page)).toBeHidden();
});
