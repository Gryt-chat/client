import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import type { MemberInfo } from "../components/MemberSidebar";
import { emitAuthenticated } from "../utils/tokenManager";

interface PendingUser {
  id: string;
  nickname: string;
}

interface UseAdminActionsParams {
  currentConnection: Socket | null;
  currentlyViewingServer: { host: string; name: string } | null;
  accessToken: string | null;
  memberLists: Record<string, MemberInfo[] | undefined>;
}

export function useAdminActions({
  currentConnection, currentlyViewingServer, memberLists,
}: UseAdminActionsParams) {
  const [pendingDisconnectUser, setPendingDisconnectUser] = useState<PendingUser | null>(null);
  const [pendingKickUser, setPendingKickUser] = useState<PendingUser | null>(null);
  const [pendingBanUser, setPendingBanUser] = useState<PendingUser | null>(null);

  /**
   * One way to send a moderation action, for all of them.
   *
   * There used to be two. Kick and ban went through `emitAuthenticated`, which
   * refreshes an expiring token first; mute, deafen and role changes used a
   * memoised `accessToken` that only re-read when `tokenRevision` changed, so
   * an expired token made those three fail server-side with an error nothing
   * surfaced.
   *
   * The returned promise was also dropped, so "no access token" meant the emit
   * silently never happened and the moderator saw exactly nothing. Now it says
   * so.
   */
  const send = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      if (!currentConnection || !currentlyViewingServer) return;
      const sent = await emitAuthenticated(
        currentConnection,
        event,
        payload,
        currentlyViewingServer.host,
      );
      if (!sent) {
        toast.error("Not signed in to this server — try reconnecting.");
      }
    },
    [currentConnection, currentlyViewingServer],
  );

  const handleDisconnectUser = useCallback((targetServerUserId: string) => {
    void send("voice:disconnect:user", { targetServerUserId });
  }, [send]);

  const handleKickUser = useCallback((targetServerUserId: string, reason?: string) => {
    void send("server:kick", { targetServerUserId, reason: reason?.trim() || undefined });
  }, [send]);

  const handleBanUser = useCallback(
    (targetServerUserId: string, reason?: string, expiresInMinutes?: number | null) => {
      void send("server:ban", {
        targetServerUserId,
        reason: reason?.trim() || undefined,
        expiresInMinutes: expiresInMinutes ?? null,
      });
    },
    [send],
  );

  const handleUnbanUser = useCallback((grytUserId: string) => {
    void send("server:unban", { grytUserId });
  }, [send]);

  const handleServerMuteUser = useCallback((targetServerUserId: string, muted: boolean) => {
    void send("server:mute", { targetServerUserId, muted });
  }, [send]);

  const handleServerDeafenUser = useCallback((targetServerUserId: string, deafened: boolean) => {
    void send("server:deafen", { targetServerUserId, deafened });
  }, [send]);

  const handleChangeRole = useCallback((targetServerUserId: string, role: string) => {
    void send("server:roles:set", { serverUserId: targetServerUserId, role });
  }, [send]);

  const lookupNickname = useCallback((serverUserId: string) => {
    const members = currentlyViewingServer ? memberLists[currentlyViewingServer.host] : undefined;
    return members?.find((m) => m.serverUserId === serverUserId)?.nickname || "this user";
  }, [currentlyViewingServer, memberLists]);

  const requestDisconnectUser = useCallback((targetServerUserId: string) => {
    setPendingDisconnectUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  const requestKickUser = useCallback((targetServerUserId: string) => {
    setPendingKickUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  const requestBanUser = useCallback((targetServerUserId: string) => {
    setPendingBanUser({ id: targetServerUserId, nickname: lookupNickname(targetServerUserId) });
  }, [lookupNickname]);

  return {
    pendingDisconnectUser, setPendingDisconnectUser,
    pendingKickUser, setPendingKickUser,
    pendingBanUser, setPendingBanUser,
    handleDisconnectUser, handleKickUser, handleBanUser, handleUnbanUser,
    handleServerMuteUser, handleServerDeafenUser, handleChangeRole,
    requestDisconnectUser, requestKickUser, requestBanUser,
  };
}
