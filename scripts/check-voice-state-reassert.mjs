/* eslint-env node */

/**
 * The client re-asserts its own voice state after a reconnect: the stash is only
 * as new as the break. A source check — the failure is an effect (GRYT-644).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sockets = readFileSync(
  new URL("../src/packages/socket/src/hooks/useSockets.ts", import.meta.url),
  "utf8",
);

// The handlers below are wired once per socket. Reading the flags straight out
// of the closure would pin them to whatever they were then.
assert.match(sockets, /const voiceSelfStateRef = useRef\(\{ isMuted, isDeafened, isAFK \}\)/);

assert.match(
  sockets,
  /voiceSelfStateRef\.current = \{ isMuted, isDeafened, isAFK \}/,
  "the ref has to be kept current or it is worse than the closure",
);

// The stash is applied during session:restore; this event is the server saying
// it has finished. Sending on `connect` instead would race it and lose.
assert.match(
  sockets,
  /socket\.on\("voice:state:restored"[\s\S]{0,200}emit\("voice:state:update", voiceSelfStateRef\.current\)/,
);

// And the reconnect where there was no stash left to restore, which sends no
// voice:state:restored at all.
assert.match(
  sockets,
  /socket\.io\.on\("reconnect"[\s\S]{0,700}emit\("voice:state:update", voiceSelfStateRef\.current\)/,
);

console.log("Voice state re-assert checks passed");
