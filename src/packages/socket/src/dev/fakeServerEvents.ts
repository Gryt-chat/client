import { useEffect, useRef } from "react";

import type { Client } from "../types/clients";

/**
 * Server events delivered to this client as if the server had sent them, through
 * its own listeners. **Dev only, and gated twice** — `import.meta.env.DEV`.
 */

/** Enough of a socket to deliver to, without depending on socket.io's types. */
export interface ListenerSource {
  listeners: (event: string) => Array<(...args: unknown[]) => void>;
}

/**
 * Hand a payload to this client's handlers for `event`. Nothing reaches the
 * server. Returns how many handlers ran, so "nothing is listening" is visible.
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
 * A ring, as the server sends one. The shape is copied from the server's
 * `IncomingCall`, so a client reading the wrong field shows the wrong thing here.
 */
export function fakeIncomingCall(conversationId: string, ttlMs = 30_000) {
  return {
    conversation_id: conversationId,
    from: FAKE_CALLER,
    expires_at: Date.now() + ttlMs,
  };
}

/**
 * Somebody else in a call, as `server:clients` carries them. **`voiceChannelId`
 * is deliberately blank** — the server blanks it, and filling it in hides a bug.
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
   * Whether to also send `voice:call:members`. Off reproduces the shipped bug:
   * the peer arrives with a blank room and the call draws nobody.
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
 * Drive the fixtures for the conversation on screen. Waits for one, because both
 * fixtures name one. Fires once per conversation, so a ring can be declined.
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
