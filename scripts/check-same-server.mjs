/* eslint-env node */

// /info gives a server's bare instance id and its socket gives name_port_instanceId. Every
// check for a server already in the rail has to read both, or it stops matching on connect. GRYT-1229.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const MODULE = "src/packages/settings/src/serverId.ts";
const JOIN = "src/packages/settings/src/hooks/useServerJoin.ts";
const DIALOG = "src/packages/settings/src/components/addServer.tsx";
const MANAGEMENT = "src/packages/socket/src/hooks/useServerManagement.ts";
const RAIL = "src/packages/settings/src/hostedServerRail.ts";

const { sameServer, socketServerId } = await import(`../${MODULE}`);

const ref = (host, serverId) => ({ host, serverId });

/** Both orders, because callers pass the rail entry and the lookup either way round. */
function same(a, b) {
  const forward = sameServer(a, b);
  assert.equal(sameServer(b, a), forward, `sameServer is not symmetric for ${a.host} ${a.serverId} and ${b.host} ${b.serverId}`);
  return forward;
}

/* ── pairs seen for real ────────────────────────────────────────────────────
   The rail holds the socket's id once connected, and /info at another address gives the bare one. */
{
  // The e2e server, joined at 127.0.0.1 and looked up at localhost (e2e/tests/join.spec.ts).
  const e2e = ref("127.0.0.1:64873", "gryt_e2e_64873_test-den-e1bf65");
  assert.ok(same(e2e, ref("localhost:64873", "test-den-e1bf65")), "the e2e server at localhost wasn't matched to its rail entry");

  // The hosted server from GRYT-1219: My servers adds loopback, Discovery offers .local and the LAN.
  const hosted = ref("127.0.0.1:5040", "test_den_5040_test-den-e1bf65");
  assert.ok(same(hosted, ref("Siverts-MacBook-Pro.local:5040", "test-den-e1bf65")), "Discovery's .local address wasn't matched");
  assert.ok(same(hosted, ref("192.168.1.20:5040", "test-den-e1bf65")), "the LAN address wasn't matched");

  assert.equal(socketServerId("Gryt E2E", 64873, "test-den-e1bf65"), "gryt_e2e_64873_test-den-e1bf65");
  assert.equal(socketServerId("Test Den", 5040, "test-den-e1bf65"), "test_den_5040_test-den-e1bf65");
}

// The same form on both sides matches the way it always did.
{
  assert.ok(same(ref("127.0.0.1:5040", "test-den-e1bf65"), ref("Siverts-MacBook-Pro.local:5040", "test-den-e1bf65")), "two /info ids stopped matching");
  assert.ok(same(ref("chat.example.com", "test_den_5040_test-den-e1bf65"), ref("192.168.1.20:5040", "test_den_5040_test-den-e1bf65")), "two socket ids stopped matching behind a proxy");
}

// The port comes from the address /info answered at, wherever the socket's id was stored.
{
  const behindProxy = ref("chat.example.com", "test_den_5040_test-den-e1bf65");
  assert.ok(same(behindProxy, ref("192.168.1.20:5040", "test-den-e1bf65")), "an entry stored behind a proxy wasn't matched from the LAN");

  // Port 80 is a default a URL parser drops, and a hosted server can be given it.
  assert.ok(same(ref("127.0.0.1:80", "port_eighty_80_port-eighty-5a6b7c"), ref("192.168.1.20:80", "port-eighty-5a6b7c")), "/info's id on port 80 wasn't matched");
  assert.ok(same(ref("127.0.0.1:5040", "test_den_5040_test-den-e1bf65"), ref("[fe80::1]:5040", "test-den-e1bf65")), "an IPv6 address wasn't matched");
  assert.ok(same(ref("127.0.0.1:5040", "test_den_5040_test-den-e1bf65"), ref("http://192.168.1.20:5040/", "test-den-e1bf65")), "an address with a scheme wasn't read");
}

