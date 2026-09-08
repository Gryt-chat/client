/* eslint-env node */

/**
 * The order of the server rail, and what the client opens on launch. Both read
 * `orderServerHosts`; the launch focus used insertion order until GRYT-642.
 */

import assert from "node:assert/strict";

import { orderServerHosts } from "../src/packages/settings/src/serverOrder.ts";

/** Only the keys matter here, so the values are placeholders. */
const serversOf = (...hosts) =>
  Object.fromEntries(hosts.map((host) => [host, { host }]));

// Nothing dragged: the rail is the order servers were added in.
assert.deepEqual(
  orderServerHosts(serversOf("a", "b", "c"), []),
  ["a", "b", "c"],
);

// Dragged: that order wins, and it is what launch opens first.
assert.deepEqual(
  orderServerHosts(serversOf("a", "b", "c"), ["c", "a", "b"]),
  ["c", "a", "b"],
);

// A server added since the last drag has never been ordered. It goes after
// everything that has, rather than disappearing from the rail.
assert.deepEqual(
  orderServerHosts(serversOf("a", "b", "c"), ["c"]),
  ["c", "a", "b"],
);

// serverOrder keeps naming servers that have been removed. They must not come
// back as rail entries, and must not become the server that opens.
assert.deepEqual(
  orderServerHosts(serversOf("a", "b"), ["gone", "b", "also-gone", "a"]),
  ["b", "a"],
);

// The removed entries also must not leave the top of the list pointing at
// nothing, which is what would strand the launch focus.
assert.equal(
  orderServerHosts(serversOf("a"), ["gone", "a"])[0],
  "a",
);

// No servers at all: no rail, and nothing to open.
assert.deepEqual(orderServerHosts({}, ["gone"]), []);

// The input is not modified. `serverOrder` is React state and is handed
// straight to this; pushing onto it would mutate state in place.
const order = ["b"];
orderServerHosts(serversOf("a", "b"), order);
assert.deepEqual(order, ["b"], "orderServerHosts mutated serverOrder");

console.log("Server order checks passed");
