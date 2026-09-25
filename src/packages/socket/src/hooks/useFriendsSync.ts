import { useEffect } from "react";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";

import { parseFriendList } from "../utils/friendList";
import {
  firstNoticeOf,
  forgetServerFriendList,
  registerFriendEmitter,
  setServerFriendList,
} from "./friendsStore";

/**
 * One server's friends into the store, and the store's buttons out to that server
 * (GRYT-1471). A server from before friends never answers, and shows nothing.
 */
export function useFriendsSync({
  host,
  serverName,
  socket,
  accessToken,
  isConnected,
}: {
  host: string;
  serverName: string;
  socket: Socket | null;
  accessToken: string | null;
  isConnected: boolean;
}): void {
  useEffect(() => {
    if (!socket || !accessToken || !isConnected) return;

    const onList = (payload: unknown) => {
      const list = parseFriendList(payload);
      if (list) setServerFriendList(host, list);
    };
    const onIncoming = (payload: { serverUserId?: unknown; nickname?: unknown }) => {
      if (typeof payload?.serverUserId !== "string" || !firstNoticeOf(host, payload.serverUserId)) return;
      const name = typeof payload.nickname === "string" && payload.nickname ? payload.nickname : "Somebody";
      toast(`${name} sent you a friend request on ${serverName}.`, { id: `friend:${host}:${payload.serverUserId}` });
    };
    const onError = (payload: { message?: unknown }) => {
      if (typeof payload?.message === "string") toast.error(payload.message, { id: "friend:error" });
    };

    socket.on("friend:list", onList);
    socket.on("friend:request:incoming", onIncoming);
    socket.on("friend:error", onError);
    registerFriendEmitter(host, (event, serverUserId) => socket.emit(event, { accessToken, serverUserId }));
    socket.emit("friend:list", { accessToken });

    return () => {
      socket.off("friend:list", onList);
      socket.off("friend:request:incoming", onIncoming);
      socket.off("friend:error", onError);
      registerFriendEmitter(host, null);
    };
  }, [host, serverName, socket, accessToken, isConnected]);

  // The list is the server's claim for this session, so a server that's gone takes it along.
  useEffect(() => () => forgetServerFriendList(host), [host]);
}
