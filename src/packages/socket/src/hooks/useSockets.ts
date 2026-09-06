import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { io, Socket } from "socket.io-client";

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
    activity,
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
  /**
   * What to do about each member's published DM key, by host and member id.
   *
   * Beside the member list rather than inside it, because they are refreshed on
   * different clocks: the list arrives from the server and this is worked out
   * locally against pins, asynchronously, after it lands.
   */
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

  // Sockets are created as soon as Keycloak has initialised, and useUserId
  // resolves the account's sub in an effect of its own — so a socket usually
  // exists before there is a userId to go with it. Everything that needs one
  // reads it from here when it runs, rather than from whatever it happened to
  // be when the socket was made (GRYT-12).
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

  /* The last self-state we told a server about, readable from a socket handler
     that was wired once and would otherwise close over whatever these were at
     the time (GRYT-644). */
  const voiceSelfStateRef = useRef({ isMuted, isDeafened, isAFK });

  /* The same trick for the status line (GRYT-929). The server keeps it on the
     connection rather than storing it, so every reconnect starts with nothing
     and this is what puts it back. */
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

  /* Told to every server, because it is one line about you rather than
     something you say per room. A server whose role does not allow it refuses
     with `server:error`, which the settings panel is where somebody would find
     out about — sending it anyway keeps this loop from having to know. */
  useEffect(() => {
    activityRef.current = activity;
    Object.keys(sockets).forEach((host) => {
      sockets[host]?.emit("presence:activity", { activity });
    });
  }, [activity, sockets]);

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

  // Both places that sync an avatar run at a moment that can arrive before
  // there is a userId, and for the owner it never is: their join is the first
  // thing that happens. Reading the ref stops them using a stale null but does
  // not help when the answer is genuinely not known yet.
  //
  // So sync again when the userId does arrive. syncAvatarToHost compares the
  // stored hash against what the host has, so a host already in sync costs one
  // hash and no upload (GRYT-12).
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

        /* The server restored the mute, deafen and AFK flags it stashed when
           this socket dropped, and its copy is only as new as the moment the
           connection broke. Nothing corrected it before GRYT-644: the emit
           above is keyed on the three flags and the sockets map, and a
           reconnect moves neither, so somebody who had unmuted during the drop
           showed as muted to the room while still being heard.
         *
         * Sent here rather than on `connect` because the stash is applied
         * during `session:restore`, and this event is the server saying it has
         * finished doing that. Sending earlier would race it and lose. */
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
          /* Also unconditionally, for the reconnect where there was no stash to
             restore — one that outlived the grace window, or landed on a
             restarted server. `voice:state:restored` never arrives in that
             case, and the member list would otherwise show the server's
             defaults rather than what this client is actually doing. */
          socket.emit("voice:state:update", voiceSelfStateRef.current);
          /* And the status, for the same reason: it lives on the connection,
             so a reconnect is a blank one until this says otherwise. Only when
             there is one — an empty emit would be a needless round trip on
             every reconnect for everybody who has never set a status. */
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

        // Find out whether this host is http or https before anything fetches
        // from it. Only the add-server flow ever recorded that, so a server
        // already in the list still had the default — and on the desktop the
        // default is plain http, which a proxied deployment answers with a
        // redirect that a preflighted request may not follow.
        //
        // The socket does not wait for it: a proxy that redirects plain http
        // will usually still take a plain WebSocket upgrade, so holding every
        // connection back for a round trip would cost startup time to fix
        // something that mostly is not broken.
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

     Approving happens in the moderator's client and the server tells nobody
     else: `server:joinRequest:decided` goes back to whoever clicked it, and the
     person waiting is not connected as a member to be told.

     A minute, because approval is a human action. Each attempt is one
     `server:join`, which the server answers from the join_requests row —
     approved lets them in and clears the row, anything else replies
     approval_pending again and nothing changes. */
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
