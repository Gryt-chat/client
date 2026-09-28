import { createNewDevicePairing, createPairingRelay, type PairingFetch } from "@gryt/core";
import type { PairingEnvelope } from "@gryt/crypto";
import type { Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";

// Approving a new device from Settings as a guest (GRYT-1484). The relay isn't deployed yet,
// so this runs only against a local one from auth#45: GRYT_E2E_PAIRING_RELAY=http://127.0.0.1:<port>.
const RELAY = process.env.GRYT_E2E_PAIRING_RELAY;

const nodeFetch: PairingFetch = (url, init) => fetch(url, init);

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

test.describe("approving a linked device", () => {
  test.skip(!RELAY, "needs a local pairing relay from auth#45 in GRYT_E2E_PAIRING_RELAY");

  test("Settings hands this guest's identity and servers to a new device", async ({ newMember, gryt, problems }) => {
    test.setTimeout(120_000);
    // A 410 is how the relay says the other side closed the session, and Chrome logs every one.
    problems.tolerate([/^Failed to load resource: the server responded with a status of 410 \(Gone\)$/]);
    const host = gryt.server.host;
    const old = await newMember({ label: "old device" });
    await old.page.evaluate((relay) => localStorage.setItem("gryt_custom_identity", relay), RELAY!);
    await old.page.reload();

    // The new device's side, from core. It keeps what it's sent instead of writing it anywhere.
    let kept: PairingEnvelope | null = null;
    const fresh = createNewDevicePairing({
      relay: createPairingRelay(RELAY!, nodeFetch),
      device: { name: "Pixel", app: "Gryt for Android", platform: "Android" },
      storage: { commit: async (envelope) => void (kept = envelope) },
      oidc: {
        deviceAuthorization: () => Promise.reject(new Error("a guest never signs in")),
        deviceToken: () => Promise.reject(new Error("a guest never signs in")),
      },
    });
    fresh.start();
    await expect.poll(() => fresh.state.phase).toBe("showing");
    const state = fresh.state;
    if (state.phase !== "showing") throw new Error("not showing");

    await old.page.locator('[data-tour="profile"]').click();
    await old.page.getByRole("menuitem", { name: "Settings" }).click();
    const settings = old.page.getByRole("dialog", { name: "Settings", exact: true });
    await settings.getByRole("button", { name: "Account & security" }).click();
    await settings.getByRole("button", { name: "Security", exact: true }).click();
    await settings.getByRole("button", { name: "Link a device" }).click();

    const dialog = old.page.getByRole("dialog", { name: "Link a new device" });
    await dialog.getByLabel("Code").fill(state.code.toLowerCase());
    await dialog.getByRole("button", { name: "Continue" }).click();

    const confirm = old.page.getByRole("dialog", { name: "Link this device?" });
    await expect(confirm).toContainText("Pixel, Gryt for Android on Android");
    await expect.poll(() => fresh.state.phase).toBe("comparing");
    const compared = fresh.state;
    if (compared.phase !== "comparing") throw new Error("not comparing");
    const shown = await confirm.getByRole("list", { name: "Emoji to compare" }).getByRole("listitem").allTextContents();
    expect(shown).toEqual(compared.emoji.map((e) => `${e.emoji}${e.name}`));

    await confirm.getByRole("button", { name: /^Approve \(\d+\)$/ }).click();
    await expect.poll(() => fresh.state.phase).toBe("joining");
    const envelope = kept as PairingEnvelope | null;
    expect(Array.from(envelope?.seed ?? [])).toEqual(await seedOf(old.page));
    expect(envelope?.account).toBeUndefined();
    expect(envelope?.servers.map((s) => s.host)).toEqual([host]);
    expect(envelope?.servers[0].scope).toMatch(/^srv:/);

    // No MLS device to name from here, so "ready" lists none and the old side just finishes.
    await fresh.ready([]);
    await expect(old.page.getByRole("dialog", { name: "Link a new device" })).toContainText("Pixel is linked.");
  });
});
