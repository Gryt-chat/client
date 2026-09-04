import { useEffect, useRef } from "react";

import type { Client } from "../types/clients";

/**
 * Server events delivered to this client as if the server had sent them.
 *
 * `fakeParticipants.ts` writes fake people straight into the `clients` record,
 * which skips everything between the socket and that record — so a bug in the
 * handling cannot show up there. Two bugs shipped in calling behind that gap.
 * This one starts before the handler: `deliverServerEvent` calls the client's
 * own listeners for an event, so it is the same handler, the same state updates
 * and the same re-render. What it does not exercise is the wire and the server.
 *
 * **Dev only, and gated twice.** `import.meta.env.DEV` is compiled out of a
 * packaged build, and every entry point checks it again. A build that could
 * inject events into its own socket is a build that can be made to show
 * somebody a call that is not happening.
 */

/** Enough of a socket to deliver to, without depending on socket.io's types. */
export interface ListenerSource {
  listeners: (event: string) => Array<(...args: unknown[]) => void>;
}

/**
 * Hand a payload to this client's handlers for `event`.
 *
 * `listeners` is the Emitter's, not the wire's — nothing here reaches the
 * server and the server never hears about it. Returns how many handlers ran, so
 * a fixture can tell "nothing is listening" from "it worked".
 *
 * A listener that throws does not take the rest of the batch with it. That is
 * the app's problem to show, not this fixture's to swallow.
 */
export function deliverServerEvent(
  socket: ListenerSource | null | undefined,
  event: string,
  payload: unknown,
): number {
  if (!import.meta.env.DEV) return 0;
  if (!socket) return 0;

  const listeners = socket.listeners(event);
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* deliberately kept going */
    }
  }
  return listeners.length;
}

/** The person a fake ring comes from. Not a real member, and says so. */
export const FAKE_CALLER = {
  server_user_id: "fake-caller",
  nickname: "Ingrid",
};

/**
 * A ring, as the server sends one.
 *
 * The shape is copied from the server's `IncomingCall` rather than from what
 * the client happens to read, so a client that reads the wrong field shows the
 * wrong thing here too instead of quietly working.
 */
export function fakeIncomingCall(conversationId: string, ttlMs = 30_000) {
  return {
    conversation_id: conversationId,
    from: FAKE_CALLER,
    expires_at: Date.now() + ttlMs,
  };
}

/**
 * Somebody else in a call, as `server:clients` actually carries them.
 *
 * **`voiceChannelId` is deliberately blank.** That is not an oversight and must
 * not be "fixed": the server blanks a conversation id out of this payload
 * because it goes to every member of the server and a one-to-one id is a hash
 * of the sorted pair. A fixture that fills it in is a fixture that cannot
 * reproduce the bug where a call draws nobody — which is the bug that shipped.
 *
 * `voice:call:members` is what puts the id back, and only for the people in the
 * call. Deliver both to see a working call; deliver this one alone to see what
 * a client that ignores that event looks like.
 */
export function fakeCallPeer(serverUserId = "fake-peer", nickname = "Ingrid"): Client {
  return {
    serverUserId,
    nickname,
    color: "var(--gryt-neutral-6)",
    isMuted: false,
    isDeafened: false,
    streamID: "",
    hasJoinedChannel: true,
    voiceChannelId: "",
    isConnectedToVoice: true,
    isAFK: false,
    cameraEnabled: false,
    cameraStreamID: "",
    screenShareEnabled: false,
    screenShareVideoStreamID: "",
    screenShareAudioStreamID: "",
    isServerMuted: false,
    isServerDeafened: false,
  } as Client;
}

/** What the fixtures were asked for, off the query string. */
export interface FakeCallOptions {
  /** Deliver a `call:incoming` for the conversation being read. */
  ring: boolean;
  /** Put somebody else in the call, the way the server would. */
  peer: boolean;
  /**
   * Whether to also send `voice:call:members`.
   *
   * Off reproduces the shipped bug on purpose: the peer arrives with a blank
   * room and the call draws nobody. On is what a working server does.
   */
  members: boolean;
}

export function readFakeCallOptions(search: string): FakeCallOptions | null {
  if (!import.meta.env.DEV) return null;

  const params = new URLSearchParams(search);
  const ring = params.get("fakering") === "1";
  const peer = params.get("fakepeer") === "1";
  if (!ring && !peer) return null;

  return {
    ring,
    peer,
    // On unless asked otherwise, because a working call is the ordinary thing
    // to want to look at. `fakemembers=0` is how you ask for the broken one.
    members: params.get("fakecallmembers") !== "0",
  };
}

/**
 * Drive the fixtures for the conversation on screen.
 *
 * Waits for a conversation, because both fixtures name one: a ring is a ring
 * *about* something, and a peer is in a particular call. Opening a DM is
 * therefore part of the recipe, which is the same as it is for real.
 *
 * Fires once per conversation. A ring that re-delivered on every render would
 * be impossible to decline.
 */
export function useFakeCallEvents(
  socket: ListenerSource | null | undefined,
  conversationId: string | null,
  options: FakeCallOptions | null,
): void {
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!socket || !conversationId || !options) return;
    if (done.current === conversationId) return;
    done.current = conversationId;

    if (options.ring) {
      deliverServerEvent(socket, "call:incoming", fakeIncomingCall(conversationId));
    }

    if (options.peer) {
      const peer = fakeCallPeer();
      /* Through `server:clients`, blank room and all, because that is the
         payload the bug lived in. */
      deliverServerEvent(socket, "server:clients", { "fake-peer-socket": peer });

      if (options.members) {
        deliverServerEvent(socket, "voice:call:members", {
          conversation_id: conversationId,
          server_user_ids: [peer.serverUserId],
        });
      }
    }
  }, [socket, conversationId, options]);
}
