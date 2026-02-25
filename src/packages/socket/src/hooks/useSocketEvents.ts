import { Dispatch, MutableRefObject, SetStateAction, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { Socket } from "socket.io-client";

import {
  getServerRefreshToken,
  getValidIdentityToken,
  removeServerAccessToken,
  removeServerRefreshToken,
  setServerAccessToken,
} from "@/common";
import { playNotificationSound, preloadNotificationSound } from "@/lib/notificationSound";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients } from "../types/clients";
import { registerServerSocketEvents } from "./registerServerSocketEvents";

type Sockets = { [host: string]: Socket };

export interface SocketEventDeps {
  servers: Servers;
  nickname: string;
  connectSoundEnabled: boolean;
  disconnectSoundEnabled: boolean;
  connectSoundFile: string;
  disconnectSoundFile: string;
  connectSoundVolume: number;
  disconnectSoundVolume: number;
  messageSoundEnabled: boolean;
  messageSoundVolume: number;
  messageSoundFile: string;
  notificationBadgeEnabled: boolean;
  incrementUnread: () => void;
  currentlyViewingServerRef: MutableRefObject<{ host: string; name: string } | null>;
  clientsRef: MutableRefObject<{ [host: string]: Clients }>;
  serversRef: MutableRefObject<Servers>;
  lastInviteJoinAttemptRef: MutableRefObject<Record<string, string | undefined>>;
  setServers: (servers: Servers) => void;
  setNewServerInfo: Dispatch<SetStateAction<Server[]>>;
  setServerDetailsList: Dispatch<SetStateAction<serverDetailsList>>;
  setFailedServerDetails: Dispatch<SetStateAction<Record<string, { error: string; message: string; timestamp: number }>>>;
  setClients: Dispatch<SetStateAction<{ [host: string]: Clients }>>;
  setMemberLists: Dispatch<SetStateAction<{ [host: string]: MemberInfo[] }>>;
  setServerProfiles: Dispatch<SetStateAction<Record<string, { nickname: string; avatarFileId: string | null; avatarUrl: string | null }>>>;
  setIsServerMuted: (value: boolean) => void;
  setIsServerDeafened: (value: boolean) => void;
  onTokenRefreshed: () => void;
}

