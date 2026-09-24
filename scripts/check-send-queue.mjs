/* eslint-env node */

// A message sent while the server restarted stayed grey for good and was never sent
// again: nothing resent a send the server never answered. GRYT-1453.

import assert from "node:assert/strict";

const { ACK_TIMEOUT_MS, GIVE_UP_AFTER_MS, RESTORE_GRACE_MS, SendQueue } = await import("../src/packages/socket/src/hooks/sendQueue.ts");

/** A socket.io client as far as the queue can tell, with a clock the test turns. */
function harness({ connected = true } = {}) {
  const listeners = new Map();
  const socket = {
    connected,
    on: (event, cb) => listeners.set(event, [...(listeners.get(event) ?? []), cb]),
    off: (event, cb) => listeners.set(event, (listeners.get(event) ?? []).filter((f) => f !== cb)),
  };
  const fire = (event, payload) => {
    for (const cb of listeners.get(event) ?? []) cb(payload);
  };

  let now = 0;
  let timers = [];
  let nextId = 0;
  const clock = {
    setTimeout: (fn, ms) => {
      const id = ++nextId;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const advance = async (ms) => {
    const end = now + ms;
    for (;;) {
      await settle();
      const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers = timers.filter((t) => t !== due);
      due.fn();
    }
    now = end;
    await settle();
  };

  const sent = [];
  const gaveUp = [];
  const waiting = new Map();
  const queue = new SendQueue(socket, {
    emit: async (nonce) => {
      if (!socket.connected) return "offline";
      sent.push(nonce);
      return "sent";
    },
    onGiveUp: (nonce) => gaveUp.push(nonce),
    onWaiting: (nonce, on) => waiting.set(nonce, on),
    timers: clock,
  });

  const drop = () => {
    socket.connected = false;
    fire("disconnect");
  };
  const back = () => {
    socket.connected = true;
    fire("connect");
  };
  const restored = () => fire("server:details", { channels: [] });
  const echo = (nonce) => fire("chat:new", { message_id: `id-${nonce}`, nonce });
  return { queue, socket, fire, advance, settle, sent, gaveUp, waiting, drop, back, restored, echo };
}

{
  const h = harness();
  h.drop();
  h.queue.add("down");
  await h.settle();
  assert.deepEqual(h.sent, [], "a send made while the server is down waits");
  assert.equal(h.waiting.get("down"), true, "and says so on its row");

  h.back();
  await h.advance(RESTORE_GRACE_MS - 1);
  assert.deepEqual(h.sent, [], "a socket that is back but not restored is not sent to");

  h.fire("server:details", { error: "join_required" });
  await h.settle();
  assert.deepEqual(h.sent, [], "details refused to an unidentified socket are not the restore");

  h.restored();
  await h.settle();
  assert.deepEqual(h.sent, ["down"], "it goes once the server knows who this is");
  assert.equal(h.waiting.get("down"), false);

  h.echo("down");
  await h.advance(ACK_TIMEOUT_MS * 3);
  assert.deepEqual(h.sent, ["down"], "confirmed, it goes no more");
  assert.deepEqual(h.gaveUp, []);
}

{
  const h = harness();
  h.drop();
  h.queue.add("refreshed");
  h.back();
  h.fire("token:refreshed", { accessToken: "t" });
  await h.settle();
  assert.deepEqual(h.sent, ["refreshed"], "a token refresh names the socket too, and can beat the restore");
}

{
  const h = harness();
  h.drop();
  h.queue.add("silent");
  h.back();
  await h.advance(RESTORE_GRACE_MS);
  assert.deepEqual(h.sent, ["silent"], "a server that never says goes out after the grace, and the echo decides");
}

{
  const h = harness();
  h.queue.add("in-flight");
  await h.settle();
  assert.deepEqual(h.sent, ["in-flight"]);
  h.drop();
  assert.equal(h.waiting.get("in-flight"), true, "a send on the wire when it dropped waits again");
  h.back();
  h.restored();
  await h.settle();
  assert.deepEqual(h.sent, ["in-flight", "in-flight"], "and goes again under the same nonce");
}

{
  const h = harness();
  h.drop();
  for (const nonce of ["one", "two", "three"]) h.queue.add(nonce);
  h.back();
  h.restored();
  await h.settle();
  assert.deepEqual(h.sent, ["one"], "what built up goes one at a time, so it lands in order");
  h.queue.add("four");
  await h.settle();
  assert.deepEqual(h.sent, ["one"], "a send made during the flush queues behind it");
  h.echo("one");
  await h.settle();
  assert.deepEqual(h.sent, ["one", "two"]);
  await h.advance(ACK_TIMEOUT_MS);
  assert.deepEqual(h.sent, ["one", "two", "two", "three"], "an overdue echo sends it again and lets the next one go");
  h.echo("two");
  h.echo("three");
  await h.settle();
  assert.deepEqual(h.sent.slice(4), ["four"]);
  h.echo("four");
  h.queue.add("five");
  h.queue.add("six");
  await h.settle();
  assert.deepEqual(h.sent.slice(5), ["five", "six"], "once drained, sends go straight out again");
}

{
  const h = harness();
  h.queue.add("unanswered");
  await h.advance(ACK_TIMEOUT_MS);
  assert.deepEqual(h.sent, ["unanswered", "unanswered"], "no echo in time sends it again");
  await h.advance(GIVE_UP_AFTER_MS);
  assert.deepEqual(h.gaveUp, ["unanswered"], "and at the cap it fails");
  const count = h.sent.length;
  await h.advance(ACK_TIMEOUT_MS * 3);
  assert.equal(h.sent.length, count, "after which nothing goes");
}

{
  const h = harness();
  h.drop();
  h.queue.add("never-back");
  await h.advance(GIVE_UP_AFTER_MS - 1);
  assert.deepEqual(h.gaveUp, []);
  await h.advance(1);
  assert.deepEqual(h.gaveUp, ["never-back"], "a server that never comes back fails the row at the cap");
}

{
  const h = harness();
  h.queue.add("refused");
  await h.settle();
  h.queue.hold("refused");
  await h.advance(ACK_TIMEOUT_MS * 3);
  assert.deepEqual(h.sent, ["refused"], "a refused send waits for its retry instead of going on its own");
  h.queue.resend("refused");
  await h.settle();
  assert.deepEqual(h.sent, ["refused", "refused"]);
  h.queue.settle("refused");
  await h.advance(ACK_TIMEOUT_MS * 3);
  assert.equal(h.sent.length, 2, "settled, it goes no more");
}

{
  const h = harness();
  h.drop();
  h.queue.add("left-behind");
  h.queue.dispose();
  assert.deepEqual(h.gaveUp, ["left-behind"], "a queue going away fails what it still holds");
}

console.log("send queue: ok");
