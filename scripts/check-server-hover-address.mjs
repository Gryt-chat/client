/* eslint-env node */

// Hovering a server in the rail showed its address, and a stream shows whatever the
// cursor is resting on. A private server's address is not for the audience.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const RAIL = "src/components/sidebar.tsx";
const rail = read(RAIL);

/* The hover card, from its portal to its close. The right-click menu and the merge
   dialog sit outside it and keep the address: those you open on purpose. */
const card = (() => {
  const at = rail.indexOf("<PreviewCard.Portal>");
  assert.notEqual(at, -1, `${RAIL} no longer renders a hover card, so this check reads nothing`);
  const end = rail.indexOf("</PreviewCard.Portal>", at);
  assert.notEqual(end, -1, `${RAIL} has an unclosed hover card`);
  return rail.slice(at, end);
})();

{
  assert.ok(/servers\[host\]\.name/.test(card), "the hover card lost the server's name, so the slice is reading the wrong thing");
  assert.ok(!/\{host\}/.test(card), "the hover card shows the server's address");
  assert.ok(!/duplicateHosts\.join/.test(card), "the hover card lists the other addresses a duplicate is reached at");
  assert.ok(!/\$\{host\}/.test(card), "the hover card puts the server's address in a string");
  assert.ok(
    /Also in your list under another address/.test(card),
    "the hover card stopped saying a server is in the list twice, which is why two identical icons exist",
  );
}

// The deliberate places keep it: copying the address and merging duplicates.
{
  assert.ok(/copyServerAddress\(host\)/.test(rail), "the right-click menu lost Copy address");
  assert.ok(/title=\{`Merge into \$\{host\}\?`\}/.test(rail), "the merge dialog stopped naming the address it keeps");
}

/* Your own voice tile's latency tooltip named the SFU's address and port. It says how
   media got there instead, which carries no address. */
{
  const CARD = "src/packages/socket/src/components/VoiceParticipantCard.tsx";
  const tile = read(CARD);
  const badge = (() => {
    const at = tile.indexOf("function LatencyBadge");
    assert.notEqual(at, -1, `${CARD} no longer has LatencyBadge, so this check reads nothing`);
    return tile.slice(at, tile.indexOf("export function VoiceParticipantCard", at));
  })();
  assert.ok(/<Tooltip title=\{tooltipParts\.join/.test(badge), "the latency tooltip is built some other way, so the slice is reading the wrong thing");
  assert.ok(!/remoteAddress|localAddress|sfuEndpoint/.test(badge), "the latency tooltip shows the server's address");
  assert.ok(!/remoteAddress|localAddress/.test(tile), "the voice tile still carries an ICE address to show");
  assert.ok(/tooltipParts\.push\(`Route: \$\{stats\.candidateType\}`\)/.test(badge), "the latency tooltip stopped saying how media is routed");

  const view = read("src/packages/socket/src/components/VoiceView.tsx");
  assert.ok(!/remoteAddress: selfLatency\.remoteAddress/.test(view), "the voice view hands the tile your ICE address");
  assert.ok(/candidateType: selfLatency\.candidateType/.test(view), "the voice view no longer hands the tile the route");
}

/* Settings -> Advanced shows the SFU endpoint and both ICE addresses. Settings gets
   opened while screen sharing, so they stay hidden until you ask. */
{
  const PANEL = "src/packages/settings/src/components/latencyPanel.tsx";
  const panel = read(PANEL);
  const row = (() => {
    const at = panel.indexOf("function AddressRow");
    assert.notEqual(at, -1, `${PANEL} no longer has AddressRow, so this check reads nothing`);
    return panel.slice(at, panel.indexOf("\nfunction ", at + 1));
  })();
  const body = panel.slice(panel.indexOf("export function LatencyPanel"));

  assert.ok(/\{shown \? \(/.test(row), "AddressRow renders the address without checking whether it was revealed");
  assert.equal(row.match(/\{address\}/g)?.length, 1, "AddressRow renders the address more than once, or not at all");
  assert.ok(row.indexOf("{address}") < row.indexOf(") : ("), "AddressRow renders the address on the hidden side");
  assert.ok(/\) : \(\s*<span[^>]*>Hidden<\/span>/.test(row), "a hidden address no longer says Hidden");

  assert.ok(/const \[addressesShown, setAddressesShown\] = useState\(false\)/.test(body), "addresses are not hidden when the panel opens");
  assert.ok(!/localStorage|sessionStorage|useSettings/.test(panel), "the reveal is persisted, so it survives leaving the page");
  assert.ok(/setAddressesShown\(\(s\) => !s\)/.test(body), "nothing reveals the addresses any more");

  for (const field of ["sfuEndpoint", "remoteAddress", "localAddress"]) {
    const uses = [...body.matchAll(new RegExp(`latency\\.${field}\\b(?!\\)?\\s*(?:&&|\\|\\|))`, "g"))];
    assert.ok(uses.length > 0, `the panel no longer shows ${field}, so this check reads nothing`);
    for (const use of uses) {
      const start = body.lastIndexOf("<", use.index);
      assert.ok(
        body.startsWith("<AddressRow", start) && /shown=\{addressesShown\}/.test(body.slice(start, body.indexOf("/>", use.index))),
        `the panel renders ${field} outside a hidden AddressRow`,
      );
    }
  }

  const settings = read("src/packages/settings/src/components/settings.tsx");
  assert.ok(
    /value: "advanced",[^}]*mountWhenActive: true/.test(settings),
    "Advanced stays mounted while you are elsewhere in settings, so a revealed address stays revealed",
  );
}

console.log("server hover address: the rail's hover card, the voice tile's tooltip and the latency panel name no address unasked");
