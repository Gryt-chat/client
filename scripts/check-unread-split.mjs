/* eslint-env node */

// One direct message used to mark two badges: the rail's direct-messages button and
// the server icon it arrived on. They read the same map, so it counted twice. GRYT-1123.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/packages/socket/src/hooks/useDirectoryUnread.ts";

/* Types stripped by Node rather than by hand here. A regex over the annotations
   kept catching the doc comments and the multi-line return types. */
const plain = stripTypeScriptTypes(readFileSync(join(root, SOURCE), "utf8"));

/** A function declaration's body, from its brace to the one that closes it. */
function bodyOf(signature) {
  const at = plain.indexOf(signature);
  assert.notEqual(at, -1, `${SOURCE} no longer has "${signature}". Move this check with it.`);
  const start = plain.indexOf("{", at + signature.length);
  let depth = 0;
  for (let i = start; i < plain.length; i++) {
    if (plain[i] === "{") depth++;
    else if (plain[i] === "}" && --depth === 0) return plain.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces after "${signature}" in ${SOURCE}`);
}

/* The two hooks, run with useMemo and useCallback doing the plain thing. What is
   worth checking is the arithmetic, not that React caches it. */
function run(signature, { directory, unread }) {
  const counts = new Map(Object.entries(unread).map(([h, m]) => [h, new Map(Object.entries(m))]));
  return new Function(
    "useDirectory",
    "useUnreadTracker",
    "useMemo",
    "useCallback",
    `return (() => ${bodyOf(signature)})();`,
  )(
    () => directory,
    () => ({
      getUnreadCounts: (host) => counts.get(host) ?? new Map(),
      channelUnreadCount: (host, id) => counts.get(host)?.get(id) ?? 0,
    }),
    (factory) => factory(),
    (fn) => fn,
  );
}

const entry = (host, id) => ({ host, conversation: { conversation_id: id } });

/* A server carrying both kinds. Two messages in channels, three in a direct
   conversation: the icon says two, the rail button says three, and neither says five. */
{
  const directory = [entry("a.example", "dm-1")];
  const unread = { "a.example": { general: 1, random: 1, "dm-1": 3 } };

  const serverUnread = run("export function useServerChannelUnread()", { directory, unread });
  const { total } = run("export function useDirectoryUnread()", { directory, unread });

  assert.equal(serverUnread("a.example"), 2, "the server icon is counting direct messages as well");
  assert.equal(total, 3, "the rail button is not counting the direct messages");
}

// A server with nothing but direct messages leaves its icon clear.
{
  const directory = [entry("a.example", "dm-1"), entry("a.example", "dm-2")];
  const unread = { "a.example": { "dm-1": 2, "dm-2": 1 } };

  const serverUnread = run("export function useServerChannelUnread()", { directory, unread });
  const { total } = run("export function useDirectoryUnread()", { directory, unread });

  assert.equal(serverUnread("a.example"), 0, "a server icon is marked for direct messages alone");
  assert.equal(total, 3);
}

// Channels only, and the icon carries all of it.
{
  const unread = { "a.example": { general: 4 } };
  const serverUnread = run("export function useServerChannelUnread()", { directory: [], unread });
  assert.equal(serverUnread("a.example"), 4, "a channel message stopped counting on the server icon");
}

/* Hosts do not bleed. The same conversation id on two servers is two conversations,
   and a direct one on one host must not silence a channel on the other. */
{
  const directory = [entry("a.example", "shared")];
  const unread = { "a.example": { shared: 2 }, "b.example": { shared: 5 } };
  const serverUnread = run("export function useServerChannelUnread()", { directory, unread });

  assert.equal(serverUnread("a.example"), 0, "the direct conversation counted on its own host");
  assert.equal(serverUnread("b.example"), 5, "another host's direct conversation hid a channel here");
}

/* Before the directory has loaded there is nothing to exclude, so the icon counts
   everything. It corrects itself; the alternative is a badge that never appears. */
{
  const unread = { "a.example": { "dm-1": 2 } };
  const serverUnread = run("export function useServerChannelUnread()", { directory: [], unread });
  assert.equal(serverUnread("a.example"), 2, "an unloaded directory should not hide unread messages");
}

// A host nobody has heard of is zero rather than a crash.
{
  const serverUnread = run("export function useServerChannelUnread()", { directory: [], unread: {} });
  assert.equal(serverUnread("nowhere.example"), 0);
}

/* And the rail actually reads the split count. The arithmetic above is worth
   nothing if the server icon still asks the tracker for the whole host. */
{
  const SIDEBAR = "src/components/sidebar.tsx";
  const sidebar = readFileSync(join(root, SIDEBAR), "utf8");

  assert.ok(
    /const serverUnreadCount = useServerChannelUnread\(\)/.test(sidebar),
    `${SIDEBAR} no longer takes its server count from useServerChannelUnread`,
  );
  assert.ok(
    !/serverUnreadCount\s*}\s*=\s*useUnreadTracker/.test(sidebar),
    `${SIDEBAR} is back on the tracker's whole-host count, which includes direct messages`,
  );
  assert.ok(
    sidebar.includes("serverUnreadCount(host)"),
    `${SIDEBAR} stopped drawing a count on the server icon`,
  );
}

console.log("unread split: ok, a direct message marks one badge and channels mark the other");
