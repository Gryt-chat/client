// Type-only, so scripts/check-hosted-server-reconnect.mjs can run this against a real socket.
import type { Socket } from "socket.io-client";

/** Takes back the listeners of a retry still waiting, so a second one replaces it. */
const waiting = new WeakMap<Socket, () => void>();

/**
 * Connects now, not when socket.io's queued retry comes round, and after it gave up too.
 * `onConnect` runs once, told whether socket.io's own reconnect handled that connection.
 */
export function retryNow(
  socket: Socket,
  onConnect: (reconnectRan: boolean) => void,
): void {
  waiting.get(socket)?.();

  let reconnectRan = false;
  const onReconnect = () => {
    reconnectRan = true;
  };
  const onConnected = () => {
    done();
    onConnect(reconnectRan);
  };
  const done = () => {
    socket.io.off("reconnect", onReconnect);
    socket.off("connect", onConnected);
    waiting.delete(socket);
  };

  socket.io.on("reconnect", onReconnect);
  socket.on("connect", onConnected);
  waiting.set(socket, done);

  // connect() alone waits out a retry already queued, up to ten seconds. Closing drops it.
  socket.disconnect();
  socket.connect();
}

/** What socket.io's reconnect event runs, for a socket that came back another way. */
export function replayReconnect(socket: Socket): void {
  for (const listener of [...socket.io.listeners("reconnect")]) listener(0);
}
