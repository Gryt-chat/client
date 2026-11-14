/** Servers joined as a guest survive the move onto an account that already has a server list. */
import assert from "node:assert/strict";

import { carryGuestValue } from "../src/packages/settings/src/carryGuestValue.ts";

// The account has none: the guest's value is taken whole, as before.
assert.deepEqual(carryGuestValue("servers", undefined, { a: 1 }), { a: 1 });

// The account has its own list: the guest's extra server is added, the account's entries win.
assert.deepEqual(carryGuestValue("servers", { a: "account" }, { a: "guest", b: "guest" }), { a: "account", b: "guest" });
assert.equal(carryGuestValue("servers", { a: 1 }, { a: 2 }), undefined, "nothing new: the account's list stays as is");

assert.deepEqual(carryGuestValue("serverOrder", ["a"], ["b", "a"]), ["a", "b"]);
assert.equal(carryGuestValue("serverOrder", ["a", "b"], ["b"]), undefined);

// Any other key the account already has is left alone.
assert.equal(carryGuestValue("theme", "dark", "light"), undefined);

console.log("carry guest servers: ok, a guest's servers merge into the account's list");
