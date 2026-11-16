import type { Page } from "@playwright/test";

import { accessTokenOf, serverUserIdOf } from "../support/admin";
import { joinServer, type Member, messageRow, recordFrames, unique } from "../support/app";
import { bothWays, establish, openDmFromList, openDmFromMembers, send } from "../support/dm";
import { expect, test } from "../support/fixtures";
import { routeRelay } from "../support/relay";

// Encrypted DMs across linked, restored and replaced devices: the plan's step 1 scenarios.

// A 410 is how the relay says the other side closed the session, and Chrome logs every one.
const RELAY_GONE = /^Failed to load resource: the server responded with a status of 410 \(Gone\)$/;

async function openSettings(page: Page, section: string, tab?: string) {
  await page.locator('[data-tour="profile"]').click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await settings.getByRole("button", { name: section, exact: true }).first().click();
  if (tab) await settings.getByRole("button", { name: tab, exact: true }).first().click();
  return settings;
}

async function closeDialogs(page: Page) {
  while (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
}

/** `fresh` shows a code in Your devices, `old` types it in Link a device and approves. */
async function link(old: Member, fresh: Member, { anyway = false } = {}) {
  await routeRelay([old.context, fresh.context]);
  const settings = await openSettings(fresh.page, "Your devices");
  await settings.getByRole("button", { name: "This is the new device" }).click();
  if (anyway) await fresh.page.getByRole("button", { name: "Link anyway" }).click();
  const code = (await fresh.page.getByLabel("Code to type").textContent()) ?? "";
  expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

  const oldSettings = await openSettings(old.page, "Your devices");
  await oldSettings.getByRole("button", { name: "Link a device", exact: true }).click();
  const approve = old.page.getByRole("dialog", { name: "Link a new device" });
  await approve.getByLabel("Code").fill(code);
  await approve.getByRole("button", { name: "Continue" }).click();
  await old.page.getByRole("dialog", { name: "Link this device?" }).getByRole("button", { name: /^Approve \(\d+\)$/ }).click();
  await expect(approve).toContainText("is linked.", { timeout: 90_000 });
  await closeDialogs(old.page);
}

/** States a fact about this browser rather than a problem, so it needs no button. */
const ONLY_INFO = /^Messages here are only kept in this browser\./;

/** The line above the composer either goes or offers something to press. */
async function noDeadEndNotice(page: Page) {
  const line = page.locator('div[aria-live="polite"]').filter({ has: page.locator(":scope > svg") });
  await expect.poll(async () => {
    const texts: string[] = [];
    for (const n of await line.all()) {
      const text = (await n.textContent()) ?? "";
      if (!ONLY_INFO.test(text) && (await n.getByRole("button").count()) === 0) texts.push(text);
    }
    return texts;
  }, { timeout: 20_000 }).toEqual([]);
}

test.describe("encrypted DMs across devices", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a second device linked from the first sends and receives", async ({ newMember, problems }) => {
    problems.tolerate([RELAY_GONE]);
    const a1 = await newMember({ label: "A's first device" });
    const b = await newMember({ label: "B" });
    await establish(a1, b);

    const a2 = await newMember({ label: "A's new device", join: false, nickname: a1.name });
    await link(a1, a2);
    await expect(a2.page.getByRole("dialog", { name: "Link this device" })).toContainText(`This device is linked to`, { timeout: 60_000 });
    await closeDialogs(a2.page);

    await openDmFromList(a2.page, b.name);
    const { ba } = await bothWays(a2, b, "new device");
    await expect(messageRow(a1.page, ba)).toBeVisible({ timeout: 30_000 });
    for (const m of [a1, a2, b]) await noDeadEndNotice(m.page);
  });

  for (const history of [false, true]) {
    test(`a device with its own guest identity is linked anyway, restarts, and ${history ? "has the history" : "sends both ways"}`, async ({ newMember, problems }) => {
      test.fixme(history, "GRYT-2116: after Link anyway the history fails, no session on the server until restart");
      problems.tolerate([RELAY_GONE]);
      const a1 = await newMember({ label: "A's first device" });
      const b = await newMember({ label: "B" });
      const { hi } = await establish(a1, b);

      // Its own key on this server, and an MLS device with it, like a desktop used before linking.
      const a2 = await newMember({ label: "A's other device", nickname: a1.name });
      await openDmFromMembers(a2, b);
      await send(a2.page, b.name, unique("from the other key"));
      await link(a1, a2, { anyway: true });
      const dialog = a2.page.getByRole("dialog", { name: "Link this device" });
      const restartButton = dialog.getByRole("button", { name: "Restart Gryt" });
      await expect(dialog.getByText("Restarting Gryt").or(restartButton)).toBeVisible({ timeout: 120_000 });
      if (history) await expect(dialog).toContainText("Restarting Gryt");
      const loaded = a2.page.waitForEvent("load", { timeout: 30_000 });
      if (await restartButton.isVisible()) await restartButton.click();
      await loaded;
      await a2.page.reload();

      await openDmFromList(a2.page, b.name);
      if (history) await expect(messageRow(a2.page, hi)).toBeVisible({ timeout: 30_000 });
      await openDmFromList(b.page, a1.name);
      const { ba } = await bothWays(a2, b, "after the swap");
      await expect(messageRow(a1.page, ba)).toBeVisible({ timeout: 30_000 });
      for (const m of [a1, a2, b]) await noDeadEndNotice(m.page);
    });
  }

  for (const outage of [false, true]) {
    test(`a linked device gets the conversation's history${outage ? " through a minute of failed fetches" : ""}`, async ({ newMember, problems }) => {
      problems.tolerate([RELAY_GONE, /^Failed to load resource: net::ERR_FAILED$/]);
      const a1 = await newMember({ label: "A's first device" });
      const b = await newMember({ label: "B" });
      const { hi, ab, ba } = await establish(a1, b);

      const a2 = await newMember({ label: "A's new device", join: false, nickname: a1.name });
      let failed = 0;
      if (outage) {
        let until = 0;
        await a2.page.route(/\/(api\/link-history\/|api\/v1\/pairing\/sessions\/[^/]+\/chunks\/)/, (route) => {
          if (route.request().method() !== "GET") return route.fallback();
          until ||= Date.now() + 60_000;
          if (Date.now() > until) return route.fallback();
          failed++;
          return route.abort("failed");
        });
      }
      await link(a1, a2);
      await expect(a2.page.getByRole("dialog", { name: "Link this device" })).toContainText("This device is linked to", { timeout: 150_000 });
      if (outage) expect(failed, "the history fetches should have been failing").toBeGreaterThan(0);
      await closeDialogs(a2.page);

      await openDmFromList(a2.page, b.name);
      for (const text of [hi, ab, ba]) await expect(messageRow(a2.page, text)).toBeVisible({ timeout: 30_000 });
      await bothWays(a2, b, "after history");
      for (const m of [a1, a2, b]) await noDeadEndNotice(m.page);
    });
  }

  test("a device wiped and restored from the 24 words reads and sends", async ({ newMember, gryt }) => {
    const a = await newMember({ label: "A" });
    const b = await newMember({ label: "B" });
    await establish(a, b);

    const security = await openSettings(a.page, "Account & security", "Security");
    await security.getByRole("button", { name: "View recovery key" }).click();
    const words = ((await security.locator("code").filter({ hasText: /^(\S+ ){23}\S+$/ }).textContent()) ?? "").trim();
    expect(words.split(/\s+/)).toHaveLength(24);
    await a.context.close();

    const again = await newMember({ label: "A reinstalled", join: false, nickname: a.name });
    const restore = await openSettings(again.page, "Account & security", "Security");
    await restore.getByRole("button", { name: "Restore identity" }).click();
    await restore.getByLabel("Recovery key").fill(words);
    await Promise.all([again.page.waitForEvent("load"), restore.getByRole("button", { name: "Use recovery key" }).click()]);
    await joinServer(again.page, gryt.server.host);

    await openDmFromList(again.page, b.name);
    await openDmFromList(b.page, a.name);
    await bothWays(again, b, "after restore");
    for (const m of [again, b]) await noDeadEndNotice(m.page);
  });

  test("a peer who was offline while a device was added can message both of them", async ({ newMember, gryt, problems }) => {
    problems.tolerate([RELAY_GONE]);
    const a1 = await newMember({ label: "A's first device" });
    const b = await newMember({ label: "B" });
    await establish(a1, b);
    await b.page.close();

    const a2 = await newMember({ label: "A's new device", join: false, nickname: a1.name });
    await link(a1, a2);
    await expect(a2.page.getByRole("dialog", { name: "Link this device" })).toContainText("This device is linked to", { timeout: 60_000 });
    await closeDialogs(a2.page);

    const page = await b.context.newPage();
    problems.watch(page, "B back", gryt.server.httpBase);
    const back: Member = { ...b, page, frames: recordFrames(page) };
    await page.goto("/");
    await openDmFromList(back.page, a1.name);
    await openDmFromList(a2.page, b.name);
    const { ba } = await bothWays(a2, back, "after coming back");
    await expect(messageRow(a1.page, ba)).toBeVisible({ timeout: 30_000 });
    for (const m of [a1, a2, back]) await noDeadEndNotice(m.page);
  });

  test("a changed key is compared once, and after they match both sides send", async ({ newMember, gryt }) => {
    const a = await newMember({ label: "A" });
    const b = await newMember({ label: "B" });
    await establish(a, b);

    // A guest's new key is a new person, so B's pin is changed instead: B sees A's key as new.
    const aId = serverUserIdOf(await accessTokenOf(a.page, gryt.server.host));
    const changed = await b.page.evaluate((id) => {
      const pins = JSON.parse(localStorage.getItem("peerDmKeyPins") ?? "{}");
      const key = Object.keys(pins).find((k) => k.includes(id));
      if (!key) return false;
      const pin = pins[key];
      pin.dmPublicKey = (pin.dmPublicKey[0] === "A" ? "B" : "A") + pin.dmPublicKey.slice(1);
      localStorage.setItem("peerDmKeyPins", JSON.stringify(pins));
      return true;
    }, aId);
    expect(changed, "B should hold a pin for A").toBe(true);
    await b.page.reload();
    await openDmFromList(b.page, a.name);

    await b.page.getByRole("button", { name: "Compare codes" }).click();
    const compare = b.page.getByRole("dialog", { name: `Compare codes with ${a.name}` });
    await compare.getByRole("button", { name: "They match" }).click();
    // A new key usually means lost history, so it offers B's copy next.
    await compare.getByRole("button", { name: "Not now" }).click();
    await expect(compare).toBeHidden();
    await bothWays(a, b, "after comparing");
    await b.page.reload();
    await openDmFromList(b.page, a.name);
    await bothWays(a, b, "after a restart");
    await expect(b.page.getByRole("button", { name: "Compare codes" })).toHaveCount(0);
    for (const m of [a, b]) await noDeadEndNotice(m.page);
  });
});
