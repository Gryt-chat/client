import { membersPanel, messageRow, unique } from "../support/app";
import { bothWays, establish, openDmFromList, send } from "../support/dm";
import { expect, test } from "../support/fixtures";
import { startIdentity, type TestIdentity } from "../support/identity";

// The one-key plan's step 3, end to end: accounts against a test identity service.

let identity: TestIdentity;
test.beforeEach(async () => {
  identity = await startIdentity();
});
test.afterEach(async () => {
  await identity.stop();
});

test("a signed-in account gets a certificate and joins as itself", async ({ newMember, freshServer }) => {
  const server = await freshServer({ identityTiers: "local,account", trustIssuer: identity.issuer });
  await newMember({ server, account: { identity, sub: "acct-kari" }, label: "kari" });
  await expect.poll(() => identity.issued.get("acct-kari") ?? 0, { message: "the app should ask for a certificate" }).toBeGreaterThan(0);
});

test.describe("one key per account", () => {
  test.describe.configure({ timeout: 240_000 });

  test("a server still on an old device's key moves to the account key by itself, and the contact compares codes once", async ({ newMember, freshServer }) => {
    const server = await freshServer({ identityTiers: "local,account", trustIssuer: identity.issuer });
    // Before the rule: this device had a key of its own, and the server and Kari know that one.
    identity.learn();
    const old = await newMember({ server, account: { identity, sub: "acct-erin" }, label: "erin old" });
    const kari = await newMember({ server, label: "kari" });
    // An account's name settles a moment after joining; Kari's member list is what the test clicks, so it's read from there.
    await expect.poll(async () => (await membersPanel(kari.page).getByRole("button").allTextContents()).filter((n) => n && n !== kari.name).length).toBe(1);
    old.name = (await membersPanel(kari.page).getByRole("button").allTextContents()).find((n) => n && n !== kari.name)!;
    await establish(old, kari);
    await old.context.close();

    // One key per account: the next device to prove one keeps it, and the old one is gone.
    identity.oneKey("acct-erin");
    // Same member on the server, so Kari still knows it by the name the first device gave it.
    const erin = { ...(await newMember({ server, account: { identity, sub: "acct-erin" }, label: "erin new" })), name: old.name };
    // The server's answer to the account proof: a server from before server#377 refuses it.
    await expect.poll(() => erin.frames.some((f) => /"changed":true|handover_required/.test(f)), { timeout: 30_000 }).toBe(true);
    test.skip(!erin.frames.some((f) => f.includes('"changed":true')), "the server predates taking the account key (server#377)");
    await openDmFromList(erin.page, kari.name);

    await kari.page.reload();
    await openDmFromList(kari.page, erin.name);
    await kari.page.getByRole("button", { name: "Compare codes" }).click({ timeout: 60_000 });
    const compare = kari.page.getByRole("dialog", { name: `Compare codes with ${erin.name}` });
    await compare.getByRole("button", { name: "They match" }).click();
    await compare.getByRole("button", { name: "Not now" }).click();
    await expect(compare).toBeHidden();

    // Erin's first line waits for Kari's app to add the new device, which her next message does.
    const waiting = unique("written on the new device");
    await send(erin.page, kari.name, waiting);
    await bothWays(kari, erin, "after the move");
    await expect(messageRow(kari.page, waiting), "the line that waited goes out on its own").toBeVisible({ timeout: 30_000 });
    await kari.page.reload();
    await openDmFromList(kari.page, erin.name);
    await bothWays(erin, kari, "after a restart");
    await expect(kari.page.getByRole("button", { name: "Compare codes" }), "codes are compared once").toHaveCount(0);
    await expect(erin.page.getByText(/^Approve this device on /), "the move needs nothing from you").toHaveCount(0);
  });

  test("a key none of your devices made shows once", async ({ newMember, freshServer }) => {
    const server = await freshServer({ identityTiers: "local,account", trustIssuer: identity.issuer });
    const erin = await newMember({ server, account: { identity, sub: "acct-erin" }, label: "erin" });
    const alert = erin.page.getByRole("dialog", { name: "Your account has a new key" });
    // The first look only remembers what's there.
    await expect.poll(() => identity.issued.get("acct-erin") ?? 0).toBeGreaterThan(0);
    await erin.page.waitForTimeout(2000);
    await expect(alert).toHaveCount(0);

    identity.addKey("acct-erin", "a-key-nobody-here-made");
    await erin.page.reload();
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await alert.getByRole("button", { name: "I reset it" }).click();
    await expect(alert).toBeHidden();

    await erin.page.reload();
    await erin.page.waitForTimeout(3000);
    await expect(alert, "once per key").toHaveCount(0);
  });
});
