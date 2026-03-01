import { useCallback, useEffect, useMemo, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { normalizeHost } from "@/common";
import { useLanDiscovery } from "@/settings/src/hooks/useLanDiscovery";
import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import { Server, Servers } from "@/settings/src/types/server";

import { type LanServer } from "../../../../lib/electron";

interface ServerManagement {
  // State
  servers: Servers;
  currentlyViewingServer: Server | null;
  showAddServer: boolean;
  showRemoveServer: string | null;
  orderedServerHosts: string[];
  pendingLanServers: LanServer[];
  
  // Actions
  addServer: (server: Server, focusNewServer?: boolean) => void;
  removeServer: (host: string) => void;
  switchToServer: (host: string) => void;
  reconnectServer: (host: string) => void;
  reorderServers: (orderedHosts: string[]) => void;
  setShowAddServer: (show: boolean) => void;
  setShowRemoveServer: (host: string | null) => void;
  dismissLanServer: (key: string) => void;
  
  // Utilities
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
  const { servers, setServers, currentlyViewingServer, setCurrentlyViewingServer, lastSelectedChannels, setLastSelectedChannel, serverOrder, setServerOrder, dismissedLanServers, dismissLanServer } = useServerSettings();
  const { lanServers } = useLanDiscovery();
  
  const [showAddServer, setShowAddServer] = useState(false);
  const [showRemoveServer, setShowRemoveServer] = useState<string | null>(null);
  const [pendingFocusServer, setPendingFocusServer] = useState<string | null>(null);

  const pendingLanServers = useMemo(() => {
    return lanServers.filter((s) => {
      const addr = lanServerAddr(s);
      const normalized = normalizeHost(addr);
      const key = `${s.host}:${s.port}`;
      return !servers[normalized] && !dismissedLanServers.includes(key);
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

  const reorderServers = useCallback((orderedHosts: string[]) => {
    setServerOrder(orderedHosts);
  }, [setServerOrder]);

  // Handle pending server focus after servers state is updated
  useEffect(() => {
    if (pendingFocusServer && servers[pendingFocusServer]) {
      setCurrentlyViewingServer(pendingFocusServer);
      setPendingFocusServer(null);
    }
  }, [servers, pendingFocusServer, setCurrentlyViewingServer]);

  // Add a new server and optionally focus it
  const addServer = useCallback((server: Server, focusNewServer: boolean = true) => {
    const existingServer = servers[server.host];
    if (existingServer) {
      const nextServer: Server = {
        ...existingServer,
        ...server,
        token: typeof server.token === "string" && server.token.length > 0 ? server.token : existingServer.token,
      };

      const unchanged =
        nextServer.name === existingServer.name &&
        nextServer.host === existingServer.host &&
        nextServer.token === existingServer.token;

      if (unchanged) {
        if (focusNewServer) setCurrentlyViewingServer(existingServer.host);
        return;
      }

      const newServers = { ...servers, [server.host]: nextServer };
      setServers(newServers);
      if (focusNewServer) setCurrentlyViewingServer(nextServer.host);
      setShowAddServer(false);
      return;
    }

    const newServers = { ...servers, [server.host]: server };
    setServers(newServers);

    if (focusNewServer) {
      setPendingFocusServer(server.host);
    }

    setShowAddServer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, setServers, setCurrentlyViewingServer, currentlyViewingServer, setPendingFocusServer]);

  // Remove a server
  const removeServer = useCallback((host: string) => {
    const newServers = { ...servers };
    delete newServers[host];
    setServers(newServers);
    
    // If we're currently viewing the removed server, switch to the first available server
    if (currentlyViewingServer?.host === host) {
      const remainingServers = Object.values(newServers) as Server[];
      if (remainingServers.length > 0) {
        setCurrentlyViewingServer(remainingServers[0].host);
      } else {
        setCurrentlyViewingServer(null);
      }
    }
    
    // Close the remove server modal
    setShowRemoveServer(null);
  }, [servers, setServers, currentlyViewingServer, setCurrentlyViewingServer]);

  // Switch to a specific server
  const switchToServer = useCallback((host: string) => {
    if (!servers[host]) {
      console.error("Cannot switch to server - server not found:", host);
      return;
    }
    
    setCurrentlyViewingServer(host);
    
    // Don't clear the remove server modal when switching - let the user decide
    // The modal should only be cleared when explicitly closed or confirmed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setCurrentlyViewingServer, servers, currentlyViewingServer]);

  // Get server by host
  const getServer = useCallback((host: string): Server | undefined => {
    return servers[host];
  }, [servers]);

  // Get all servers
  const getAllServers = useCallback((): Server[] => {
    return Object.values(servers);
  }, [servers]);

  // Check if a server exists
  const hasServer = useCallback((host: string): boolean => {
    return host in servers;
  }, [servers]);

  // Get server count
  const getServerCount = useCallback((): number => {
    return Object.keys(servers).length;
  }, [servers]);

  // Get last selected channel for a server
  const getLastSelectedChannel = useCallback((host: string): string | null => {
    return lastSelectedChannels[host] || null;
  }, [lastSelectedChannels]);

  // Set last selected channel for a server
  const setLastSelectedChannelForServer = useCallback((host: string, channelId: string) => {
    setLastSelectedChannel(host, channelId);
  }, [setLastSelectedChannel]);

  // Reconnect to a specific server
  const reconnectServer = useCallback((host: string) => {
    if (!servers[host]) {
      console.error("Cannot reconnect to server - server not found:", host);
      return;
    }
    
    // The socket will automatically attempt to reconnect when we call connect()
    // This is handled by the useSockets hook
  }, [servers]);

  return {
    // State
    servers,
    currentlyViewingServer,
    showAddServer,
    showRemoveServer,
    orderedServerHosts,
    pendingLanServers,
    
    // Actions
    addServer,
    removeServer,
    switchToServer,
    reconnectServer,
    reorderServers,
    setShowAddServer,
    setShowRemoveServer,
    dismissLanServer,
    
    // Utilities
    getServer,
    getAllServers,
    hasServer,
    getServerCount,
    getLastSelectedChannel,
    setLastSelectedChannelForServer,
  };
}

const init: ServerManagement = {
  // State
  servers: {},
  currentlyViewingServer: null,
  showAddServer: false,
  showRemoveServer: null,
  orderedServerHosts: [],
  pendingLanServers: [],
  
  // Actions
  addServer: () => {},
  removeServer: () => {},
  switchToServer: () => {},
  reconnectServer: () => {},
  reorderServers: () => {},
  setShowAddServer: () => {},
  setShowRemoveServer: () => {},
  dismissLanServer: () => {},
  
  // Utilities
  getServer: () => undefined,
  getAllServers: () => [],
  hasServer: () => false,
  getServerCount: () => 0,
  getLastSelectedChannel: () => null,
  setLastSelectedChannelForServer: () => {},
};

export const useServerManagement = singletonHook(init, useServerManagementHook);
