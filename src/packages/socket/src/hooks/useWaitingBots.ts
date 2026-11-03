import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

/** Bots at the door, and known bots asking for more (GRYT-2006). Re-asked on every
    `server:details`, which is what a knock sends round. */
export function useWaitingBots(connection: Socket | null, accessToken: string | null, canManageBots: boolean): number {
  const [waiting, setWaiting] = useState(0);

  useEffect(() => {
    if (!connection || !canManageBots || !accessToken) {
      setWaiting(0);
      return;
    }
    const onBots = (payload: { bots?: { status?: string; more?: string[] }[] }) => {
      const bots = Array.isArray(payload?.bots) ? payload.bots : [];
      setWaiting(bots.filter((b) => b.status === "pending" || (b.status === "approved" && (b.more?.length ?? 0) > 0)).length);
    };
    const ask = () => connection.emit("server:bots:list", { accessToken });
    connection.on("server:bots", onBots);
    connection.on("server:details", ask);
    ask();
    return () => {
      connection.off("server:bots", onBots);
      connection.off("server:details", ask);
    };
  }, [connection, accessToken, canManageBots]);

  return waiting;
}
