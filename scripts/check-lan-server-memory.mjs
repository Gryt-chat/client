/* eslint-env node */

// Runs the store behind the Discovery badge. Sivert: "i just restart my client and
// its like 'I found 5 new servers!'". A restart must not re-announce. GRYT-1142.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = "src/packages/settings/src/hooks/lanServerMemory.ts";
const source = readFileSync(join(root, SOURCE), "utf8");

/** A localStorage good enough for this module, over a plain object. */
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get length() {
      return Object.keys(data).length;
    },
    key: (i) => Object.keys(data)[i] ?? null,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
}

/* The real module, imported as TypeScript rather than picked apart here. It keeps
   no state of its own, so swapping the store below is what a restart looks like. */
let store = fakeStore();
Object.defineProperty(globalThis, "localStorage", { get: () => store, configurable: true });

const api = await import(`../${SOURCE}`);
/** A fresh launch against the same store: the module reads it on every call. */
const load = (next) => {
  if (next) store = next;
  return api;
};

// A restart with nothing stored: nothing is remembered, and nothing pretends to be.
{
  const fresh = load(fakeStore());
  assert.deepEqual(fresh.seenLanServers(), []);
  assert.deepEqual(fresh.dismissedLanServers(), []);
}

/* The reported bug. Looking at Discovery, then restarting, must not announce the
   same servers again — which is what a per-user key did when the id changed. */
{
  const disk = fakeStore();
  load(disk).rememberLanServersSeen(["a.local:5000", "b.local:5000"]);

  // A new launch, against the same store the last one wrote.
  const after = load(disk);
  assert.deepEqual(
    after.seenLanServers().sort(),
    ["a.local:5000", "b.local:5000"],
    "a restart forgot what Discovery had already shown, so the badge comes back",
  );
}

// It accumulates. A server that drops off the network and comes back is not new.
{
  const disk = fakeStore();
  load(disk).rememberLanServersSeen(["a.local:5000"]);
  load(disk).rememberLanServersSeen(["b.local:5000"]);
  const seen = load(disk).seenLanServers().sort();
  assert.deepEqual(seen, ["a.local:5000", "b.local:5000"], "the second visit replaced the first");

  load(disk).rememberLanServersSeen(["a.local:5000"]);
  assert.deepEqual(
    load(disk).seenLanServers().sort(),
    ["a.local:5000", "b.local:5000"],
    "seeing the same server twice stored it twice",
  );
}

/* The upgrade. The lists were per-user and the id in use changed during a launch,
   so both ids can hold part of the answer and both have to be carried. */
{
  const disk = fakeStore({
    "user:device:abc:seenLanServers": JSON.stringify(["a.local:5000"]),
    "user:11111111-2222:seenLanServers": JSON.stringify(["b.local:5000", "a.local:5000"]),
    "user:device:abc:dismissedLanServers": JSON.stringify(["c.local:5000"]),
    "user:device:abc:nickname": JSON.stringify("Drifter"),
  });
  const upgraded = load(disk);
  assert.deepEqual(
    upgraded.seenLanServers().sort(),
    ["a.local:5000", "b.local:5000"],
    "the upgrade announces servers this machine had already looked at",
  );
  assert.deepEqual(upgraded.dismissedLanServers(), ["c.local:5000"], "hidden servers came back on upgrade");

  // Carried once and then owned. A later per-user write must not resurrect anything.
  upgraded.rememberLanServersSeen(["d.local:5000"]);
  disk.setItem("user:device:abc:seenLanServers", JSON.stringify(["e.local:5000"]));
  assert.deepEqual(
    load(disk).seenLanServers().sort(),
    ["a.local:5000", "b.local:5000", "d.local:5000"],
    "the old per-user key is still being read after the move",
  );
}

/* Only the per-user keys are carried. The sweep matches by suffix, so without the
   prefix it would pick up anything else that ends the same way. */
{
  const disk = fakeStore({
    "user:device:abc:seenLanServers": JSON.stringify(["mine.local:5000"]),
    "cache:someone-else:seenLanServers": JSON.stringify(["theirs.local:5000"]),
  });
  assert.deepEqual(
    load(disk).seenLanServers(),
    ["mine.local:5000"],
    "the migration read a key that was never ours",
  );
}

// Dismissing and undismissing, across a restart each way.
{
  const disk = fakeStore();
  load(disk).rememberLanServerDismissed("a.local:5000");
  assert.deepEqual(load(disk).dismissedLanServers(), ["a.local:5000"]);
  load(disk).forgetLanServerDismissed("a.local:5000");
  assert.deepEqual(load(disk).dismissedLanServers(), [], "un-hiding a server did not survive a restart");
}

// Rubbish in the store is the same as an empty one, rather than a crash on launch.
{
  for (const bad of ["not json", '"a string"', "42", '{"seen":1}', '[1,2,{"a":3}]']) {
    assert.deepEqual(
      load(fakeStore({ lanServersSeen: bad })).seenLanServers(),
      [],
      `${bad} was not treated as nothing`,
    );
  }
}

/* The keys are not prefixed `user:`. globalStorage skips that prefix when it backs
   localStorage with a file, so a prefixed key would not survive a restart at all. */
{
  assert.ok(!/["']user:/.test(source.replace(/OLD_[A-Z]+|everyUserValue[\s\S]*?\n}/g, "")) ||
    source.includes('const SEEN = "lanServersSeen"'),
    "the device keys must not be under the user: prefix",
  );
  assert.ok(source.includes('const SEEN = "lanServersSeen"'), "the seen key moved without this check");
  assert.ok(source.includes('const DISMISSED = "lanServersDismissed"'), "the dismissed key moved without this check");
}

console.log("lan server memory: ok, survives a restart, accumulates, and carries the old keys over");
