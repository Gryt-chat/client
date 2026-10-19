// Poll helpers (GRYT-1732): picks after a click, percentages of voters, and the countdown.

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { nextPicks, pollPercent, endsInText } = await import(
  pathToFileURL(join(root, "src/packages/socket/src/utils/polls.ts")).href
);

// One answer: a click swaps to that option, and clicking your pick keeps it.
assert.deepEqual(nextPicks({ multi: false }, [], 2), [2]);
assert.deepEqual(nextPicks({ multi: false }, [0], 1), [1]);
assert.deepEqual(nextPicks({ multi: false }, [1], 1), [1]);

// Several: a click toggles, and the list stays sorted.
assert.deepEqual(nextPicks({ multi: true }, [2], 0), [0, 2]);
assert.deepEqual(nextPicks({ multi: true }, [0, 2], 2), [0]);

// Of voters, not votes: three people picking two options each is 100% each.
assert.equal(pollPercent(3, 3), 100);
assert.equal(pollPercent(1, 3), 33);
assert.equal(pollPercent(0, 0), 0);

const now = Date.parse("2026-10-13T12:00:00Z");
const later = (ms: number) => new Date(now + ms).toISOString();
assert.equal(endsInText(null, now), null);
assert.equal(endsInText(later(-1000), now), null);
assert.equal(endsInText(later(40 * 60_000), now), "ends in 40 minutes");
assert.equal(endsInText(later(60 * 60_000), now), "ends in 1 hour");
assert.equal(endsInText(later(24 * 3600_000), now), "ends in 1 day");
assert.equal(endsInText(later(2 * 24 * 3600_000), now), "ends in 2 days");

console.log("polls: ok");
