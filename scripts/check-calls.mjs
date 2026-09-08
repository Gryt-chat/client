/* eslint-env node */

/**
 * The shape of calling, which is easy to undo by accident. A source check rather
 * than a unit test because what is guarded is an absence (GRYT-680).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const hook = read("../src/packages/socket/src/hooks/useCalls.ts");
const card = read("../src/packages/socket/src/components/IncomingCallCard.tsx");
const view = read("../src/packages/socket/src/components/serverView.tsx");

/* ── Answering is joining, and nothing else ──────────────────────────────── */

// The server has no `call:accept` and must not grow one. A second message claiming
// "I am in" can disagree with the join, and the join is what is true.
for (const [name, source] of [["the hook", hook], ["the card", card], ["serverView", view]]) {
  assert.equal(
    source.includes("call:accept"),
    false,
    `${name} emits call:accept — answering is joining the room, and the server ends the ring on the join`,
  );
}

// The hook hands the conversation back rather than connecting. It knows about
// ringing and deliberately nothing about media.
assert.match(
  hook,
  /const accept = useCallback\(\(\) => \{[\s\S]{0,200}return call;/,
  "accept() must return the call for the caller to join, not join it itself",
);

// And serverView is where the join happens, with the conversation id going
// through `connect` exactly as a channel id does.
assert.match(
  view,
  /connect\(call\.conversation_id\)/,
  "answering has to join the conversation's room through the ordinary voice path",
);

/* ── Ringing and joining are one act ─────────────────────────────────────── */

// The caller has to be in the room from the moment it rings, or the person
// answering joins a room with nobody in it. Shipped that way once.
const start = view.slice(view.indexOf("const startCall"), view.indexOf("const stopCall"));
assert.match(
  start,
  /ringConversation\(conversationId\)/,
  "starting a call has to ring",
);
assert.match(
  start,
  /connect\(conversationId\)/,
  "starting a call has to join the room too, or answering it finds nobody there",
);

/* ── Starting a call is a permission; answering one is not ───────────────── */

// `start_calls` says who may place a call, not who may take one. Gating the card
// would leave somebody unable to answer a call placed to them (GRYT-712).
assert.match(
  view,
  /viewerPermissions\.can\("start_calls"\)/,
  "the call button has to be gated on start_calls, or the server refuses a ring the client offered",
);
assert.equal(
  /start_calls/.test(card),
  false,
  "answering must not need start_calls — that permission is about placing a call, not taking one",
);
assert.equal(
  /start_calls/.test(hook),
  false,
  "useCalls must not gate on start_calls; the server is what refuses a ring",
);

/* ── Every ring ends, and ending it clears both sides ────────────────────── */

// `call:withdrawn` is the server's one way of saying a ring stopped, whichever
// ending it was. Clearing only one of these leaves a card on screen.
const withdrawn = hook.slice(hook.indexOf("const onWithdrawn"), hook.indexOf("const onError"));
assert.match(withdrawn, /setIncoming\(/, "call:withdrawn must clear an incoming ring");
assert.match(withdrawn, /setOutgoing\(/, "call:withdrawn must clear an outgoing ring");

// Changing server must not leave the last one's ring on screen.
assert.match(
  hook,
  /setIncoming\(null\);\s*\n\s*setOutgoing\(null\);\s*\n\s*\}, \[socket\]\)/,
  "both rings have to be cleared when the socket changes",
);

/* ── The card cannot be dismissed without answering ──────────────────────── */

// A ring you closed but did not answer would still be ringing at the other end.
// The only ways out are Answer, Decline, and the server withdrawing it.
assert.equal(
  /onDismiss|onClose|onOpenChange/.test(card),
  false,
  "the call card must not have a dismiss of its own — declining is how you say no",
);
assert.match(card, /onAccept/, "the card needs an accept");
assert.match(card, /onDecline/, "the card needs a decline");

// Not a modal. Thirty seconds of an unusable app is the wrong answer to a
// ringing phone.
assert.equal(
  /<Dialog|Dialog\.Root/.test(card),
  false,
  "the call card is a card, not a dialog — it must not take the app away while it rings",
);

console.log(
  "calls: ringing joins the room, answering is joining, starting one needs start_calls and answering does not, every ring clears both sides, the card cannot be dismissed",
);
