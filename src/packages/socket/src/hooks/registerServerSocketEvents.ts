import { Dispatch, MutableRefObject, SetStateAction } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import {
  getServerAccessToken,
  getServerRefreshToken,
  getUploadsFileUrl,
  removeServerAccessToken,
  removeServerRefreshToken,
  setServerAccessToken,
  setServerRefreshToken,
} from "@/common";
import {
  Server,
  serverDetails,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";
import { warmSfuSelection } from "@/webRTC/src/hooks/selectBestSfuUrl";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients } from "../types/clients";
import { fetchCustomEmojis, setCustomEmojis } from "../utils/emojiData";
import { handleRateLimitError } from "../utils/rateLimitHandler";
import { syncAvatarToHost } from "../utils/syncAvatarToHost";

const TOKEN_HEAL_COOLDOWN_MS = 10_000;
const tokenHealLastAttempt = new Map<string, number>();

function canAttemptTokenHeal(host: string): boolean {
  const last = tokenHealLastAttempt.get(host) ?? 0;
  if (Date.now() - last < TOKEN_HEAL_COOLDOWN_MS) return false;
  tokenHealLastAttempt.set(host, Date.now());
  return true;
}

export interface ServerEventContext {
  nickname: string;
  userId: string | null;
  servers: Servers;
  serversRef: MutableRefObject<Servers>;
  lastInviteJoinAttemptRef: MutableRefObject<Record<string, string | undefined>>;
  myVoiceStateByHostRef: MutableRefObject<Record<string, { hasJoinedChannel: boolean; voiceChannelId: string }>>;
  setServers: (servers: Servers) => void;
  setNewServerInfo: Dispatch<SetStateAction<Server[]>>;
  setServerDetailsList: Dispatch<SetStateAction<serverDetailsList>>;
  setFailedServerDetails: Dispatch<SetStateAction<Record<string, { error: string; message: string; timestamp: number }>>>;
  setClients: Dispatch<SetStateAction<{ [host: string]: Clients }>>;
  setMemberLists: Dispatch<SetStateAction<{ [host: string]: MemberInfo[] }>>;
  setServerProfiles: Dispatch<SetStateAction<Record<string, { nickname: string; avatarFileId: string | null; avatarUrl: string | null }>>>;
  setIsServerMuted: (value: boolean) => void;
  setIsServerDeafened: (value: boolean) => void;
}

