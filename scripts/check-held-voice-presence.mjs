/* eslint-env node */

/**
 * Tiles survive a server restart (GRYT-1355). The restarted server forgets who is
 * in voice until each client re-announces, and every socket id changes.
 */

import assert from "node:assert/strict";

import {
  byRosterClientId,
  holdVoicePresence,
  keepInVoice,
  recordByServerUser,
  resolveSelfClientId,
} from "../src/packages/socket/src/lib/heldVoicePresence.ts";

const inVoice = (serverUserId, extra = {}) => ({
  serverUserId,
  nickname: serverUserId,
  hasJoinedChannel: true,
  voiceChannelId: "voice",
  streamID: `mic-${serverUserId}`,
  cameraEnabled: true,
  cameraStreamID: `cam-${serverUserId}`,
  ...extra,
});
/** What a restarted server sends before the re-announce lands. */
const forgotten = (serverUserId) => ({
  serverUserId,
  nickname: serverUserId,
  hasJoinedChannel: false,
  voiceChannelId: "",
  cameraEnabled: false,
});
const live = () => true;
const dead = () => false;

function settle(rosters, mediaLive = live) {
  let held = {};
  let clients;
  for (const roster of rosters) ({ clients, held } = holdVoicePresence(roster, held, mediaLive));
  return { clients, held };
}

/* ── A restart keeps everybody in the call, cameras included ─────────────── */
{
  const { clients } = settle([
    { s1: inVoice("alice"), s2: inVoice("bob") },
    { n1: forgotten("alice"), n2: forgotten("bob") },
  ]);
  assert.deepEqual(Object.keys(clients).sort(), ["n1", "n2"]);
  assert.equal(clients.n2.hasJoinedChannel, true);
  assert.equal(clients.n2.voiceChannelId, "voice");
  assert.equal(clients.n2.cameraStreamID, "cam-bob");
  assert.equal(clients.n2.streamID, "mic-bob");
}

/* ── Somebody not back yet keeps their old entry ─────────────────────────── */
{
  const { clients } = settle([
    { s1: inVoice("alice"), s2: inVoice("bob") },
    { n1: forgotten("alice") },
  ]);
  assert.equal(clients.s2.cameraStreamID, "cam-bob");
  assert.equal(clients.n1.hasJoinedChannel, true);
}

/* ── The re-announce takes over, and a camera turned off since then shows ── */
{
  const { clients, held } = settle([
    { s1: inVoice("alice") },
    { n1: forgotten("alice") },
    { n1: inVoice("alice", { cameraEnabled: false, cameraStreamID: undefined }) },
  ]);
  assert.equal(clients.n1.cameraEnabled, false);
  assert.equal(held.alice.socketId, "n1");
}

/* ── Leaving on the same socket is leaving, whatever the media says ──────── */
{
  const { clients, held } = settle([
    { s1: inVoice("alice") },
    { s1: forgotten("alice") },
  ]);
  assert.equal(clients.s1.hasJoinedChannel, false);
  assert.equal(held.alice, undefined);
}

/* ── Gone from the SFU while the server was down is gone ─────────────────── */
{
  const { clients, held } = settle(
    [{ s1: inVoice("alice"), s2: inVoice("bob") }, { n1: forgotten("alice") }],
    (client) => client.serverUserId !== "bob",
  );
  assert.equal(clients.s2, undefined);
  assert.equal(held.bob, undefined);
  assert.equal(settle([{ s1: inVoice("alice") }, { n1: forgotten("alice") }], dead).clients.n1.hasJoinedChannel, false);
}

/* ── Nothing held is the same object ─────────────────────────────────────── */
{
  const roster = { s1: inVoice("alice") };
  assert.equal(holdVoicePresence(roster, {}, live).clients, roster);
}

/* ── You are your socket while it is in the roster, your user id otherwise ─ */
{
  const clients = { s1: inVoice("alice"), s2: inVoice("bob") };
  assert.equal(resolveSelfClientId(clients, "s1", "alice"), "s1");
  // socket.io clears the id on disconnect, and the next one isn't in the roster yet.
  assert.equal(resolveSelfClientId(clients, undefined, "alice"), "s1");
  assert.equal(resolveSelfClientId(clients, "n9", "alice"), "s1");
  assert.equal(resolveSelfClientId(clients, undefined, undefined), undefined);
  // A second device of yours that isn't in voice doesn't take your tile.
  const twoDevices = { d1: forgotten("alice"), d2: inVoice("alice") };
  assert.equal(resolveSelfClientId(twoDevices, undefined, "alice"), "d2");
  // While your socket is listed it wins, so the device in voice elsewhere isn't drawn as you.
  assert.equal(resolveSelfClientId(twoDevices, "d1", "alice"), "d1");
}

/* ── Speaking and latency follow the held tile, not the socket (GRYT-1373) ── */
{
  const before = { s1: inVoice("alice"), s2: inVoice("bob") };
  let latency = recordByServerUser({}, before, "s2", { estimatedOneWayMs: 25 });
  assert.deepEqual(latency, { bob: { estimatedOneWayMs: 25 } });

  // Restarted, and bob's new socket hasn't re-announced yet.
  const { clients } = settle([before, { n1: forgotten("alice"), n2: forgotten("bob") }]);
  // The speaking poll reads the analyser for this streamID, so the ring keeps going.
  assert.equal(clients.n2.streamID, "mic-bob");
  latency = keepInVoice(latency, clients);
  assert.deepEqual(byRosterClientId(latency, clients), { n2: { estimatedOneWayMs: 25 } });

  // A report from a socket the roster doesn't know yet is dropped, not filed under nobody.
  assert.equal(recordByServerUser(latency, clients, "n9", { estimatedOneWayMs: 1 }), latency);
  latency = recordByServerUser(latency, clients, "n2", { estimatedOneWayMs: 30 });
  assert.deepEqual(byRosterClientId(latency, clients), { n2: { estimatedOneWayMs: 30 } });
}

/* ── A ring polled under the old socket is drawn on the new one straight away ─ */
{
  const speaking = { bob: true };
  const reannounced = settle([
    { s1: inVoice("alice"), s2: inVoice("bob") },
    { n1: forgotten("alice") },
    { n1: forgotten("alice"), n2: inVoice("bob") },
  ]).clients;
  assert.deepEqual(byRosterClientId(speaking, reannounced), { n2: true });
  // Nobody without a serverUserId is merged with anybody else.
  const anon = { a1: { nickname: "x", hasJoinedChannel: true } };
  assert.deepEqual(byRosterClientId({ a1: true }, anon), { a1: true });
}

/* ── Leaving drops the figure, so a rejoin doesn't show the old one ─────────── */
{
  const latency = { alice: { estimatedOneWayMs: 25 } };
  const left = { s1: forgotten("alice") };
  assert.deepEqual(byRosterClientId(keepInVoice(latency, left), left), {});
  const still = { s1: inVoice("alice") };
  assert.equal(keepInVoice(latency, still), latency);
}

console.log("held voice presence: ok");
