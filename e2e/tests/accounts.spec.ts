import { expect, test } from "../support/fixtures";
import { startIdentity } from "../support/identity";

test("a signed-in account gets a certificate and joins as itself", async ({ newMember, freshServer }) => {
  const identity = await startIdentity();
  try {
    const server = await freshServer({ identityTiers: "local,account", trustIssuer: identity.issuer });
    await newMember({ server, account: { identity, sub: "acct-kari" }, label: "kari" });
    await expect.poll(() => identity.issued.get("acct-kari") ?? 0, { message: "the app should ask for a certificate" }).toBeGreaterThan(0);
  } finally {
    await identity.stop();
  }
});