export function useSocketEvents(sockets: Sockets, deps: SocketEventDeps) {
  const registeredRef = useRef<Set<string>>(new Set());
  const myVoiceStateByHostRef = useRef<Record<string, { hasJoinedChannel: boolean; voiceChannelId: string }>>({});

  const {
    servers,
    nickname,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundFile,
    disconnectSoundFile,
    connectSoundVolume,
    disconnectSoundVolume,
    messageSoundEnabled,
    messageSoundVolume,
    messageSoundFile,
    notificationBadgeEnabled,
    incrementUnread,
    currentlyViewingServerRef,
    clientsRef,
    serversRef,
    lastInviteJoinAttemptRef,
    setServers,
    setNewServerInfo,
    setServerDetailsList,
    setFailedServerDetails,
    setClients,
    setMemberLists,
    setServerProfiles,
    setIsServerMuted,
    setIsServerDeafened,
    onTokenRefreshed,
  } = deps;

  const connectSoundEnabledRef = useRef(connectSoundEnabled);
  const disconnectSoundEnabledRef = useRef(disconnectSoundEnabled);
  const connectSoundFileRef = useRef(connectSoundFile);
  const disconnectSoundFileRef = useRef(disconnectSoundFile);
  const connectSoundVolumeRef = useRef(connectSoundVolume);
  const disconnectSoundVolumeRef = useRef(disconnectSoundVolume);
  const messageSoundEnabledRef = useRef(messageSoundEnabled);
  const messageSoundVolumeRef = useRef(messageSoundVolume);
  const messageSoundFileRef = useRef(messageSoundFile);
  const notificationBadgeEnabledRef = useRef(notificationBadgeEnabled);
  const incrementUnreadRef = useRef(incrementUnread);
  const onTokenRefreshedRef = useRef(onTokenRefreshed);

  useEffect(() => { connectSoundEnabledRef.current = connectSoundEnabled; }, [connectSoundEnabled]);
  useEffect(() => { disconnectSoundEnabledRef.current = disconnectSoundEnabled; }, [disconnectSoundEnabled]);
  useEffect(() => { connectSoundFileRef.current = connectSoundFile; preloadNotificationSound(connectSoundFile); }, [connectSoundFile]);
  useEffect(() => { disconnectSoundFileRef.current = disconnectSoundFile; preloadNotificationSound(disconnectSoundFile); }, [disconnectSoundFile]);
  useEffect(() => { connectSoundVolumeRef.current = connectSoundVolume; }, [connectSoundVolume]);
  useEffect(() => { disconnectSoundVolumeRef.current = disconnectSoundVolume; }, [disconnectSoundVolume]);
  useEffect(() => { messageSoundEnabledRef.current = messageSoundEnabled; }, [messageSoundEnabled]);
  useEffect(() => { messageSoundVolumeRef.current = messageSoundVolume; }, [messageSoundVolume]);
  useEffect(() => { messageSoundFileRef.current = messageSoundFile; preloadNotificationSound(messageSoundFile); }, [messageSoundFile]);
  useEffect(() => { notificationBadgeEnabledRef.current = notificationBadgeEnabled; }, [notificationBadgeEnabled]);
  useEffect(() => { incrementUnreadRef.current = incrementUnread; }, [incrementUnread]);
  useEffect(() => { onTokenRefreshedRef.current = onTokenRefreshed; }, [onTokenRefreshed]);

  useEffect(() => {
    Object.entries(sockets).forEach(([host, socket]) => {
      if (registeredRef.current.has(host)) return;
      registeredRef.current.add(host);

      // ---- Voice / stream events ----

      socket.on("voice:error", (error: { type: string; message: string; existingConnection?: unknown }) => {
        if (error.type === "duplicate_connection") {
          toast.error(error.message);
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "duplicate_connection" },
          }));
        }
      });

      socket.on("voice:device:disconnect", (data: { type: string; message: string; newDevice?: unknown }) => {
        if (data.type === "device_switch") {
          window.dispatchEvent(new CustomEvent("voice:device:disconnect", {
            detail: { message: data.message, newDevice: data.newDevice },
          }));
        }
      });

      socket.on("voice:channel:joined", (hasJoined: boolean) => {
        if (!hasJoined) {
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "server_initiated" },
          }));
        }
      });

      socket.on("voice:stream:set", (streamID: string) => {
        if (!streamID) {
          window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
            detail: { host, reason: "stream_cleared" },
          }));
        }
      });

      socket.on("voice:room:leave", () => {
        window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
          detail: { host, reason: "room_leave" },
        }));
      });

      socket.on("voice:kicked", (data: { reason?: string }) => {
        toast.error(data?.reason || "You were disconnected from voice by an admin.");
        window.dispatchEvent(new CustomEvent("server_voice_disconnect", {
          detail: { host, reason: "kicked" },
        }));
      });

      socket.on("server:muted", (data: { muted: boolean }) => {
        setIsServerMuted(data.muted);
        toast(data.muted ? "You have been server muted by an admin." : "Your server mute has been removed.", {
          icon: data.muted ? "🔇" : "🔊",
        });
      });

      socket.on("server:deafened", (data: { deafened: boolean }) => {
        setIsServerDeafened(data.deafened);
        toast(data.deafened ? "You have been server deafened by an admin." : "Your server deafen has been removed.", {
          icon: data.deafened ? "🔇" : "🔊",
        });
      });

      // ---- Token lifecycle ----

      socket.on("token:refreshed", (refreshInfo: { accessToken: string }) => {
        setServerAccessToken(host, refreshInfo.accessToken);
        onTokenRefreshedRef.current();

        setServerDetailsList(prev => {
          if (!prev[host]) {
            socket.emit("server:details");
            socket.emit("members:fetch");
          }
          return prev;
        });
      });

      socket.on("token:revoked", (info: { reason?: string; message?: string }) => {
        removeServerAccessToken(host);

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            if (identityToken) {
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              removeServerRefreshToken(host);
              if (info?.message) toast.error(info.message);
              socket.emit("server:join", { nickname, identityToken: undefined, inviteCode: servers[host]?.token || undefined });
            }
          })();
        } else {
          if (info?.message) toast.error(info.message);
          setTimeout(() => {
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              socket.emit("server:join", { nickname, identityToken, inviteCode: servers[host]?.token || undefined });
            })();
          }, 300);
        }
      });

      socket.on("token:invalid", (message: string) => {
        removeServerAccessToken(host);
        removeServerRefreshToken(host);
        toast.error(`Session expired: ${message}`);
        setTimeout(() => window.location.reload(), 2000);
      });

      socket.on("token:error", (errorInfo: { error: string; message?: string }) => {
        console.error(`Token error for server ${host}:`, errorInfo);
        removeServerAccessToken(host);

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            if (identityToken) {
              console.log(`[Auth:Socket] token:error for ${host} — attempting refresh with refresh token`);
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              removeServerRefreshToken(host);
              const msg = errorInfo.message || errorInfo.error;
              toast.error(`Auth failed for ${host}: ${msg}`);
            }
          })();
        } else {
          removeServerRefreshToken(host);
          const msg = errorInfo.message || errorInfo.error;
          toast.error(`Auth failed for ${host}: ${msg}`);
        }
      });

      // ---- Peer join/leave sound notifications ----

      socket.on("voice:peer:joined", (payload: { clientId: string; nickname: string; channelId?: string }) => {
        if (!connectSoundEnabledRef.current) return;
        if (!payload?.channelId) return;
        if (payload.clientId === socket.id) return;
        const mine = myVoiceStateByHostRef.current[host];
        if (mine && (!mine.hasJoinedChannel || payload.channelId !== mine.voiceChannelId)) return;
        playNotificationSound(connectSoundFileRef.current, connectSoundVolumeRef.current);
      });

      socket.on("voice:peer:left", (payload: { clientId: string; nickname: string; channelId?: string }) => {
        if (!disconnectSoundEnabledRef.current) return;
        if (!payload?.channelId) return;
        if (payload.clientId === socket.id) return;
        const mine = myVoiceStateByHostRef.current[host];
        if (mine && (!mine.hasJoinedChannel || payload.channelId !== mine.voiceChannelId)) return;
        playNotificationSound(disconnectSoundFileRef.current, disconnectSoundVolumeRef.current);
      });

      // ---- Background chat notification (non-focused servers) ----

      socket.on("chat:new", (msg: { sender_server_id: string }) => {
        if (host === currentlyViewingServerRef.current?.host) return;
        const myId = socket.id ? clientsRef.current[host]?.[socket.id]?.serverUserId : undefined;
        if (myId && msg.sender_server_id === myId) return;
        if (messageSoundEnabledRef.current) {
          playNotificationSound(messageSoundFileRef.current, messageSoundVolumeRef.current);
        }
        if (notificationBadgeEnabledRef.current) {
          incrementUnreadRef.current();
        }
      });

      // ---- Server management events (delegated) ----

      registerServerSocketEvents(socket, host, {
        nickname,
        servers,
        serversRef,
        lastInviteJoinAttemptRef,
        myVoiceStateByHostRef,
        setServers,
        setNewServerInfo,
        setServerDetailsList,
        setFailedServerDetails,
        setClients,
        setMemberLists,
        setServerProfiles,
        setIsServerMuted,
        setIsServerDeafened,
      });
    });

    for (const host of registeredRef.current) {
      if (!sockets[host]) {
        registeredRef.current.delete(host);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets]);
}
