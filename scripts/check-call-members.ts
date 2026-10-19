/**
 * A call can see who is in it. The server blanks the conversation id out of the
 * payloads that reach everybody, and `voice:call:members` is the repair (GRYT-680).
 */

import assert from "node:assert/strict";

import {
  applyCallMemberships,
  rememberCallMembers,
} from "../src/packages/socket/src/lib/callMembers.ts";
import type { Client, Clients } from "../src/packages/socket/src/types/clients.ts";

const PAIR = "dm_1111111111111111111111111111aaaa";

/** A whole client, with what each check is about given and the rest at rest. */
function client(about: Pick<Client, "serverUserId" | "nickname" | "hasJoinedChannel" | "voiceChannelId">): Client {
  return { isMuted: false, isDeafened: false, color: "", streamID: "", isAFK: false, ...about };
}

/** A client as `server:clients` sends it: in a call, with the id blanked out. */
function inACall(serverUserId: string) {
  return client({ serverUserId, nickname: serverUserId, hasJoinedChannel: true, voiceChannelId: "" });
}

/* ── The id is written back onto the people in the call ──────────────────── */
{
  const clients: Clients = { s1: inACall("user_alice"), s2: inACall("user_bob") };
  const next = applyCallMemberships(clients, { [PAIR]: ["user_alice", "user_bob"] });

  assert.equal(next.s1.voiceChannelId, PAIR);
  assert.equal(next.s2.voiceChannelId, PAIR);
}

/* ── And not onto anybody else ───────────────────────────────────────────── */
{
  const clients: Clients = {
    s1: inACall("user_alice"),
    // Somebody in a voice channel, minding their own business.
    s2: client({ serverUserId: "user_cleo", nickname: "Cleo", hasJoinedChannel: true, voiceChannelId: "general" }),
  };
  const next = applyCallMemberships(clients, { [PAIR]: ["user_alice"] });

  assert.equal(next.s1.voiceChannelId, PAIR);
  assert.equal(next.s2.voiceChannelId, "general", "a channel must not be rewritten");
}

/* ── Somebody who has hung up does not stay in the call ──────────────────── */
{
  // The server says they are no longer in voice; the remembered membership is
  // one message behind. Writing the id back would keep them on screen.
  const clients: Clients = {
    s1: client({ serverUserId: "user_bob", nickname: "Bob", hasJoinedChannel: false, voiceChannelId: "" }),
  };
  const next = applyCallMemberships(clients, { [PAIR]: ["user_bob"] });

  assert.equal(next.s1.voiceChannelId, "");
}

/* ── Nothing to do is the same object ────────────────────────────────────── */
{
  // This runs inside the `server:clients` handler, which fires constantly.
  const clients: Clients = { s1: inACall("user_alice") };
  assert.equal(applyCallMemberships(clients, {}), clients);

  const already: Clients = { s1: { ...inACall("user_alice"), voiceChannelId: PAIR } };
  assert.equal(
    applyCallMemberships(already, { [PAIR]: ["user_alice"] }),
    already,
    "a map that needed no change must not be rebuilt",
  );
}

/* ── A call that ended stops being remembered ────────────────────────────── */
{
  const held = rememberCallMembers({}, PAIR, ["user_alice", "user_bob"]);
  assert.deepEqual(held[PAIR], ["user_alice", "user_bob"]);

  const emptied = rememberCallMembers(held, PAIR, []);
  assert.equal(PAIR in emptied, false, "an empty call has to be forgotten, not stored empty");

  // Which matters because the ids would otherwise be written back onto whoever
  // reconnects with them next.
  const clients: Clients = { s1: inACall("user_alice") };
  assert.equal(applyCallMemberships(clients, emptied), clients);
}

/* ── Two calls do not bleed into each other ──────────────────────────────── */
{
  const OTHER = "dm_2222222222222222222222222222bbbb";
  const clients: Clients = { s1: inACall("user_alice"), s2: inACall("user_cleo") };
  const next = applyCallMemberships(clients, {
    [PAIR]: ["user_alice"],
    [OTHER]: ["user_cleo"],
  });

  assert.equal(next.s1.voiceChannelId, PAIR);
  assert.equal(next.s2.voiceChannelId, OTHER);
}

console.log("call members: the id goes back to the people in the call, and to nobody else");
