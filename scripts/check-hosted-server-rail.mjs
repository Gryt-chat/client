/* eslint-env node */

// Deleting a hosted server takes every rail entry whose id or loopback address is its own,
// and nobody else's. Entries joined on a LAN or .local address used to survive it. GRYT-1219.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { normalizeHost } from "@gryt/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const MODULE = "src/packages/settings/src/hostedServerRail.ts";
const SETTINGS = "src/packages/settings/src/components/myServersSettings.tsx";
const MANAGEMENT = "src/packages/socket/src/hooks/useServerManagement.ts";

const { railEntriesFor } = await import(`../${MODULE}`);

/** A hosted server the way the embedded manager hands it to the renderer. */
function hosted(id, serverName, serverPort) {
  return {
    id,
    status: "stopped",
    error: null,
    serverUrl: `http://127.0.0.1:${serverPort}`,
    config: {
      id,
      serverName,
      serverPort,
      sfuPort: 5005,
      mediaPort: 3478,
      lanDiscoverable: true,
      externalHost: `http://127.0.0.1:${serverPort}`,
      advertisedAddresses: ["192.168.1.20"],
      customAdvertisedAddresses: [],
    },
  };
}

// The server from the report, the id its entries held once connected, and /info's id.
const SERVER = hosted("test-den-e1bf65", "Test Den", 5040);
const SOCKET_ID = "test_den_5040_test-den-e1bf65";
const INFO_ID = "test-den-e1bf65";

const LOOPBACK = "127.0.0.1:5040";
const LAN = "192.168.1.20:5040";
const DOT_LOCAL = "Siverts-MacBook-Pro.local:5040";

const entry = (host, serverId) => ({ host, name: "Test Den", serverId });
const rail = (...entries) => Object.fromEntries(entries.map((e) => [e.host, e]));
const removed = (joined, server = SERVER) => railEntriesFor(server, joined).sort();

/* ── the report ─────────────────────────────────────────────────────────────
   server_info.server_id is what the rail holds once the socket is up. */
{
  assert.deepEqual(removed(rail(entry(LAN, SOCKET_ID))), [LAN], "Delete kept the entry joined on the LAN address");
  assert.deepEqual(removed(rail(entry(DOT_LOCAL, SOCKET_ID))), [DOT_LOCAL], "Delete kept the entry joined on the .local name");

  const everywhere = rail(entry(LOOPBACK, SOCKET_ID), entry(LAN, SOCKET_ID), entry(DOT_LOCAL, SOCKET_ID));
  assert.deepEqual(removed(everywhere), [LOOPBACK, LAN, DOT_LOCAL].sort(), "Delete missed one of three addresses for one server");

  // Behind a tunnel or a proxy the address has no port, but the socket's id does.
  assert.deepEqual(removed(rail(entry("chat.example.com", SOCKET_ID))), ["chat.example.com"], "Delete kept an entry joined through a proxy");
}

// Loopback is this machine's port, so it is this server whatever the entry holds.
{
  assert.deepEqual(removed(rail(entry(LOOPBACK, SOCKET_ID))), [LOOPBACK], "Delete kept the loopback entry");
  assert.deepEqual(removed(rail(entry(LOOPBACK, undefined))), [LOOPBACK], "Delete kept a loopback entry that never learned an id");
  assert.deepEqual(removed(rail(entry(LOOPBACK, "somebody_else_5040_x"))), [LOOPBACK], "loopback stopped being matched on address");
}

// /info's id, stored when joining and replaced once the socket connects. It has no
// port, so the address supplies one.
{
  assert.deepEqual(removed(rail(entry(LAN, INFO_ID))), [LAN], "Delete kept a LAN entry holding /info's id");
  assert.deepEqual(removed(rail(entry(DOT_LOCAL, INFO_ID))), [DOT_LOCAL], "Delete kept a .local entry holding /info's id");

  // Port 80 is a default a URL parser drops, and the form lets you pick it.
  const eighty = hosted("port-eighty-5a6b7c", "Port Eighty", 80);
  assert.deepEqual(removed(rail(entry("192.168.1.20:80", "port-eighty-5a6b7c")), eighty), ["192.168.1.20:80"], "Delete kept /info's id on port 80");
}

