import { useCallback,useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useServerSettings } from "@/settings/src/hooks/useServerSettings";
import { Server, Servers } from "@/settings/src/types/server";

interface ServerManagement {
  // State
  servers: Servers;
  currentlyViewingServer: Server | null;
  showAddServer: boolean;
  showRemoveServer: string | null;
  
  // Actions
  addServer: (server: Server, focusNewServer?: boolean) => void;
  removeServer: (host: string) => void;
  switchToServer: (host: string) => void;
  reconnectServer: (host: string) => void;
  setShowAddServer: (show: boolean) => void;
  setShowRemoveServer: (host: string | null) => void;
  
  // Utilities
  getServer: (host: string) => Server | undefined;
  getAllServers: () => Server[];
  hasServer: (host: string) => boolean;
  getServerCount: () => number;
}

function useServerManagementHook(): ServerManagement {
  const { servers, setServers, currentlyViewingServer, setCurrentlyViewingServer } = useServerSettings();
  
  const [showAddServer, setShowAddServer] = useState(false);
  const [showRemoveServer, setShowRemoveServer] = useState<string | null>(null);

  // Add a new server and optionally focus it
  const addServer = useCallback((server: Server, focusNewServer: boolean = true) => {
    // Check if server already exists and is the same
    const existingServer = servers[server.host];
    if (existingServer) {
      const nextServer: Server = {
        ...existingServer,
        ...server,
        // Only overwrite token when explicitly provided
        token: typeof server.token === "string" && server.token.length > 0 ? server.token : existingServer.token,
      };

      const unchanged =
        nextServer.name === existingServer.name &&
        nextServer.host === existingServer.host &&
        nextServer.token === existingServer.token;

      if (unchanged) {
        if (focusNewServer) {
          setCurrentlyViewingServer(existingServer.host);
        }
        return;
      }

      const newServers = { ...servers, [server.host]: nextServer };
      setServers(newServers);

      if (focusNewServer) {
        setCurrentlyViewingServer(nextServer.host);
      }

      setShowAddServer(false);
      return;
    }
    
    const newServers = { ...servers, [server.host]: server };
    setServers(newServers);
    
    // Auto-focus the newly added server if requested
    if (focusNewServer) {
      setCurrentlyViewingServer(server.host);
    }
    
    // Close the add server modal
    setShowAddServer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers, setServers, setCurrentlyViewingServer, currentlyViewingServer]);

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
    
    // Actions
    addServer,
    removeServer,
    switchToServer,
    reconnectServer,
    setShowAddServer,
    setShowRemoveServer,
    
    // Utilities
    getServer,
    getAllServers,
    hasServer,
    getServerCount,
  };
}

const init: ServerManagement = {
  // State
  servers: {},
  currentlyViewingServer: null,
  showAddServer: false,
  showRemoveServer: null,
  
  // Actions
  addServer: () => {},
  removeServer: () => {},
  switchToServer: () => {},
  reconnectServer: () => {},
  setShowAddServer: () => {},
  setShowRemoveServer: () => {},
  
  // Utilities
  getServer: () => undefined,
  getAllServers: () => [],
  hasServer: () => false,
  getServerCount: () => 0,
};

export const useServerManagement = singletonHook(init, useServerManagementHook);
