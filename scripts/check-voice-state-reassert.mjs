/* eslint-env node */

/**
 * The client re-asserts its own voice state after a reconnect (GRYT-644).
 *
 * `applyVoiceState` on the server restores a stashed mute, deafen and AFK onto
 * the new socket. Those three are the client's to decide, and the stash is only
 * as new as the moment the connection broke — so unless the client says
 * otherwise, the room sees a stale value while the client goes on transmitting
 * according to its own. Shown muted and still heard.
 *
 * Nothing corrected it, because the emit lives in an effect keyed on the three
 * flags and the sockets map and a reconnect moves neither: the flags are
 * unchanged, and socket.io reuses the same Socket instance across a reconnect
 * so the identity holds too. A source check, because the failure is an effect
 * that does not re-run, which no unit test of a pure function can see.
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
