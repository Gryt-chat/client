import type { Page } from "@playwright/test";
import { io, type Socket } from "socket.io-client";

/** The access token a page holds for a server, which is what an admin event carries. */
export async function accessTokenOf(page: Page, host: string): Promise<string> {
  const token = await page.evaluate((key) => localStorage.getItem(key) ?? sessionStorage.getItem(key), `accessToken_${host}`);
  if (!token) throw new Error(`The page holds no access token for ${host}`);
  return token;
}

/** Who a token says its holder is on the server. */
export function serverUserIdOf(token: string): string {
  const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { serverUserId?: string };
  if (!claims.serverUserId) throw new Error("The token names no serverUserId");
  return claims.serverUserId;
}

/** A socket from the test process, for setup the app has no quick way to do. Closed when `run` ends. */
export async function withSocket<T>(httpBase: string, run: (socket: Socket) => Promise<T>): Promise<T> {
  const socket = io(httpBase, { transports: ["websocket"], reconnection: false });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return await run(socket);
  } finally {
    socket.disconnect();
  }
}

/** Sends `event` and waits for a `reply` that `accept` takes. The server's own error fails it. */
export function ask<T>(
  socket: Socket,
  event: string,
  payload: unknown,
  reply: string,
  accept: (data: T) => boolean = () => true,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      socket.off(reply, onReply);
      socket.off("server:error", onError);
    };
    const onReply = (data: T) => {
      if (!accept(data)) return;
      done();
      resolve(data);
    };
    const onError = (error: { error?: string; message?: string }) => {
      done();
      reject(new Error(`${event} was refused: ${error?.error} ${error?.message ?? ""}`));
    };
    const timer = setTimeout(() => {
      done();
      reject(new Error(`No ${reply} came back for ${event}`));
    }, 10_000);
    socket.on(reply, onReply);
    socket.on("server:error", onError);
    socket.emit(event, payload);
  });
}

/** An invite made by whoever `token` belongs to, optionally handing out a role. */
export async function createInvite(
  httpBase: string,
  token: string,
  options: { grantsRole?: string; maxUses?: number } = {},
): Promise<string> {
  return withSocket(httpBase, async (socket) => {
    const created = await ask<{ invite?: { code?: string } }>(
      socket,
      "server:invites:create",
      { accessToken: token, maxUses: options.maxUses ?? 5, grantsRole: options.grantsRole ?? null },
      "server:invite:created",
    );
    if (!created.invite?.code) throw new Error("The server made an invite with no code");
    return created.invite.code;
  });
}
