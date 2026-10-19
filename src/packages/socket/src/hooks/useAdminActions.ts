import { useCallback, useState } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import type { MemberInfo } from "../components/MemberSidebar";
import { emitAuthenticated } from "../utils/tokenManager";

interface PendingUser {
  id: string;
  nickname: string;
}

export interface MemberInviteInfo {
  targetServerUserId: string;
  /** Null when they did not arrive on an invite — a LAN join, an open server, or the first member. */
  code: string | null;
  active: boolean;
  usesConsumed: number;
  maxUses: number;
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
   * One way to send a moderation action, for all of them. There used to be two,
   * and the memoised-token half failed silently on an expired token.
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
    (
      targetServerUserId: string,
      reason?: string,
      expiresInMinutes?: number | null,
      deleteContent = true,
      revokeInvite = false,
    ) => {
      void send("server:ban", {
        targetServerUserId,
        reason: reason?.trim() || undefined,
        expiresInMinutes: expiresInMinutes ?? null,
        deleteContent,
        revokeInvite,
      });
    },
    [send],
  );

  /**
   * How a member got in, asked for when the ban dialog opens: banning somebody on
   * a live invite achieves less than it looks. Resolves to null rather than throwing.
   */
  const fetchMemberInvite = useCallback(
    (targetServerUserId: string): Promise<MemberInviteInfo | null> => {
      if (!currentConnection) return Promise.resolve(null);
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          currentConnection.off("server:member:invite", onInfo);
          resolve(null);
        }, 5000);
        const onInfo = (info: MemberInviteInfo) => {
          if (info?.targetServerUserId !== targetServerUserId) return;
          clearTimeout(timer);
          currentConnection.off("server:member:invite", onInfo);
          resolve(info);
        };
        currentConnection.on("server:member:invite", onInfo);
        void send("server:member:invite", { targetServerUserId });
      });
    },
    [currentConnection, send],
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

  /**
   * Give one role or take it away, leaving the rest. `server:roles:set` replaces
   * everything, which silently took away the first role when adding a second.
   */
  const handleToggleRole = useCallback((targetServerUserId: string, role: string, hold: boolean) => {
    void send(hold ? "server:roles:add" : "server:roles:remove", { serverUserId: targetServerUserId, role });
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
    handleDisconnectUser, handleKickUser, handleBanUser, handleUnbanUser, fetchMemberInvite,
    handleServerMuteUser, handleServerDeafenUser, handleToggleRole,
    requestDisconnectUser, requestKickUser, requestBanUser,
  };
}
