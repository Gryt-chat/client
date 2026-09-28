/* eslint-env node */

/**
 * What FriendButton offers for each friend state (GRYT-1573). A step carrying
 * `confirm` is what keeps FriendButton from firing the action on the first click.
 */

import assert from "node:assert/strict";

import { friendButtonSteps } from "../src/packages/socket/src/utils/friendButtonSteps.ts";

const NAME = "Alex";

/* ── every state shows a label, and the icon a caller can look up ────────── */

for (const state of ["none", "outgoing", "incoming", "unconfirmed", "friend"]) {
  const steps = friendButtonSteps(state, NAME);
  assert.ok(Array.isArray(steps), `${state} did not return an array`);
  for (const step of steps) {
    assert.ok(step.label.length > 0, `${state} step has no label`);
    assert.ok(step.hint.length > 0, `${state} step has no hint for the tooltip/caption`);
  }
}

/* ── none: one step, straight to sending a request, nothing to confirm ───── */

{
  const [step] = friendButtonSteps("none", NAME);
  assert.equal(step.action, "request");
  assert.equal(step.label, "Add friend");
  assert.equal(step.confirm, undefined, "sending a request needs no confirmation");
}

/* ── outgoing: reads as a status, and cancelling asks first ──────────────── */

{
  const [step] = friendButtonSteps("outgoing", NAME);
  assert.equal(step.action, "cancel");
  assert.equal(step.label, "Requested", "the label should read as a status, not the cancel verb");
  assert.ok(step.hint.includes(NAME), "the hint should name who it's waiting on");
  assert.ok(step.confirm, "cancelling a sent request must ask first");
  assert.equal(step.confirm.description, `Cancel your friend request to ${NAME}?`);
  assert.ok(step.confirm.title.length > 0);
  assert.ok(step.confirm.confirmLabel.length > 0);
  assert.ok(step.confirm.cancelLabel.length > 0);
  assert.notEqual(step.confirm.cancelLabel, step.confirm.confirmLabel);
}

/* ── incoming: accept and decline, neither one asks first ─────────────────── */

{
  const steps = friendButtonSteps("incoming", NAME);
  assert.equal(steps.length, 2);
  const [accept, decline] = steps;
  assert.equal(accept.action, "accept");
  assert.equal(accept.label, "Accept");
  assert.equal(accept.confirm, undefined);
  assert.equal(decline.action, "decline");
  assert.equal(decline.label, "Decline");
  assert.equal(decline.confirm, undefined);
}

/* ── unconfirmed: the device's own confirm, not a server round trip ──────── */

{
  const [step] = friendButtonSteps("unconfirmed", NAME);
  assert.equal(step.action, "confirm");
  assert.equal(step.confirm, undefined, "confirming a friend already on the server list needs no dialog of its own");
}

/* ── friend: nothing left to offer ────────────────────────────────────────── */

assert.deepEqual(friendButtonSteps("friend", NAME), []);

/* ── a name only shows where the copy is really about the other person ───── */

assert.ok(friendButtonSteps("outgoing", "them")[0].hint.includes("them"));

console.log("check-friend-button-steps: ok");
