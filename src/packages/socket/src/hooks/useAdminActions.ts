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
   * One way to send a moderation action, for all of them.
   *
   * There used to be two. Kick and ban went through `emitAuthenticated`, which
   * refreshes an expiring token first; mute, deafen and role changes used a
   * memoised `accessToken` that only re-read when `tokenRevision` changed, so
   * an expired token made those three fail server-side with an error nothing
   * surfaced. The returned promise was dropped too, so "no access token" meant
   * the emit silently never happened.
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
   * How a member got in, asked for when the ban dialog opens.
   *
   * Banning somebody who arrived on a still-live invite achieves less than it
   * looks: an identity with no account behind it costs nothing to replace, so
   * they can come back on a new key using the same code.
   *
   * Resolves to null rather than throwing. A dialog that cannot answer this
   * should still let somebody be banned.
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
   * Give one role or take it away, leaving the rest.
   *
   * Was `handleChangeRole`, which sent `server:roles:set` — replace everything
   * they hold with this one. That is still right for a demotion, and the wrong
   * default now that roles stack: an operator giving somebody a second role
   * would have silently taken away the first.
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
