import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

/**
 * Ringing, and only ringing.
 *
 * A call is not a thing the server keeps — it is an SFU room whose id is the
 * conversation id, joined the same way a voice channel is. So nothing here
 * tracks a call in progress: once you are in, the existing voice state is the
 * truth about it.
 *
 * Answering is not an event. It is `connect(conversationId)`, the ordinary
 * voice join, and the server ends the ring when the join lands — which is why
 * `accept` takes a callback rather than emitting anything.
 */

export interface IncomingCall {
  conversation_id: string;
  from: { server_user_id: string; nickname: string };
  /** When the server gives up on its own. */
  expires_at: number;
}

/** Why a ring stopped, as the server tells it. */
export type CallEndReason = "answered" | "declined" | "cancelled" | "timeout";

interface CallWithdrawn {
  conversation_id?: string;
  reason?: CallEndReason;
  ended_by?: string | null;
}

interface UseCallsParams {
  socket: Socket | null;
  accessToken: string | null;
  isConnected: boolean;
}

interface UseCallsResult {
  /** Somebody is ringing you, and you have not answered. At most one. */
  incoming: IncomingCall | null;
  /** You are ringing this conversation and nobody has picked up yet. */
  outgoing: IncomingCall | null;
  /** Ring everybody else in a conversation. */
  ring: (conversationId: string) => void;
  /** Say no. Ends it for everybody, which is what the server does with it. */
  decline: (conversationId: string) => void;
  /** Give up on one you started. */
  cancel: (conversationId: string) => void;
  /**
   * Take the call: clears the ring here and hands the conversation id back so
   * the caller can join its room. The server ends the ring on the join.
   */
  accept: () => IncomingCall | null;
}

export function useCalls({ socket, accessToken, isConnected }: UseCallsParams): UseCallsResult {
  const [incoming, setIncoming] = useState<IncomingCall | null>(null);
  const [outgoing, setOutgoing] = useState<IncomingCall | null>(null);

  useEffect(() => {
    if (!socket || !accessToken || !isConnected) return;

    const onIncoming = (call: IncomingCall) => {
      if (!call?.conversation_id) return;
      setIncoming(call);
    };

    /* Your own other device started this. Showing it means a call rung from the
       phone does not look like nothing on the laptop. */
    const onRinging = (call: IncomingCall) => {
      if (!call?.conversation_id) return;
      setOutgoing(call);
    };

    const onWithdrawn = (payload: CallWithdrawn) => {
      if (!payload?.conversation_id) return;
      setIncoming((prev) => (prev?.conversation_id === payload.conversation_id ? null : prev));
      setOutgoing((prev) => (prev?.conversation_id === payload.conversation_id ? null : prev));

      // Only the caller's end is worth saying out loud, and only when nobody
      // took it. "Answered" is followed by being in a call, which says itself.
      if (payload.reason === "declined") toast("Call declined");
      if (payload.reason === "timeout") toast("No answer");
    };

    const onError = (payload: { error?: string; message?: string }) => {
      if (payload?.message) toast.error(payload.message);
    };

    socket.on("call:incoming", onIncoming);
    socket.on("call:ringing", onRinging);
    socket.on("call:withdrawn", onWithdrawn);
    socket.on("call:error", onError);

    return () => {
      socket.off("call:incoming", onIncoming);
      socket.off("call:ringing", onRinging);
      socket.off("call:withdrawn", onWithdrawn);
      socket.off("call:error", onError);
    };
  }, [socket, accessToken, isConnected]);

  // A server from before calls existed sends none of these, so both stay null
  // and nothing appears. Switching servers must not leave the last one's ring
  // on screen.
  useEffect(() => {
    setIncoming(null);
    setOutgoing(null);
  }, [socket]);

  /**
   * The server's own clock, kept locally as well.
   *
   * The withdrawal on a timeout is the real end and this is not a substitute
   * for it — but a ring whose socket died would otherwise sit on screen for
   * ever, and "answer" on it would join an empty room.
   */
  useEffect(() => {
    const call = incoming ?? outgoing;
    if (!call) return;
    const remaining = call.expires_at - Date.now();
    if (remaining <= 0) {
      setIncoming(null);
      setOutgoing(null);
      return;
    }
    const timer = setTimeout(() => {
      setIncoming((prev) => (prev?.conversation_id === call.conversation_id ? null : prev));
      setOutgoing((prev) => (prev?.conversation_id === call.conversation_id ? null : prev));
    }, remaining);
    return () => clearTimeout(timer);
  }, [incoming, outgoing]);

  const emit = useCallback(
    (event: string, conversationId: string) => {
      if (!socket || !accessToken) return;
      socket.emit(event, { accessToken, conversationId });
    },
    [socket, accessToken],
  );

  const ring = useCallback((conversationId: string) => emit("call:ring", conversationId), [emit]);

  const decline = useCallback(
    (conversationId: string) => {
      // Cleared here rather than waiting for the withdrawal, so the ringing
      // stops the moment it is refused. The server's answer arrives either way
      // and clearing twice costs nothing.
      setIncoming((prev) => (prev?.conversation_id === conversationId ? null : prev));
      emit("call:decline", conversationId);
    },
    [emit],
  );

  const cancel = useCallback(
    (conversationId: string) => {
      setOutgoing((prev) => (prev?.conversation_id === conversationId ? null : prev));
      emit("call:cancel", conversationId);
    },
    [emit],
  );

  const accept = useCallback(() => {
    const call = incoming;
    setIncoming(null);
    return call;
  }, [incoming]);

  return { incoming, outgoing, ring, decline, cancel, accept };
}