export function registerServerSocketEvents(socket: Socket, host: string, ctx: ServerEventContext) {
  const { nickname, userId, servers, serversRef, lastInviteJoinAttemptRef, myVoiceStateByHostRef } = ctx;
  const { setServers, setNewServerInfo, setServerDetailsList, setFailedServerDetails } = ctx;
  const { setClients, setMemberLists, setServerProfiles, setIsServerMuted, setIsServerDeafened } = ctx;

  socket.on("server:info", (data: { name?: string }) => {
    const current = serversRef.current[host];
    const updatedServer = {
      ...current,
      host,
      name: data.name || current?.name || host,
    };

    if (current && current.name === updatedServer.name) return;

    setNewServerInfo((old) => {
      if (old.some(server => server.host === updatedServer.host)) return old;
      return [...old, updatedServer];
    });
  });

  socket.on("server:details", (data: serverDetails) => {
    if (data.error === "join_required") {
      const existingAccessToken = getServerAccessToken(host);
      if (existingAccessToken) {
        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          socket.emit("token:refresh", { refreshToken });
        } else {
          socket.emit("token:refresh", { accessToken: existingAccessToken });
        }
        return;
      }
      setTimeout(() => {
        socket.emit("server:join", {
          nickname,
          inviteCode: servers[host]?.token || undefined,
        });
      }, 500);
      return;
    }

    if (data.error && data.message) {
      console.error(`Server details denied for ${host}:`, data.error, data.message);

      setFailedServerDetails(prev => ({
        ...prev,
        [host]: {
          error: data.error || 'unknown_error',
          message: data.message || 'Unknown error occurred',
          timestamp: Date.now()
        }
      }));

      if (data.error === 'rate_limited') {
        handleRateLimitError({ error: data.error, message: data.message }, "Server details");
      } else {
        toast.error(`Access denied: ${data.message}`);
      }
      return;
    }

    setServerDetailsList((old) => ({ ...old, [host]: data }));

    if (data.sfu_hosts?.length) {
      warmSfuSelection(host, data.sfu_hosts);
    }

    setFailedServerDetails(prev => {
      const updated = { ...prev };
      delete updated[host];
      return updated;
    });
  });

  socket.on("server:emojis:updated", () => {
    fetchCustomEmojis(host).then((list) => {
      setCustomEmojis(list, host);
    });
  });

  socket.on("server:joined", (joinInfo: { accessToken: string; refreshToken?: string; nickname: string; avatarFileId?: string | null }) => {
    setServerAccessToken(host, joinInfo.accessToken);
    if (joinInfo.refreshToken) {
      setServerRefreshToken(host, joinInfo.refreshToken);
    }

    setServerProfiles(prev => ({
      ...prev,
      [host]: {
        nickname: joinInfo.nickname,
        avatarFileId: joinInfo.avatarFileId || null,
        avatarUrl: joinInfo.avatarFileId
          ? getUploadsFileUrl(host, joinInfo.avatarFileId)
          : null,
      },
    }));

    socket.emit("server:details");
    socket.emit("members:fetch");

    if (joinInfo.accessToken && userId) {
      syncAvatarToHost(host, joinInfo.accessToken, joinInfo.avatarFileId, socket, setServerProfiles, userId)
        .catch(() => {});
    }
  });

  socket.on("profile:updated", (data: { nickname: string; avatarFileId: string | null }) => {
    setServerProfiles(prev => ({
      ...prev,
      [host]: {
        nickname: data.nickname,
        avatarFileId: data.avatarFileId,
        avatarUrl: data.avatarFileId
          ? getUploadsFileUrl(host, data.avatarFileId)
          : null,
      },
    }));
  });

  socket.on("server:setup_required", (payload: Record<string, unknown>) => {
    window.dispatchEvent(new CustomEvent("server_setup_required", {
      detail: { host, ...(payload || {}) }
    }));
  });

  socket.on("server:kicked", (data: { reason?: string }) => {
    toast.error(data?.reason || "You were kicked from the server.");
    removeServerAccessToken(host);
    window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
      detail: { host, reason: "kicked_from_server" },
    }));
  });

  socket.on("server:session:replaced", (data: { message?: string }) => {
    toast(data?.message || "You signed in from another device or tab.", {
      icon: "🔄",
      duration: 8000,
    });
    removeServerAccessToken(host);
    removeServerRefreshToken(host);
    window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
      detail: { host, reason: "session_replaced" },
    }));
  });

  socket.on("server:error", (errorInfo: { error: string; message?: string; retryAfterMs?: number; currentScore?: number; maxScore?: number; canReapply?: boolean }) => {
    console.error(`Server join failed for ${host}:`, errorInfo);

    if (errorInfo.error === 'rate_limited' && errorInfo.message) {
      handleRateLimitError(errorInfo, "Server connection");
      return;
    }

    if (errorInfo.error === "join_required") {
      setTimeout(() => {
        socket.emit("server:join", {
          nickname,
          inviteCode: serversRef.current[host]?.token || undefined,
        });
      }, 500);
      return;
    }

    if (errorInfo.error === 'invalid_invite') {
      const message = errorInfo.message || 'Invalid invite code.';
      toast.error(message, { duration: 6000 });

      const currentServers = serversRef.current;
      const existing = currentServers[host];
      if (existing?.token) {
        const nextServers = { ...currentServers, [host]: { ...existing, token: undefined } };
        setServers(nextServers);
        lastInviteJoinAttemptRef.current[host] = undefined;
      }

      toast(`Open a fresh invite link to re-join ${host}.`, { duration: 8000 });
      return;
    }

    if (errorInfo.error === "invite_rate_limited") {
      const message = errorInfo.message || "Too many incorrect invite attempts. Please wait.";
      toast.error(message, { duration: 6000 });
      return;
    }

    if (errorInfo.error === "invite_required") {
      const message = errorInfo.message || "This server is invite-only.";
      toast.error(message, { duration: 6000 });
      toast(`Open an invite link to join ${host}.`, { duration: 8000 });
      return;
    }

    if (errorInfo.error === 'user_not_authorized' || errorInfo.error === 'join_token_invalid' || errorInfo.error === 'join_verification_failed') {
      const message = errorInfo.message || 'You are not authorized to join this server.';
      toast.error(message, { duration: 6000 });
      setTimeout(() => {
        if (errorInfo.canReapply) {
          toast(
            `You can re-apply to join this server or remove it from your list. Check the server settings for more options.`,
            { duration: 8000, icon: 'ℹ️' }
          );
        } else {
          toast(
            `You can remove this server from your list if you no longer need access.`,
            { duration: 6000, icon: 'ℹ️' }
          );
        }
      }, 2000);
      return;
    }

    if (errorInfo.error === 'token_invalid') {
      removeServerAccessToken(host);

      if (!canAttemptTokenHeal(host)) return;

      const refreshToken = getServerRefreshToken(host);
      if (refreshToken) {
        socket.emit("token:refresh", { refreshToken });
      } else {
        removeServerRefreshToken(host);
        socket.emit("server:join", {
          nickname,
          inviteCode: serversRef.current[host]?.token || undefined,
        });
      }
      return;
    } else {
      toast.error(`Failed to join server ${host}: ${errorInfo.error}`);
    }
  });

  socket.on("server:clients", (data: Clients) => {
    setClients((old) => {
      const prev = old[host] ?? {};
      for (const [cid, client] of Object.entries(data)) {
        const prevClient = prev[cid];
        if (
          client.screenShareEnabled !== prevClient?.screenShareEnabled ||
          client.screenShareVideoStreamID !== prevClient?.screenShareVideoStreamID
        ) {
          console.log(
            `[ScreenShare] server:clients update cid=${cid} nick=${client.nickname} screenEnabled=${client.screenShareEnabled} videoStreamID=${client.screenShareVideoStreamID ?? ""}` +
            ` (was enabled=${prevClient?.screenShareEnabled} streamID=${prevClient?.screenShareVideoStreamID ?? ""})`,
          );
        }
      }
      return { ...old, [host]: data };
    });

    const myEntry = socket.id ? data[socket.id] : undefined;
    myVoiceStateByHostRef.current[host] = {
      hasJoinedChannel: !!myEntry?.hasJoinedChannel,
      voiceChannelId: myEntry?.voiceChannelId || "",
    };
    if (myEntry) {
      setIsServerMuted(!!myEntry.isServerMuted);
      setIsServerDeafened(!!myEntry.isServerDeafened);
    }
  });

  socket.on("members:list", (data: MemberInfo[]) => {
    const membersWithGrayColor = data.map(member => ({
      ...member,
      color: "var(--gray-6)"
    }));
    setMemberLists((old) => ({ ...old, [host]: membersWithGrayColor }));
  });

  socket.on("error", (msg: unknown) => {
    const text = typeof msg === "string" ? msg : ((msg as Record<string, unknown>)?.message || "Unknown socket error");
    toast.error(`[${host}] ${text}`);
  });
}
