import { useCallback, useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { singletonHook } from "react-singleton-hook";
import { io, Socket } from "socket.io-client";

import connectMp3 from "@/audio/src/assets/connect.mp3";
import disconnectMp3 from "@/audio/src/assets/disconnect.mp3";
import { getServerAccessToken, getServerRefreshToken, getServerWsBase, getValidIdentityToken,removeServerAccessToken, removeServerRefreshToken } from "@/common";
import { useSettings } from "@/settings";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import {
  Server,
  serverDetailsList,
  Servers,
} from "@/settings/src/types/server";

import { MemberInfo } from "../components/MemberSidebar";
import { Clients } from "../types/clients";
import { useSocketEvents } from "./useSocketEvents";

type Sockets = { [host: string]: Socket };

function useSocketsHook() {
  const [sockets, setSockets] = useState<Sockets>({});
  const [tokenRevision, setTokenRevision] = useState(0);
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
  const [serverConnectionStatus, setServerConnectionStatus] = useState<Record<string, 'connected' | 'disconnected' | 'connecting' | 'reconnecting'>>({});
  const wasEverConnectedRef = useRef<Record<string, boolean>>({});
  const serverDetailsListRef = useRef(serverDetailsList);

  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    serverDetailsListRef.current = serverDetailsList;
  }, [serverDetailsList]);

  const connectSoundFile = customConnectSoundFile || connectMp3;
  const disconnectSoundFile = customDisconnectSoundFile || disconnectMp3;

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

  // Add new or update servers to the list
  useEffect(() => {
    if (newServerInfo.length > 0) {
      newServerInfo.forEach((server, index) => {
        const existingServer = servers[server.host];
        if (existingServer && existingServer.name === server.name) {
          return;
        }
        
        const newServers = { ...servers, [server.host]: server };
        setServers(newServers);
        
        if (!currentlyViewingServer && index === 0) {
          setTimeout(() => {
            setCurrentlyViewingServer(server.host);
          }, 100);
        }
      });
      
      setNewServerInfo([]);
    }
  }, [newServerInfo, servers, setServers, currentlyViewingServer, setCurrentlyViewingServer]);

  const bumpTokenRevision = useCallback(() => setTokenRevision((n) => n + 1), []);

  // Register all socket event handlers via the extracted hook
  useSocketEvents(sockets, {
    servers,
    nickname,
    connectSoundEnabled,
    disconnectSoundEnabled,
    connectSoundFile,
    disconnectSoundFile,
    connectSoundVolume,
    disconnectSoundVolume,
    serversRef,
    lastInviteJoinAttemptRef,
    setServers,
    setNewServerInfo,
    setServerDetailsList,
    setFailedServerDetails,
    setClients,
    setMemberLists,
    setServerProfiles,
    onTokenRefreshed: bumpTokenRevision,
  });

  // Create sockets for all servers
  useEffect(() => {
    const newSockets = { ...sockets };
    let changed = false;

    Object.keys(servers).forEach((host) => {
      if (!newSockets[host]) {
        const accessToken = getServerAccessToken(host);
        
        const socket = io(`${getServerWsBase(host)}`, {
          auth: {
            token: servers[host].token,
            accessToken: accessToken || undefined,
          },
        });
        
        newSockets[host] = socket;
        changed = true;
        
        setServerConnectionStatus(prev => ({ ...prev, [host]: 'connecting' }));
        const serverName = servers[host]?.name || host;
        const toastId = `conn-${host}`;
        
        socket.on("connect", () => {
          wasEverConnectedRef.current[host] = true;
          setServerConnectionStatus(prev => ({ ...prev, [host]: 'connected' }));
          socket.emit("server:info");
        });
        
        socket.on("connect_error", (error) => {
          console.error(`Connection error to server ${host}:`, error);
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
          }, 1000);
        } else {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            socket.emit("server:join", {
              password: "",
              nickname,
              identityToken,
              inviteCode: servers[host]?.token || undefined,
            });
          })();
        }
      }
    });

    if (changed) {
      setSockets(newSockets);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers]);

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
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            const inviteCode = serversRef.current[host]?.token || undefined;
            socket.emit("server:join", { password: "", nickname, identityToken, inviteCode });
          })();
        }
      }, 3_000));
    });

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sockets, serverConnectionStatus, serverDetailsList]);

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
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              if (identityToken) {
                socket.emit("token:refresh", { refreshToken, identityToken });
              } else {
                const inviteCode = serversRef.current[host]?.token || undefined;
                socket.emit("server:join", { password: "", nickname, identityToken: undefined, inviteCode });
              }
            })();
          } else {
            (async () => {
              const identityToken = await getValidIdentityToken().catch(() => undefined);
              const inviteCode = serversRef.current[host]?.token || undefined;
              socket.emit("server:join", { password: "", nickname, identityToken, inviteCode });
            })();
          }
          return;
        }

        const refreshToken = getServerRefreshToken(host);
        if (refreshToken) {
          (async () => {
            const identityToken = await getValidIdentityToken().catch(() => undefined);
            if (identityToken) {
              socket.emit("token:refresh", { refreshToken, identityToken });
            } else {
              socket.emit("token:refresh", { accessToken });
            }
          })();
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

      (async () => {
        const identityToken = await getValidIdentityToken().catch(() => undefined);
        socket.emit("server:join", {
          password: "",
          nickname,
          identityToken,
          inviteCode: token,
        });
      })();
    });
  }, [servers, sockets, nickname, serverConnectionStatus]);

  const reconnectServer = useCallback((host: string) => {
    const socket = sockets[host];
    if (socket) {
      setServerConnectionStatus(prev => ({ ...prev, [host]: 'connecting' }));
      socket.connect();
    }
  }, [sockets]);

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

  return { sockets, serverDetailsList, clients, memberLists, serverProfiles, setServerProfiles, getChannelDetails, requestMemberList, failedServerDetails, serverConnectionStatus, reconnectServer, leaveServer, tokenRevision };
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
    reconnectServer: () => {},
    leaveServer: () => {},
    tokenRevision: 0,
  },
  useSocketsHook
);
