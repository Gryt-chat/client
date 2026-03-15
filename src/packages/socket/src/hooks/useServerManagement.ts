import { useCallback, useEffect, useMemo, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { normalizeHost } from "@/common";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import { Server, Servers } from "@/settings/src/types/server";

import { type LanServer } from "../../../../lib/electron";

interface ServerManagement {
  servers: Servers;
  currentlyViewingServer: Server | null;
  showAddServer: boolean;
  showRemoveServer: string | null;
  orderedServerHosts: string[];
  pendingLanServers: LanServer[];

  addServer: (server: Server, focusNewServer?: boolean) => void;
  removeServer: (host: string) => void;
  switchToServer: (host: string) => void;
  reconnectServer: (host: string) => void;
  reorderServers: (orderedHosts: string[]) => void;
  setShowAddServer: (show: boolean) => void;
  setShowRemoveServer: (host: string | null) => void;
  dismissLanServer: (key: string) => void;

  getServer: (host: string) => Server | undefined;
  getAllServers: () => Server[];
  hasServer: (host: string) => boolean;
  getServerCount: () => number;
  getLastSelectedChannel: (host: string) => string | null;
  setLastSelectedChannelForServer: (host: string, channelId: string) => void;
}

function lanServerAddr(s: LanServer): string {
  return s.port === 443 ? s.host : `${s.host}:${s.port}`;
}

function useServerManagementHook(): ServerManagement {
  const {
    servers,
    setServers,
    currentlyViewingServer,
    setCurrentlyViewingServer,
    lastSelectedChannels,
    setLastSelectedChannel,
    serverOrder,
    setServerOrder,
    dismissedLanServers,
    dismissLanServer,
  } = useServerSettings();

  const { lanServers } = useLanDiscovery();

  const [showAddServer, setShowAddServer] = useState(false);
  const [showRemoveServer, setShowRemoveServer] = useState<string | null>(null);
  const [pendingFocusServer, setPendingFocusServer] = useState<string | null>(
    null
  );

  const findServerById = useCallback(
    (serverId?: string): [string, Server] | null => {
      if (!serverId) return null;

      const entry = Object.entries(servers).find(
        ([, server]) => !!server.serverId && server.serverId === serverId
      );

      return entry ?? null;
    },
    [servers]
  );

  const pendingLanServers = useMemo(() => {
    return lanServers.filter((s) => {
      const addr = lanServerAddr(s);
      const normalized = normalizeHost(addr);
      const key = `${s.host}:${s.port}`;

      if (servers[normalized]) return false;
      if (dismissedLanServers.includes(key)) return false;

      if (s.serverId) {
        const existingById = Object.values(servers).some(
          (server) => !!server.serverId && server.serverId === s.serverId
        );
        if (existingById) return false;
      }

      return true;
    });
  }, [lanServers, servers, dismissedLanServers]);

  const orderedServerHosts = useMemo(() => {
    const allHosts = Object.keys(servers);
    const ordered: string[] = [];

    for (const host of serverOrder) {
      if (allHosts.includes(host)) ordered.push(host);
    }

    for (const host of allHosts) {
      if (!ordered.includes(host)) ordered.push(host);
    }

    return ordered;
  }, [servers, serverOrder]);

  const reorderServers = useCallback(
    (orderedHosts: string[]) => {
      setServerOrder(orderedHosts);
    },
    [setServerOrder]
  );

  useEffect(() => {
    if (pendingFocusServer && servers[pendingFocusServer]) {
      setCurrentlyViewingServer(pendingFocusServer);
      setPendingFocusServer(null);
    }
  }, [servers, pendingFocusServer, setCurrentlyViewingServer]);

  const addServer = useCallback(
    (incomingServer: Server, focusNewServer: boolean = true) => {
      const normalizedHost = normalizeHost(incomingServer.host);
      const normalizedIncoming: Server = {
        ...incomingServer,
        host: normalizedHost,
      };

      const existingByHost = servers[normalizedHost];
      if (existingByHost) {
        const nextServer: Server = {
          ...existingByHost,
          ...normalizedIncoming,
          token:
            typeof normalizedIncoming.token === "string" &&
            normalizedIncoming.token.length > 0
              ? normalizedIncoming.token
              : existingByHost.token,
          serverId:
            normalizedIncoming.serverId &&
            normalizedIncoming.serverId.length > 0
              ? normalizedIncoming.serverId
              : existingByHost.serverId,
        };

        const unchanged =
          nextServer.name === existingByHost.name &&
          nextServer.host === existingByHost.host &&
          nextServer.token === existingByHost.token &&
          nextServer.serverId === existingByHost.serverId;

        if (unchanged) {
          if (focusNewServer) setCurrentlyViewingServer(existingByHost.host);
          setShowAddServer(false);
          return;
        }

        const newServers = { ...servers, [normalizedHost]: nextServer };
        setServers(newServers);

        if (focusNewServer) setCurrentlyViewingServer(nextServer.host);
        setShowAddServer(false);
        return;
      }

      const existingById = findServerById(normalizedIncoming.serverId);
      if (existingById) {
        const [existingHost, existingServer] = existingById;

        const mergedServer: Server = {
          ...existingServer,
          name: normalizedIncoming.name || existingServer.name,
          token:
            typeof normalizedIncoming.token === "string" &&
            normalizedIncoming.token.length > 0
              ? normalizedIncoming.token
              : existingServer.token,
          serverId:
            normalizedIncoming.serverId &&
            normalizedIncoming.serverId.length > 0
              ? normalizedIncoming.serverId
              : existingServer.serverId,
          host: existingHost,
        };

        const newServers = {
          ...servers,
          [existingHost]: mergedServer,
        };

        setServers(newServers);

        if (focusNewServer) setCurrentlyViewingServer(existingHost);
        setShowAddServer(false);
        return;
      }

      const newServers = { ...servers, [normalizedHost]: normalizedIncoming };
      setServers(newServers);

      if (focusNewServer) {
        setPendingFocusServer(normalizedHost);
      }

      setShowAddServer(false);
    },
    [servers, setServers, setCurrentlyViewingServer, findServerById]
  );

  const removeServer = useCallback(
    (host: string) => {
      const normalizedHost = normalizeHost(host);
      const newServers = { ...servers };
      delete newServers[normalizedHost];
      setServers(newServers);

      if (currentlyViewingServer?.host === normalizedHost) {
        const remainingServers = Object.values(newServers) as Server[];
        if (remainingServers.length > 0) {
          setCurrentlyViewingServer(remainingServers[0].host);
        } else {
          setCurrentlyViewingServer(null);
        }
      }

      setShowRemoveServer(null);
    },
    [servers, setServers, currentlyViewingServer, setCurrentlyViewingServer]
  );

  const switchToServer = useCallback(
    (host: string) => {
      const normalizedHost = normalizeHost(host);
      if (!servers[normalizedHost]) {
        console.error(
          "Cannot switch to server - server not found:",
          normalizedHost
        );
        return;
      }

      setCurrentlyViewingServer(normalizedHost);
    },
    [setCurrentlyViewingServer, servers]
  );

  const getServer = useCallback(
    (host: string): Server | undefined => {
      return servers[normalizeHost(host)];
    },
    [servers]
  );

  const getAllServers = useCallback((): Server[] => {
    return Object.values(servers);
  }, [servers]);

  const hasServer = useCallback(
    (host: string): boolean => {
      return normalizeHost(host) in servers;
    },
    [servers]
  );

  const getServerCount = useCallback((): number => {
    return Object.keys(servers).length;
  }, [servers]);

  const getLastSelectedChannel = useCallback(
    (host: string): string | null => {
      return lastSelectedChannels[normalizeHost(host)] || null;
    },
    [lastSelectedChannels]
  );

  const setLastSelectedChannelForServer = useCallback(
    (host: string, channelId: string) => {
      setLastSelectedChannel(normalizeHost(host), channelId);
    },
    [setLastSelectedChannel]
  );

  const reconnectServer = useCallback(
    (host: string) => {
      const normalizedHost = normalizeHost(host);
      if (!servers[normalizedHost]) {
        console.error(
          "Cannot reconnect to server - server not found:",
          normalizedHost
        );
        return;
      }
    },
    [servers]
  );

  return {
    servers,
    currentlyViewingServer,
    showAddServer,
    showRemoveServer,
    orderedServerHosts,
    pendingLanServers,

    addServer,
    removeServer,
    switchToServer,
    reconnectServer,
    reorderServers,
    setShowAddServer,
    setShowRemoveServer,
    dismissLanServer,

    getServer,
    getAllServers,
    hasServer,
    getServerCount,
    getLastSelectedChannel,
    setLastSelectedChannelForServer,
  };
}

const init: ServerManagement = {
  servers: {},
  currentlyViewingServer: null,
  showAddServer: false,
  showRemoveServer: null,
  orderedServerHosts: [],
  pendingLanServers: [],

  addServer: () => {},
  removeServer: () => {},
  switchToServer: () => {},
  reconnectServer: () => {},
  reorderServers: () => {},
  setShowAddServer: () => {},
  setShowRemoveServer: () => {},
  dismissLanServer: () => {},

  getServer: () => undefined,
  getAllServers: () => [],
  hasServer: () => false,
  getServerCount: () => 0,
  getLastSelectedChannel: () => null,
  setLastSelectedChannelForServer: () => {},
};

export const useServerManagement = singletonHook(init, useServerManagementHook);
