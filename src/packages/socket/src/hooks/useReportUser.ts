import { useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

/**
 * Reporting a person to the moderators of the server you are both on.
 *
 * Separate from the message report in `useChat`, which fires and forgets: there
 * the message is on screen, so a report that quietly went nowhere still leaves
 * the thing that prompted it visible. Here the entire report is what somebody
 * just typed.
 *
 * So this waits for an answer. A server too old to know `user:report` sends
 * none — the event is simply not registered — and the timeout below is the only
 * way to tell that apart from a report that landed.
 */

const NO_ANSWER_MS = 6_000;

export interface UseReportUserResult {
  reportUser: (args: { serverUserId: string; reason: string }) => void;
}

export function useReportUser({
  socket,
  accessToken,
}: {
  socket: Socket | null;
  accessToken: string | null;
}): UseReportUserResult {
  const waiting = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const settle = useCallback((serverUserId: string) => {
    const timer = waiting.current.get(serverUserId);
    if (timer) {
      clearTimeout(timer);
      waiting.current.delete(serverUserId);
    }
    return !!timer;
  }, []);

  useEffect(() => {
    if (!socket) return;

    const onSubmitted = (payload: { serverUserId?: string }) => {
      if (!payload?.serverUserId) return;
      if (settle(payload.serverUserId)) toast.success("Report sent to the moderators");
    };

    const onAlready = (payload: { serverUserId?: string }) => {
      if (!payload?.serverUserId) return;
      if (settle(payload.serverUserId)) {
        toast("You already have an open report about them", { icon: "ℹ️" });
      }
    };

    socket.on("report:user_submitted", onSubmitted);
    socket.on("report:user_already_reported", onAlready);

    return () => {
      socket.off("report:user_submitted", onSubmitted);
      socket.off("report:user_already_reported", onAlready);
    };
  }, [socket, settle]);

  /* Every outstanding timer is dropped when the socket goes, rather than left
     to fire against a server nobody is talking to any more. A disconnect is not
     evidence that the server is too old. */
  useEffect(() => {
    const timers = waiting.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [socket]);

  const reportUser = useCallback(
    ({ serverUserId, reason }: { serverUserId: string; reason: string }) => {
      if (!socket || !accessToken) return;

      const existing = waiting.current.get(serverUserId);
      if (existing) clearTimeout(existing);

      waiting.current.set(
        serverUserId,
        setTimeout(() => {
          waiting.current.delete(serverUserId);
          toast.error("This server is too old to take reports about a person");
        }, NO_ANSWER_MS),
      );

      socket.emit("user:report", { accessToken, serverUserId, reason });
    },
    [socket, accessToken],
  );

  return { reportUser };
}
