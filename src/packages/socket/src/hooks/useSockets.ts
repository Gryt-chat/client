import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { io, Socket } from "socket.io-client";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import { singletonHook } from "@/common";
import { getServerAccessToken, getServerRefreshToken, getServerWsBase, removeServerAccessToken, removeServerRefreshToken, useUnreadBadge, useUserId } from "@/common";
import { initKeycloak } from "@/common/src/auth/keycloak";
import { useSettings } from "@/settings";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients } from "../types/clients";
import { guardSocket, serverProofErrorMessage, serverProofHelpUrl } from "../utils/serverAuth";
import { syncAvatarToHost } from "../utils/syncAvatarToHost";
import { useSocketEvents } from "./useSocketEvents";

type Sockets = { [host: string]: Socket };

function useSocketsHook() {
  const userId = useUserId();
  const [sockets, setSockets] = useState<Sockets>({});
  const [tokenRevision, setTokenRevision] = useState(0);
  const [identityReady, setIdentityReady] = useState(false);
  const lastInviteJoinAttemptRef = useRef<Record<string, string | undefined>>({});
  const serversRef = useRef<Servers>({});
  
  const { 
    nickname,
    isMuted,
    isDeafened,
    isAFK,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundVolume,
    disconnectSoundVolume,
    customConnectSoundFile,
    customDisconnectSoundFile,
    messageSoundEnabled,
    messageSoundVolume,
    customMessageSoundFile,
    notificationBadgeEnabled,
    setIsServerMuted,
    setIsServerDeafened,
  } = useSettings();
  
  const { 
    servers, 
    setServers,
    currentlyViewingServer,
    setCurrentlyViewingServer,
  } = useServerSettings();
  const [newServerInfo, setNewServerInfo] = useState<Server[]>([]);
  const [serverDetailsList, setServerDetailsList] = useState<serverDetailsList>(
    {}
  );
  const [failedServerDetails, setFailedServerDetails] = useState<Record<string, { error: string; message: string; timestamp: number }>>({});
  const [clients, setClients] = useState<{ [host: string]: Clients }>({});
  const [memberLists, setMemberLists] = useState<{ [host: string]: MemberInfo[] }>({});
  const [serverProfiles, setServerProfiles] = useState<Record<string, { nickname: string; avatarFileId: string | null; avatarUrl: string | null }>>({});
  const [serverConnectionStatus, setServerConnectionStatus] = useState<Record<string, 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'refused'>>({});
  // Why a server was refused, so the UI can say it rather than guessing.
  const [refusalReason, setRefusalReason] = useState<Record<string, string>>({});
  // Kept beside the sentence rather than baked into it, so the card can render
  // a real link and the toast can stay plain text.
  const [refusalHelpUrl, setRefusalHelpUrl] = useState<Record<string, string>>({});
  const wasEverConnectedRef = useRef<Record<string, boolean>>({});
  const serverDetailsListRef = useRef(serverDetailsList);

  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    serverDetailsListRef.current = serverDetailsList;
  }, [serverDetailsList]);

  const { incrementUnread } = useUnreadBadge();

  const connectSoundFile = customConnectSoundFile || connectMp3;
  const disconnectSoundFile = customDisconnectSoundFile || disconnectMp3;
  const messageSoundFile = customMessageSoundFile || messageSoundMp3;

  const clientsRef = useRef(clients);
  useEffect(() => { clientsRef.current = clients; }, [clients]);

  const currentlyViewingServerRef = useRef(currentlyViewingServer);
  useEffect(() => { currentlyViewingServerRef.current = currentlyViewingServer; }, [currentlyViewingServer]);

  function getChannelDetails(host: string, channel: string) {
    return serverDetailsList[host]?.channels.find((c) => c.id === channel);
  }

  const requestMemberList = useCallback((host: string) => {
    const socket = sockets[host];
    if (socket && socket.connected) {
      socket.emit('members:fetch');
    }
  }, [sockets]);

  useEffect(() => {
    Object.keys(sockets).forEach((host) => {
      sockets[host]?.emit("voice:state:update", {
        isMuted,
        isDeafened,
        isAFK,
      });
    });
  }, [isMuted, isDeafened, isAFK, sockets]);

  // Merge incoming server:info updates into the saved list in a single write.
  // Previously each iteration spread the same stale `servers` closure, so
  // only the last server's update survived — silently dropping earlier ones.
  useEffect(() => {
    if (newServerInfo.length === 0) return;

    let updated = { ...servers };
    let changed = false;

    for (const server of newServerInfo) {
      const existing = updated[server.host];
      if (existing && existing.name === server.name) continue;
      updated = { ...updated, [server.host]: server };
      changed = true;
    }

    if (changed) setServers(updated);

    if (!currentlyViewingServer && Object.keys(updated).length > 0) {
      const first = newServerInfo[0];
      if (first) {
        setTimeout(() => setCurrentlyViewingServer(first.host), 100);
      }
    }

    setNewServerInfo([]);
  }, [newServerInfo, servers, setServers, currentlyViewingServer, setCurrentlyViewingServer]);

  const bumpTokenRevision = useCallback(() => setTokenRevision((n) => n + 1), []);

  // Wait for Keycloak to initialise before opening any server sockets.
  // This prevents racing with stale/missing identity tokens on cold start.
  useEffect(() => {
    let cancelled = false;
    initKeycloak()
      .then(() => { if (!cancelled) setIdentityReady(true); })
      .catch(() => { if (!cancelled) setIdentityReady(true); });
    return () => { cancelled = true; };
  }, []);

  // Register all socket event handlers via the extracted hook
  useSocketEvents(sockets, {
    servers,
    nickname,
    userId,
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
    onTokenRefreshed: bumpTokenRevision,
  });

  // Create sockets for all servers (only after Keycloak is ready)
  useEffect(() => {
    if (!identityReady) return;

    const newSockets = { ...sockets };
    let changed = false;

    Object.keys(servers).forEach((host) => {
      if (!newSockets[host]) {
        const serverToken = servers[host].token;

        const socket = io(`${getServerWsBase(host)}`, {
          transports: ["websocket"],
          auth: (cb: (data: Record<string, unknown>) => void) => {
            // The access token is deliberately NOT here. Handshake auth reaches
            // the server before we have checked who it is, so a server
            // impersonating this one would collect a working bearer token and
            // could replay it as this user. It goes out below, once the server
            // has proved its identity (GRYT-51).
            cb({ token: serverToken });
          },
        });

        newSockets[host] = socket;
        changed = true;

        setServerConnectionStatus(prev => ({ ...prev, [host]: 'connecting' }));
        const serverName = servers[host]?.name || host;
        const toastId = `conn-${host}`;

        // Holds everything below until the server proves itself.
        guardSocket(socket, host, (decision) => {
          // A distinct status, not 'disconnected'. This is not a network
          // problem, and telling someone the server "may be offline" when we
          // refused it on purpose sends them off debugging the wrong thing.
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'refused' }));
          setRefusalReason(prev => ({ ...prev, [host]: serverProofErrorMessage(decision) }));
          const helpUrl = serverProofHelpUrl(decision);
          if (helpUrl) setRefusalHelpUrl(prev => ({ ...prev, [host]: helpUrl }));
          toast.error(serverProofErrorMessage(decision), { id: toastId, duration: 12000 });
        });

        socket.on("connect", () => {
          wasEverConnectedRef.current[host] = true;
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'connected' }));
          const accessToken = getServerAccessToken(host);
          if (accessToken) socket.emit("session:restore", { accessToken });
          socket.emit("server:info");
        });
        
        socket.on("connect_error", (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          console.error(`[Socket] connect_error for ${host}:`, msg);
          console.debug(`[Socket] connect_error diagnostics:`, {
            host,
            transport: socket.io.engine?.transport?.name ?? "unknown",
            wasEverConnected: wasEverConnectedRef.current[host] ?? false,
            online: navigator.onLine,
          });
          if (!wasEverConnectedRef.current[host]) {
            setServerConnectionStatus(prev => ({ ...prev, [host]: 'disconnected' }));
          }
        });

        socket.on("disconnect", () => {
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'reconnecting' }));
          toast.loading(`Reconnecting to ${serverName}...`, { id: toastId });
        });

        socket.io.on("reconnect", () => {
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'connected' }));
          toast.success(`Reconnected to ${serverName}`, { id: toastId });
          socket.emit("server:details");
          socket.emit("members:fetch");
          window.dispatchEvent(new CustomEvent("server_socket_reconnected", {
            detail: { host },
          }));
        });

        socket.io.on("reconnect_failed", () => {
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'disconnected' }));
          toast.error(`Could not reconnect to ${serverName}`, { id: toastId });
        });

        // Initial join / details fetch
        const existingAccessToken = getServerAccessToken(host);
        
        if (existingAccessToken && nickname) {
          setTimeout(() => {
            socket.emit("server:details");
            socket.emit("members:fetch");
            const existingAvatarFileId = localStorage.getItem(`avatarFileId:${host}`);
            if (userId) {
              syncAvatarToHost(host, existingAccessToken, existingAvatarFileId, socket, setServerProfiles, userId)
                .catch(() => {});
            }
          }, 1000);
        } else {
          socket.emit("server:join", {
            nickname,
            inviteCode: servers[host]?.token || undefined,
          });
        }
      }
    });

    // Close sockets whose server has gone.
    //
    // This loop only ever added them, so a removed server kept a live socket
    // that reconnected on its own and re-emitted server:join — which quietly
    // undid the removal. Being kicked made that visible: the server vanished
    // from the sidebar and came straight back.
    Object.keys(newSockets).forEach((host) => {
      if (servers[host]) return;
      try {
        newSockets[host].removeAllListeners();
        newSockets[host].disconnect();
      } catch {
        // Already gone. Dropping the reference below is what matters.
      }
      delete newSockets[host];
      changed = true;
      setServerConnectionStatus((prev) => {
        const next = { ...prev };
        delete next[host];
        return next;
      });
    });

    if (changed) {
      setSockets(newSockets);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, identityReady]);

  /* Ask again, on a timer, for servers waiting on a moderator (GRYT-289).
     
     Approving a request happens in the moderator's client and the server tells
     nobody else: `server:joinRequest:decided` goes back to whoever clicked it,
     and the person waiting is not connected as a member to be told. Without
     this they would sit there until they thought to try joining again by hand,
     which is the thing the task was raised about.
     
     A minute, because approval is a human action and the cost of being a minute
     late is nothing. Each attempt is one `server:join`, which the server
     answers from the join_requests row — approved lets them in and clears the
     row, anything else replies approval_pending again and nothing changes. */
  useEffect(() => {
    const waiting = Object.keys(serversRef.current).filter(
      (host) => serversRef.current[host]?.approvalRequestedAt,
    );
    if (waiting.length === 0) return;

    const timer = setInterval(() => {
      for (const host of waiting) {
        // Cleared by `server:joined` the moment one of these works.
        if (!serversRef.current[host]?.approvalRequestedAt) continue;
        const socket = sockets[host];
        if (!socket?.connected) continue;
        socket.emit("server:join", {
          nickname,
          inviteCode: serversRef.current[host]?.token || undefined,
        });
      }
    }, 60_000);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets, servers, nickname]);

  // Retry server:join / server:details for sockets that are connected but
  // haven't received details yet.  Runs 3 s after each connection-status
  // change so we don't race the normal first-connect flow.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    Object.keys(sockets).forEach((host) => {
      const socket = sockets[host];
      if (!socket?.connected) return;
      if (serverDetailsList[host]) return; // already have details

      timers.push(setTimeout(() => {
        if (serverDetailsListRef.current[host]) return;
        const accessToken = getServerAccessToken(host);
        if (accessToken) {
          socket.emit("server:details");
        } else {
          const inviteCode = serversRef.current[host]?.token || undefined;
          socket.emit("server:join", { nickname, inviteCode });
        }
      }, 3_000));
    });

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets, serverConnectionStatus, serverDetailsList]);

  // Presence heartbeat: confirm online status to each server every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      Object.keys(sockets).forEach((host) => {
        const socket = sockets[host];
        if (socket?.connected) {
          socket.emit("presence:heartbeat");
        }
      });
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [sockets]);

  // Proactive access token refresh: run once shortly after startup, then every 4 minutes
  useEffect(() => {
    const refreshServerTokens = () => {
      Object.keys(sockets).forEach((host) => {
        const socket = sockets[host];
        if (!socket?.connected) return;
        const accessToken = getServerAccessToken(host);

        if (!accessToken) {
          const refreshToken = getServerRefreshToken(host);
          if (refreshToken) {
            socket.emit("token:refresh", { refreshToken });
          } else {
            const inviteCode = serversRef.current[host]?.token || undefined;
            socket.emit("server:join", { nickname, inviteCode });
          }
          return;
        }

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          socket.emit("token:refresh", { refreshToken });
        } else {
          socket.emit("token:refresh", { accessToken });
        }
      });
    };

    const initialTimeout = setTimeout(refreshServerTokens, 3_000);
    const interval = setInterval(refreshServerTokens, 4 * 60 * 1000);
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets]);

  // Retry join when an invite token is updated or a socket reconnects
  useEffect(() => {
    Object.keys(servers).forEach((host) => {
      const token = servers[host]?.token;
      if (!token) return;
      if (!nickname) return;

      if (serverConnectionStatus[host] !== "connected") return;

      const socket = sockets[host];
      if (!socket || !socket.connected) return;

      const existingAccessToken = getServerAccessToken(host);
      if (existingAccessToken) return;

      const lastAttemptToken = lastInviteJoinAttemptRef.current[host];
      if (lastAttemptToken === token) return;
      lastInviteJoinAttemptRef.current[host] = token;

      socket.emit("server:join", {
        nickname,
        inviteCode: token,
      });
    });
  }, [servers, sockets, nickname, serverConnectionStatus]);

  const reconnectServer = useCallback((host: string) => {
    const socket = sockets[host];
    if (!socket) return;

    const requestServerState = async () => {
      const accessToken = getServerAccessToken(host);

      if (accessToken && serverDetailsListRef.current[host]) {
        socket.emit("server:details");
        socket.emit("members:fetch");
        return;
      }

      removeServerAccessToken(host);
      const inviteCode = serversRef.current[host]?.token || undefined;
      socket.emit("server:join", { nickname, inviteCode });
    };

    if (socket.connected) {
      void requestServerState();
      return;
    }

    setServerConnectionStatus((prev) => ({ ...prev, [host]: "connecting" }));
    socket.connect();
    socket.once("connect", () => {
      void requestServerState();
    });
  }, [sockets, nickname]);

  // When returning to the app after being idle, re-request server details if we are connected
  // but never received details (prevents being stuck on the skeleton forever).
  useEffect(() => {
    const refreshIfStuck = () => {
      Object.keys(sockets).forEach((host) => {
        const socket = sockets[host];
        if (!socket?.connected) return;
        if (serverDetailsListRef.current[host]) return;
        if (failedServerDetails[host]) return;

        const accessToken = getServerAccessToken(host);
        if (accessToken) {
          socket.emit("server:details");
          socket.emit("members:fetch");
          return;
        }

        const inviteCode = serversRef.current[host]?.token || undefined;
        socket.emit("server:join", { nickname, inviteCode });
      });
    };

    const onVisibilityChange = () => {
      if (!document.hidden) refreshIfStuck();
    };

    window.addEventListener("focus", refreshIfStuck);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshIfStuck);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [sockets, nickname, failedServerDetails]);

  const leaveServer = (host: string) => {
    const socket = sockets[host];
    if (socket) {
      socket.emit('server:leave');
      
      socket.once('server:left', () => {
        toast.success(`Left server ${host}`);
        removeServerAccessToken(host);
        removeServerRefreshToken(host);
      });
      
      socket.once('server:error', (error: string) => {
        toast.error(`Failed to leave server: ${error}`);
      });
    } else {
      toast.error(`Not connected to server ${host}`);
    }
  };

  return { sockets, serverDetailsList, clients, memberLists, serverProfiles, setServerProfiles, getChannelDetails, requestMemberList, failedServerDetails, serverConnectionStatus, refusalReason, refusalHelpUrl, reconnectServer, leaveServer, tokenRevision };
}

export const useSockets = singletonHook(
  {
    sockets: {},
    serverDetailsList: {},
    clients: {},
    memberLists: {},
    serverProfiles: {},
    setServerProfiles: () => {},
    getChannelDetails: () => undefined,
    requestMemberList: () => {},
    failedServerDetails: {},
    serverConnectionStatus: {},
    refusalReason: {},
    refusalHelpUrl: {},
    reconnectServer: () => {},
    leaveServer: () => {},
    tokenRevision: 0,
  },
  useSocketsHook
);
