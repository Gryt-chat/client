/**
 * The reason a desktop-hosted SFU or server died, as the user is shown it (GRYT-2267).
 * A Go crash names its cause on the first line of hundreds, and the tail is its last twelve.
 */

import assert from "node:assert/strict";

import { CRASH_START, exitDetail } from "../electron/exitDetail.ts";

const dump = [
  "unexpected fault address 0x7ff6a1b20000",
  "fatal error: fault",
  "[signal 0xc0000005 code=0x0 addr=0x7ff6a1b20000 pc=0x7ff6a0e1d2a3]",
  ...Array.from({ length: 300 }, (_, i) => `\tgithub.com/pion/transport/v3/packetio.(*Buffer).Read(...) frame ${i}`),
  "created by github.com/gryt-chat/sfu/internal/forwarder.(*LayerForwarder).Start in goroutine 77",
];
const crash = dump.find((l) => CRASH_START.test(l));
const tail = dump.slice(-12);

assert.equal(crash, "unexpected fault address 0x7ff6a1b20000");
assert.equal(exitDetail(tail, crash), crash, "the crash's first line, not the 'created by' at the end");
assert.equal(exitDetail(tail, undefined), tail[tail.length - 1], "without one, the last line as before");
assert.equal(exitDetail(["listening", "bind: address already in use", "shutting down"], undefined), "bind: address already in use");
assert.equal(exitDetail([], undefined), undefined);
assert.ok(CRASH_START.test("panic: runtime error: index out of range"));
assert.ok(!CRASH_START.test("goroutine 77 [running]:"));

console.log("exit detail: a crash names its first line, other exits their telling one");
