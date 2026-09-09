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
function HostFeed({ host, socket }: { host: string; socket: Socket }) {
  const { conversations } = useDirectMessages({
    socket,
    accessToken: getServerAccessToken(host),
    isConnected: socket.connected,
  });

  useEffect(() => {
    setHostConversations(host, conversations);
  }, [host, conversations]);

  /* Leaving a server should take its rows with it, rather than leaving a list
     that offers conversations on something no longer connected. */
  useEffect(() => () => forgetHost(host), [host]);

  return null;
}

/** Mounted once, above whichever server happens to be on screen. */
export function DmFeeds() {
  const { sockets } = useSockets();

  return (
    <>
      {Object.entries(sockets).map(([host, socket]) =>
        socket ? <HostFeed key={host} host={host} socket={socket} /> : null,
      )}
    </>
  );
}