/* ── lookalikes stay apart ──────────────────────────────────────────────────
   A wrong match says "already joined" to somebody who isn't, and they can't join at all. */
{
  const lookup = ref("Siverts-MacBook-Pro.local:5040", "test-den-e1bf65");
  const MUST_NOT_MATCH = [
    ["the same instance id on another port", "test_den_5000_test-den-e1bf65"],
    ["a friend's server with the same name and port", "test_den_5040_test-den-a1b2c3"],
    ["an instance id that only ends the same way", "test_den_5040_my-test-den-e1bf65"],
    ["an instance id that starts the same way", "test_den_5040_test-den-e1bf650"],
    ["a port and id with no name in front", "_5040_test-den-e1bf65"],
    ["a name and id with no port between", "test_den_test-den-e1bf65"],
    ["a server that publishes the default instance id", "test_den_5040_default"],
  ];
  for (const [what, stored] of MUST_NOT_MATCH) {
    assert.equal(same(ref("192.168.1.30:5040", stored), lookup), false, `matched ${what}: ${stored}`);
  }

  const stored = ref("127.0.0.1:5040", "test_den_5040_test-den-e1bf65");
  assert.equal(same(stored, ref("vps.example.com:5000", "test-den-e1bf65")), false, "matched /info's id from a server on another port");
  assert.equal(same(stored, ref("chat.example.org", "test-den-e1bf65")), false, "matched /info's id at an address with no port to compare");
  assert.equal(same(stored, ref("[fe80::1]", "test-den-e1bf65")), false, "matched /info's id at an IPv6 address with no port");

  // Two socket ids carry their names, so the same instance id and port under another name stays apart.
  assert.equal(same(stored, ref("other.example.com:5040", "other_den_5040_test-den-e1bf65")), false, "matched a socket id with another name");
  assert.equal(same(stored, ref("192.168.1.32:5040", "test_den_6000_x_5040_test-den-e1bf65")), false, "matched a socket id with this one inside it");
}

// /info's id has no name in it, so against /info only the port and the instance id can rule a server out.
assert.ok(
  same(ref("other.example.com:5040", "other_den_5040_test-den-e1bf65"), ref("192.168.1.20:5040", "test-den-e1bf65")),
  "a name ruled out /info's id, which has no name to compare. If that is on purpose, say where the name came from",
);

// No id is no match, even at one address. Matching on the address is each caller's own first check.
{
  for (const missing of [undefined, null, ""]) {
    assert.equal(same(ref("127.0.0.1:5040", missing), ref("127.0.0.1:5040", missing)), false, `two entries with ${missing} for an id matched`);
    assert.equal(same(ref("127.0.0.1:5040", "test_den_5040_test-den-e1bf65"), ref("127.0.0.1:5040", missing)), false, `${missing} matched a real id`);
  }
}

