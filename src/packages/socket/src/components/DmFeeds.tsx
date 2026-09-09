import { useEffect } from "react";
import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";

import { forgetHost, setHostConversations } from "../hooks/dmDirectory";
import { useDirectMessages } from "../hooks/useDirectMessages";
import { useSockets } from "../hooks/useSockets";

/**
 * Every server's conversations, into one store. `useDirectMessages` answers for
 * one socket, and the direct messages space needs all of them (GRYT-1134).
 */

/* One host. A component rather than a loop, because the thing underneath is a
   hook and the number of servers changes while the app is running. */
function HostFeed({ host, socket, isConnected }: { host: string; socket: Socket; isConnected: boolean }) {
  const { conversations } = useDirectMessages({
    socket,
    accessToken: getServerAccessToken(host),
    isConnected,
  });

  /* Publish and forget in one effect. Split in two, StrictMode's cleanup ran
     the forget while the publish saw unchanged deps and never re-fired. */
  useEffect(() => {
    setHostConversations(host, conversations);
    return () => forgetHost(host);
  }, [host, conversations]);

  return null;
}

/** Mounted once, above whichever server happens to be on screen. */
export function DmFeeds() {
  const { sockets, serverConnectionStatus } = useSockets();

  return (
    <>
      {Object.entries(sockets).map(([host, socket]) =>
        socket ? (
          <HostFeed
            key={host}
            host={host}
            socket={socket}
            /* The status, not `socket.connected`: that is read once at render
               and never says so when the socket comes up. */
            isConnected={serverConnectionStatus[host] === "connected"}
          />
        ) : null,
      )}
    </>
  );
}
