import { useEffect, useState } from "react";

import { emitAuthenticated } from "../utils/tokenManager";
import { useSockets } from "./useSockets";

/**
 * Per server, who'd take a new DM or group add from you (GRYT-1815), asked while
 * `open`. A server that hasn't answered has no entry, and an older one never does.
 */
export function useReachable(open: boolean): Record<string, ReadonlySet<string>> {
  const { sockets, memberLists, serverConnectionStatus } = useSockets();
  const [reachable, setReachable] = useState<Record<string, ReadonlySet<string>>>({});

  // Asked again when somebody joins or leaves, not on every status change.
  const memberKey = Object.keys(sockets)
    .map((host) => `${host}:${serverConnectionStatus[host]}:${(memberLists[host] ?? []).length}`)
    .join(",");

  useEffect(() => {
    if (!open) {
      setReachable({});
      return;
    }
    const offs: (() => void)[] = [];
    for (const [host, socket] of Object.entries(sockets)) {
      if (!socket || serverConnectionStatus[host] !== "connected") continue;
      const ids = (memberLists[host] ?? []).map((m) => m.serverUserId).slice(0, 500);
      if (ids.length === 0) continue;
      const answer = (payload: { ids?: string[] }) =>
        setReachable((prev) => ({ ...prev, [host]: new Set(payload?.ids ?? []) }));
      socket.on("contact:reachable", answer);
      offs.push(() => socket.off("contact:reachable", answer));
      void emitAuthenticated(socket, "contact:reachable", { ids }, host);
    }
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, memberKey]);

  return reachable;
}
