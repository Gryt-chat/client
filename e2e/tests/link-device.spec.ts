import { createApproverPairing, createPairingRelay, type PairingFetch } from "@gryt/core";
import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";

// Linking a new browser from an old one as a guest (GRYT-1484). The relay isn't deployed yet,
// so this runs only against a local one from auth#45: GRYT_E2E_PAIRING_RELAY=http://127.0.0.1:<port>.
const RELAY = process.env.GRYT_E2E_PAIRING_RELAY;

const nodeFetch: PairingFetch = (url, init) => fetch(url, init);

/** The guest seed, which a browser with no keychain keeps unsealed. */
function seedOf(page: Page): Promise<number[]> {
  return page.evaluate(
    () =>
      new Promise<number[]>((resolve, reject) => {
        const open = indexedDB.open("gryt_identity_keys");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const get = open.result.transaction("keys").objectStore("keys").get("identity-seed");
          get.onsuccess = () => resolve(Array.from(get.result as Uint8Array));
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

/** What `identityScopeFor` gives: the pinned lineage, or the address. */
function scopeOf(page: Page, host: string): Promise<string> {
  return page.evaluate((h) => {
    const keyId = JSON.parse(localStorage.getItem("serverIdentityHostIndex") ?? "{}")[h];
    if (!keyId) return h;
    const pin = JSON.parse(localStorage.getItem("serverIdentityPins") ?? "{}")[keyId];
    return `srv:${pin?.originKeyId ?? keyId}`;
  }, host);
}

function serverUserIdOf(page: Page, host: string): Promise<string | null> {
  return page.evaluate((h) => {
    const token = localStorage.getItem(`accessToken_${h}`);
    if (!token) return null;
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.serverUserId ?? null;
  }, host);
}

test.describe("linking a device", () => {
  test.skip(!RELAY, "needs a local pairing relay from auth#45 in GRYT_E2E_PAIRING_RELAY");

  test("a new browser links from an old one and comes back as the same guest", async ({ newMember, gryt, problems }) => {
    test.setTimeout(120_000);
    // A 410 is how the relay says the other side closed the session, and Chrome logs every one.
    problems.tolerate([/^Failed to load resource: the server responded with a status of 410 \(Gone\)$/]);
    const host = gryt.server.host;
    const old = await newMember({ label: "old device" });
    const oldUserId = await serverUserIdOf(old.page, host);
    expect(oldUserId).toBeTruthy();

    const fresh = await newMember({ label: "new device", join: false, welcome: true });
    await fresh.page.evaluate((relay) => localStorage.setItem("gryt_custom_identity", relay), RELAY!);
    await fresh.page.reload();
    await fresh.page.getByRole("button", { name: "Link with another device" }).click();

    const dialog = fresh.page.getByRole("dialog", { name: "Link this device" });
    await expect(dialog.getByRole("img", { name: "Code to scan from your other device" })).toBeVisible();
    if (process.env.SHOTS) await dialog.screenshot({ path: `${process.env.SHOTS}/showing.png` });
    const code = (await dialog.getByLabel("Code to type").textContent()) ?? "";
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);

    // The old device's side, from core, with the old browser's seed and scope.
    const added: [string, string][] = [];
    const approver = createApproverPairing({
      relay: createPairingRelay(RELAY!, nodeFetch),
      relayOrigin: RELAY!,
      fetch: nodeFetch,
      devices: (h) => ({ addOwnDevice: async (deviceId) => (added.push([h, deviceId]), []) }),
    });
    approver.claim({ code });

    const compare = fresh.page.getByRole("dialog", { name: "Check the emoji" });
    await expect(compare).toBeVisible();
    await expect.poll(() => approver.state.phase).toBe("confirming");
    if (process.env.SHOTS) await compare.screenshot({ path: `${process.env.SHOTS}/comparing.png` });
    const state = approver.state;
    if (state.phase !== "confirming") throw new Error("not confirming");
    expect(state.device).toEqual({ name: "Chrome", app: "Gryt in a browser", platform: expect.any(String) });
    const shown = await compare.getByRole("list", { name: "Emoji to compare" }).getByRole("listitem").allTextContents();
    expect(shown).toEqual(state.emoji.map((e) => `${e.emoji}${e.name}`));

    approver.approve({
      seed: Uint8Array.from(await seedOf(old.page)),
      keys: [],
      servers: [{ host, name: "Gryt E2E", scope: (await scopeOf(old.page, host)) as never }],
      pins: {},
      from: "Old laptop",
    });

    await expect(fresh.page.getByRole("dialog", { name: "Link this device" })).toContainText(
      "This device is linked to Old laptop.",
      { timeout: 60_000 },
    );
    await expect.poll(() => approver.state.phase).toBe("done");
    // "ready" named the new browser's own MLS device on the server, once its KeyPackages were up.
    expect(added).toEqual([[host, expect.any(String)]]);
    await expect.poll(() => serverUserIdOf(fresh.page, host), { timeout: 30_000 }).toBe(oldUserId);
  });
});
