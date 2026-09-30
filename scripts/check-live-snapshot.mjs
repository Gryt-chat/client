#!/usr/bin/env node

import assert from "node:assert/strict";

import { subscribeWithSnapshot } from "../src/packages/settings/src/hooks/liveSnapshot.ts";

console.log("live startup snapshot");

let resolve;
const read = () => new Promise((done) => { resolve = done; });
let live;
const seen = [];
const stop = subscribeWithSnapshot(
  read,
  (onValue) => {
    live = onValue;
    return () => {};
  },
  (value) => seen.push(value),
);

live("running game");
resolve("nothing running");
await Promise.resolve();
assert.deepEqual(seen, ["running game"], "a stale snapshot replaced the live event");
stop();

const initial = [];
const stopInitial = subscribeWithSnapshot(
  async () => "running game",
  () => () => {},
  (value) => initial.push(value),
);
await Promise.resolve();
assert.deepEqual(initial, ["running game"], "the startup snapshot was dropped");
stopInitial();

console.log("  ok  live events outrank stale startup snapshots");
console.log("  ok  startup snapshots are used when no event arrived");