/* ── wiring ─────────────────────────────────────────────────────────────────
   Each check for "already in the rail" asks sameServer, with the address /info answered at. */
{
  const join = read(JOIN);
  assert.ok(/import \{ sameServer \} from "\.\.\/serverId";/.test(join), `${JOIN} no longer imports sameServer`);
  const at = join.indexOf("const existingByHost = servers[normalizedHost];");
  assert.notEqual(at, -1, `${JOIN} no longer checks the address first, so this check reads nothing`);
  const checks = join.slice(at, join.indexOf("const code = normalizeCode(", at));
  assert.ok(/const joining = \{ host: normalizedHost, serverId: info\.serverId \};/.test(checks), "useServerJoin stopped handing sameServer the address it is joining");
  assert.ok(/\.find\(\(\[storedHost, server\]\) =>\s*sameServer\(\{ host: storedHost, serverId: server\.serverId \}, joining\),?\s*\)/.test(checks), "useServerJoin's already-connected check stopped asking sameServer");
  assert.ok(/if \(existingById\) \{\s*switchToServer\(existingById\[0\]\);\s*return \{\s*ok: false,\s*kind: "already_member"/.test(checks), "useServerJoin stopped switching to the server it found");
  assert.equal((checks.match(/\breturn\b/g) ?? []).length, 2, "useServerJoin has a new return in front of joining");
  assert.ok(!/serverId\s*===/.test(checks), "useServerJoin compares ids by hand again");

  const dialog = read(DIALOG);
  assert.ok(/import \{ sameServer \} from "\.\.\/serverId";/.test(dialog), `${DIALOG} no longer imports sameServer`);
  const memo = dialog.slice(dialog.indexOf("const existingById = useMemo("), dialog.indexOf("const alreadyMember ="));
  assert.ok(/const lookup = \{ host: serverHost, serverId: serverInfo\.serverId \};/.test(memo), "Add a server stopped handing sameServer the address it looked up");
  assert.ok(/\.find\(\(\[storedHost, server\]\) =>\s*sameServer\(\{ host: storedHost, serverId: server\.serverId \}, lookup\),?\s*\)/.test(memo), "Add a server's existingById stopped asking sameServer");
  assert.ok(/\}, \[serverHost, serverInfo\?\.serverId, servers\]\);/.test(memo), "existingById no longer re-runs when the address changes");
  assert.ok(!/serverId\s*===/.test(memo), "Add a server compares ids by hand again");
  assert.ok(/const alreadyMember = !!existingServer \|\| !!existingById;/.test(dialog), "a match on id no longer marks the server as joined");
  assert.ok(/const joinAction = alreadyMember\s*\?\s*\{ label: "Already joined", tone: "secondary" as const, disabled: true/.test(dialog), "Already joined no longer follows alreadyMember");

  const management = read(MANAGEMENT);
  assert.ok(/import \{ sameServer \} from "@\/settings\/src\/serverId";/.test(management), `${MANAGEMENT} no longer imports sameServer`);
  const find = management.slice(management.indexOf("const findServerById = useCallback("), management.indexOf("const pendingLanServers"));
  assert.ok(/\(host: string, serverId\?: string\): \[string, Server\] \| null =>/.test(find), "findServerById no longer takes the incoming address");
  assert.ok(/const incoming = \{ host, serverId \};/.test(find), "findServerById stopped pairing the id with its address");
  assert.ok(/\.find\(\(\[storedHost, server\]\) =>\s*sameServer\(\{ host: storedHost, serverId: server\.serverId \}, incoming\),?\s*\)/.test(find), "findServerById stopped asking sameServer");
  assert.ok(!/serverId\s*===/.test(find), "findServerById compares ids by hand again");
  const add = management.slice(management.indexOf("const existingById = findServerById("), management.indexOf("const newServers = { ...servers, [normalizedHost]: normalizedIncoming };"));
  assert.ok(/^const existingById = findServerById\(normalizedHost, normalizedIncoming\.serverId\);/.test(add), "addServer no longer asks findServerById with the address being added");
  assert.ok(/\[existingHost\]: mergedServer,/.test(add) && /setServers\(newServers\);/.test(add) && /return;\s*\}\s*$/.test(add), "addServer no longer merges into the server it found");

  // Delete a hosted server uses the same helper. check-hosted-server-rail.mjs runs it.
  const rail = read(RAIL);
  assert.ok(/import \{ sameServer, socketServerId \} from "\.\/serverId\.ts";/.test(rail), `${RAIL} no longer imports sameServer`);
  assert.ok(/serverId: socketServerId\(config\.serverName, config\.serverPort, server\.id\),/.test(rail), `${RAIL} stopped building the hosted server's own socket id`);
  assert.ok(/if \(sameServer\(own, \{ host, serverId: entry\.serverId \}\)\) hosts\.add\(host\);/.test(rail), `${RAIL} stopped asking sameServer`);
  assert.ok(!/serverId\s*===|endsWith\(/.test(rail), `${RAIL} compares ids by hand again`);
}

console.log("same server: /info's id and the socket's id match each other, lookalikes stay apart, and all four checks use it");