/* ── somebody else's server stays ───────────────────────────────────────────
   Removing one drops its tokens, and an invite-only server needs a new invite. */
{
  const MUST_STAY = [
    ["the same instance id on another port", "gryt.example.com", "test_den_5000_test-den-e1bf65"],
    ["the same instance id and port under another name", "other.example.com:5040", "other_den_5040_test-den-e1bf65"],
    ["a friend's server with the same name and port", "friend.local:5040", "test_den_5040_test-den-a1b2c3"],
    ["an instance id that only ends the same way", "192.168.1.30:5040", "test_den_5040_my-test-den-e1bf65"],
    ["an instance id that starts the same way", "192.168.1.31:5040", "test_den_5040_test-den-e1bf650"],
    ["an instance id with this port and id inside it", "192.168.1.32:5040", "test_den_6000_x_5040_test-den-e1bf65"],
    ["/info's id from a server on another port", "vps.example.com:5000", INFO_ID],
    ["/info's id at an address with no port to compare", "chat.example.org", INFO_ID],
    ["a server that publishes the default instance id", "gryt.example.net:5040", "test_den_5040_default"],
  ];

  for (const [what, host, serverId] of MUST_STAY) {
    assert.deepEqual(removed(rail(entry(host, serverId))), [], `Delete removed ${what}: ${host} holding ${serverId}`);
  }

  const mixed = rail(entry(LAN, SOCKET_ID), ...MUST_STAY.map(([, host, serverId]) => entry(host, serverId)));
  assert.deepEqual(removed(mixed), [LAN], "other servers in the rail changed what Delete removes");
}

// Two hosted servers with the same name is the expected case, and each takes only its own.
{
  const first = hosted("my-server-0a1b2c", "My Server", 5000);
  const second = hosted("my-server-3d4e5f", "My Server", 5001);
  const joined = rail(
    entry("127.0.0.1:5000", "my_server_5000_my-server-0a1b2c"),
    entry("192.168.1.20:5000", "my_server_5000_my-server-0a1b2c"),
    entry("127.0.0.1:5001", "my_server_5001_my-server-3d4e5f"),
    entry("Siverts-MacBook-Pro.local:5001", "my_server_5001_my-server-3d4e5f"),
  );
  assert.deepEqual(removed(joined, first), ["127.0.0.1:5000", "192.168.1.20:5000"], "deleting one of two servers named alike touched the other");
  assert.deepEqual(removed(joined, second), ["127.0.0.1:5001", "Siverts-MacBook-Pro.local:5001"].sort(), "deleting the second server missed its entries");
}

// An entry with no id is tied to this server by the loopback address alone.
{
  assert.deepEqual(removed(rail(entry(LAN, undefined))), [], "an entry with no id was matched on a LAN address, which could be any machine's");
  assert.deepEqual(removed(rail(entry("gryt.example.com", undefined), entry("friend.local:5040", ""))), [], "Delete removed an entry with no id");
}

// A config that did not load leaves only the loopback address to go on.
{
  const noConfig = { ...SERVER, config: null };
  assert.deepEqual(removed(rail(entry(LOOPBACK, SOCKET_ID), entry(LAN, SOCKET_ID)), noConfig), [LOOPBACK], "a server with no config matched on an id it cannot check");
  assert.deepEqual(removed({}), [], "an empty rail produced entries");
}

// removeServers normalises what it is given, so a key that changes under it is never deleted.
{
  for (const host of removed(rail(entry(LOOPBACK, SOCKET_ID), entry(LAN, SOCKET_ID), entry(DOT_LOCAL, INFO_ID)))) {
    assert.equal(normalizeHost(host), host, `${host} is not a rail key removeServers can find`);
  }
}

/* ── wiring ─────────────────────────────────────────────────────────────────
   Delete uses this module, and the removal it calls does remove. */
{
  const settings = read(SETTINGS);
  assert.ok(/import \{ railEntriesFor \} from "\.\.\/hostedServerRail";/.test(settings), `${SETTINGS} no longer imports railEntriesFor from ${MODULE}`);
  assert.ok(!/function railEntriesFor/.test(settings), `${SETTINGS} has its own railEntriesFor again, which this check does not run`);
  assert.ok(/servers: joinedServers, removeServers \} =\s*useServerManagement\(\);/.test(settings), `${SETTINGS} no longer hands railEntriesFor the rail's own servers`);
  assert.ok(
    /onDelete=\{\(\) => \{[^}]*removeServers\(railEntriesFor\(server, joinedServers\)\);\s*void deleteServer\(server\.id\);/.test(settings),
    `${SETTINGS} no longer removes the rail entries when a server is deleted`,
  );

  const management = read(MANAGEMENT);
  const at = management.indexOf("const removeServers = useCallback(");
  assert.notEqual(at, -1, `${MANAGEMENT} no longer defines removeServers, so this check reads nothing`);
  const body = management.slice(at, management.indexOf("\n  );\n", at));
  assert.ok(/delete newServers\[host\];/.test(body), "removeServers stopped deleting the entries it is handed");
  assert.ok(/setServers\(newServers\);/.test(body), "removeServers stopped writing the rail back");
  assert.equal((body.match(/\breturn\b/g) ?? []).length, 1, "removeServers has a new return in front of the removal");
  assert.ok(/if \(normalized\.length === 0\) return;/.test(body), "removeServers returns early on something other than an empty list");

  // The rail keeps the socket's id, which is why SOCKET_ID is the case that matters.
  assert.ok(/const id = details\?\.server_info\?\.server_id;/.test(management), `${MANAGEMENT} stopped storing server_info.server_id. Check which id the rail holds now.`);
}

console.log("hosted server rail: Delete takes this server's entries by id or loopback, and leaves the rest");
