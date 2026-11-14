import type { Socket } from "socket.io-client";

import { getServerAccessToken } from "@/common";

/* "Send me your copy" asks this device has made, kept a week and sent again whenever the other
   person is online, since the server keeps nothing. Keyed by server and conversation. */
const KEY = "gryt_history_asks";
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_EVERY_MS = 10 * 60 * 1000;
const lastSent = new Map<string, number>();

type Asks = Record<string, { peer: string; at: number }>;

function read(): Asks {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Asks;
    const now = Date.now();
    return Object.fromEntries(Object.entries(parsed).filter(([, a]) => typeof a?.peer === "string" && now - a.at < KEEP_MS));
  } catch {
    return {};
  }
}

function write(asks: Asks): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(asks));
  } catch {
    // Not remembered then: the ask still goes now.
  }
}

const keyOf = (host: string, conversationId: string) => `${host} ${conversationId}`;

function send(socket: Socket, host: string, conversationId: string): void {
  const accessToken = getServerAccessToken(host);
  if (!accessToken) return;
  lastSent.set(keyOf(host, conversationId), Date.now());
  socket.emit("dm:history:ask", { accessToken, conversationId }, () => {});
}

export function askForHistory(socket: Socket, host: string, conversationId: string, peer: string): void {
  write({ ...read(), [keyOf(host, conversationId)]: { peer, at: Date.now() } });
  send(socket, host, conversationId);
}

/** From each member list: an ask whose person is online now goes again, at most every ten minutes. */
export function resendHistoryAsks(socket: Socket, host: string, online: (serverUserId: string) => boolean): void {
  for (const [key, ask] of Object.entries(read())) {
    const [askHost, conversationId] = key.split(" ");
    if (askHost !== host || !conversationId || !online(ask.peer)) continue;
    if (Date.now() - (lastSent.get(key) ?? 0) < RESEND_EVERY_MS) continue;
    send(socket, host, conversationId);
  }
}

/** Their copy arrived, so the ask is done. */
export function forgetHistoryAsk(host: string, conversationId: string): void {
  const asks = read();
  delete asks[keyOf(host, conversationId)];
  write(asks);
}

export function historyAsked(host: string, conversationId: string): boolean {
  return keyOf(host, conversationId) in read();
}
