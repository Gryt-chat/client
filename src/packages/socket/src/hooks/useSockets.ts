import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { io, Socket } from "socket.io-client";

import { deliverPluginMessage, setPluginApiMessageSender } from "@/addons";
import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import messageSoundMp3 from "@/audio/src/assets/universfield-computer-mouse-click-02-383961.mp3";
import type { MemberKeyState } from "@/common";
import { singletonHook } from "@/common";
import { ensureSchemeKnown, getServerAccessToken, getServerRefreshToken, getServerWsBase, removeServerAccessToken, removeServerRefreshToken, useUnreadBadge, useUserId } from "@/common";
import { initKeycloak } from "@/common/src/auth/keycloak";
import { useSettings } from "@/settings";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients, ServerProfile } from "../types/clients";
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
    /* `activity` is the typed line the settings field edits; this is the one
       servers are told. */
    effectiveActivity: activity,
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
    desktopNotificationsEnabled,
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
  /** Beside the member list rather than inside it: the list arrives from the
      server and this is worked out locally against pins, after it lands. */
  const [memberKeyStates, setMemberKeyStates] = useState<{
    [host: string]: Record<string, MemberKeyState>;
  }>({});
  const [serverProfiles, setServerProfiles] = useState<Record<string, ServerProfile>>({});
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

  // A socket usually exists before there is a userId, so everything that needs
  // one reads it here when it runs rather than at socket creation.
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  function getChannelDetails(host: string, channel: string) {
    return serverDetailsList[host]?.channels.find((c) => c.id === channel);
  }

  const requestMemberList = useCallback((host: string) => {
    const socket = sockets[host];
    if (socket && socket.connected) {
      socket.emit('members:fetch');
    }
  }, [sockets]);

  /* Readable from a socket handler that was wired once and would otherwise close
     over whatever these were at the time. */
  const voiceSelfStateRef = useRef({ isMuted, isDeafened, isAFK });

  /* The server keeps the status on the connection, so every reconnect starts
     with nothing and this is what puts it back. */
  const activityRef = useRef(activity);

  useEffect(() => {
    voiceSelfStateRef.current = { isMuted, isDeafened, isAFK };

    Object.keys(sockets).forEach((host) => {
      sockets[host]?.emit("voice:state:update", {
        isMuted,
        isDeafened,
        isAFK,
      });
    });
  }, [isMuted, isDeafened, isAFK, sockets]);

  /* Every server, since it is one line about you rather than per room. A refusal
     surfaces in settings, so this loop does not have to know. */
  useEffect(() => {
    activityRef.current = activity;
    Object.keys(sockets).forEach((host) => {
      sockets[host]?.emit("presence:activity", { activity });
    });
  }, [activity, sockets]);

  /* Here because this is where the sockets and tokens are. A server running no
     plugin with this id drops it, so every server is the right default. */
  useEffect(() => {
    setPluginApiMessageSender((pluginId, topic, data, host) => {
      const hosts = host ? [host] : Object.keys(sockets);
      for (const target of hosts) {
        const socket = sockets[target];
        if (!socket?.connected) continue;
        const accessToken = getServerAccessToken(target);
        /* No token means not joined. The server would refuse it, and refusing
           here saves a round trip and the log line it would write. */
        if (!accessToken) continue;
        socket.emit("plugin:message", { accessToken, pluginId, topic, data });
      }
    });
    return () => setPluginApiMessageSender(null);
  }, [sockets]);

  // One write: spreading the same stale closure per iteration meant only the
  // last server's update survived.
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

  // Both avatar syncs can run before there is a userId, so this runs again when
  // one arrives. A host already in sync costs one hash and no upload.
  useEffect(() => {
    if (!userId) return;

    for (const host of Object.keys(sockets)) {
      const accessToken = getServerAccessToken(host);
      if (!accessToken) continue;

      syncAvatarToHost(
        host,
        accessToken,
        localStorage.getItem(`avatarFileId:${host}`),
        sockets[host],
        setServerProfiles,
        userId,
      ).catch(() => {});
    }
  }, [userId, sockets]);

  // Register all socket event handlers via the extracted hook
  useSocketEvents(sockets, {
    servers,
    nickname,
    userIdRef,
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
    desktopNotificationsEnabled,
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
    setMemberKeyStates,
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
            // Not the access token: handshake auth arrives before the server has
            // proved itself, so an impostor would collect a working one.
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
          // Not 'disconnected': saying a server "may be offline" when we refused
          // it on purpose sends somebody debugging the wrong thing.
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

        /* Routed by the id the server stamped, so one server's plugin cannot
           reach another's listeners. `data` is unvalidated and typed `unknown`. */
        socket.on("plugin:message", (payload: { pluginId?: unknown; topic?: unknown; data?: unknown }) => {
          const pluginId = typeof payload?.pluginId === "string" ? payload.pluginId : "";
          const topic = typeof payload?.topic === "string" ? payload.topic : "";
          if (!pluginId || !topic) return;
          deliverPluginMessage(pluginId, { host, topic, data: payload?.data });
        });

        /* The restored flags are only as new as the moment the connection broke.
           Here rather than on `connect`: this event says the stash was applied. */
        socket.on("voice:state:restored", () => {
          socket.emit("voice:state:update", voiceSelfStateRef.current);
          if (activityRef.current) {
            socket.emit("presence:activity", { activity: activityRef.current });
          }
        });

        socket.io.on("reconnect", () => {
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'connected' }));
          toast.success(`Reconnected to ${serverName}`, { id: toastId });
          socket.emit("server:details");
          socket.emit("members:fetch");
          /* Unconditionally too, for a reconnect with no stash to restore, where
             `voice:state:restored` never arrives at all. */
          socket.emit("voice:state:update", voiceSelfStateRef.current);
          /* The status lives on the connection, so a reconnect is blank until
             this. Only when there is one, or it is a round trip for nothing. */
          if (activityRef.current) {
            socket.emit("presence:activity", { activity: activityRef.current });
          }
          window.dispatchEvent(new CustomEvent("server_socket_reconnected", {
            detail: { host },
          }));
        });

        socket.io.on("reconnect_failed", () => {
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'disconnected' }));
          toast.error(`Could not reconnect to ${serverName}`, { id: toastId });
        });

        // Only the add-server flow recorded the scheme, so an existing entry still
        // has the default. The socket does not wait: the upgrade usually works.
        const schemeKnown = ensureSchemeKnown(host).catch(() => undefined);

        // Initial join / details fetch
        const existingAccessToken = getServerAccessToken(host);
        
        if (existingAccessToken && nickname) {
          setTimeout(() => {
            socket.emit("server:details");
            socket.emit("members:fetch");
            const existingAvatarFileId = localStorage.getItem(`avatarFileId:${host}`);
            const currentUserId = userIdRef.current;
            if (currentUserId) {
              schemeKnown
                .then(() => syncAvatarToHost(host, existingAccessToken, existingAvatarFileId, socket, setServerProfiles, currentUserId))
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

    // This loop only ever added them, so a removed server kept a socket that
    // reconnected and re-emitted `server:join`, undoing the removal.
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

  /* The decision goes back to whoever clicked it, and the person waiting is not
     connected to be told. A minute, because approval is a human action. */
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
  }, [sockets, servers, nickname]);

  // For sockets connected without details. Three seconds after a status change,
  // so it does not race the normal first-connect flow.
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

/**
   * Removed on `server:left`, because removing it first closes the socket and the
   * emit goes nowhere. A server that does not answer keeps its entry.
   */
  const leaveServer = (host: string) => {
    const socket = sockets[host];
    if (!socket) {
      toast.error(`Not connected to ${host}, so it cannot be told you are leaving.`);
      return;
    }

    const toastId = `leave-${host}`;
    toast.loading(`Leaving ${host}...`, { id: toastId });

    let settled = false;
    const finish = () => {
      settled = true;
      socket.off("server:left", onLeft);
      socket.off("server:error", onError);
      clearTimeout(timer);
    };

    const onLeft = () => {
      if (settled) return;
      finish();
      removeServerAccessToken(host);
      removeServerRefreshToken(host);
      toast.success(`Left ${host}`, { id: toastId });
      // The sidebar entry lives in useServerManagement, which this layer cannot
      // reach. Same event a kick uses, and it does the same job.
      window.dispatchEvent(new CustomEvent("server_force_remove", { detail: { host } }));
    };

    // The global handler reports everything as a join problem, and this person is
    // already in. An older server sends a bare string, so one is taken as this.
    const LEAVE_ERRORS = ["owner_cannot_leave", "leave_failed", "not_registered"];
    const onError = (info: { error?: string; message?: string } | string) => {
      if (settled) return;
      if (typeof info !== "string" && !LEAVE_ERRORS.includes(info?.error ?? "")) {
        socket.once("server:error", onError);
        return;
      }
      const message =
        typeof info === "string" ? info : info?.message || "The server refused.";
      finish();
      toast.error(message, { id: toastId, duration: 8000 });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      finish();
      toast.error(
        `${host} did not answer, so you are still a member. Try again, or remove it from the sidebar.`,
        { id: toastId, duration: 8000 },
      );
    }, 8000);

    socket.once("server:left", onLeft);
    socket.once("server:error", onError);
    socket.emit("server:leave");
  };

  return { sockets, serverDetailsList, clients, memberLists, memberKeyStates, serverProfiles, setServerProfiles, getChannelDetails, requestMemberList, failedServerDetails, serverConnectionStatus, refusalReason, refusalHelpUrl, reconnectServer, leaveServer, tokenRevision };
}

export const useSockets = singletonHook(
  {
    sockets: {},
    serverDetailsList: {},
    clients: {},
    memberLists: {},
    memberKeyStates: {},
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
