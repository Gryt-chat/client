import { useCallback, useEffect, useRef,useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { Server, Servers } from "../types/server";

interface ServerSettings {
  servers: Servers;
  setServers: (newServers: Servers) => void;
  currentlyViewingServer: Server | null;
  setCurrentlyViewingServer: (host: string | null) => void;
  lastSelectedChannels: Record<string, string>; // host -> channelId
  setLastSelectedChannel: (host: string, channelId: string) => void;
}

function useServerSettingsHook(): ServerSettings {
  const [servers, setServers] = useState<Servers>(
    JSON.parse(localStorage.getItem("servers") || "{}")
  );
  const [currentlyViewingServer, setCurrentlyViewingServer] = useState<Server | null>(null);
  const [lastSelectedChannels, setLastSelectedChannels] = useState<Record<string, string>>(
    JSON.parse(localStorage.getItem("lastSelectedChannels") || "{}")
  );
  const hasAutoFocused = useRef(false);

  const updateServers = useCallback((newServers: Servers) => {
    setServers(newServers);
    localStorage.setItem("servers", JSON.stringify(newServers));
  }, []);

  const updateCurrentlyViewingServer = useCallback((host: string | null) => {
    if (host === null) {
      setCurrentlyViewingServer(null);
    } else {
      setCurrentlyViewingServer((currentServer) => {
        const server = servers[host];
        if (server) {
          return server;
        } else {
          console.error("Server not found:", host);
          return currentServer;
        }
      });
    }
  }, [servers]);

  const updateLastSelectedChannel = useCallback((host: string, channelId: string) => {
    setLastSelectedChannels(prev => {
      const newChannels = { ...prev, [host]: channelId };
      localStorage.setItem("lastSelectedChannels", JSON.stringify(newChannels));
      return newChannels;
    });
  }, []);

  useEffect(() => {
    const serverKeys = Object.keys(servers);
    if (serverKeys.length > 0 && !hasAutoFocused.current) {
      const currentServers = JSON.parse(localStorage.getItem("servers") || "{}");
      const server = currentServers[serverKeys[0]];
      if (server) {
        setCurrentlyViewingServer(server);
        hasAutoFocused.current = true;
      }
    }
  }, [servers]);

  useEffect(() => {
    if (!currentlyViewingServer) return;
    const updated = servers[currentlyViewingServer.host];
    if (!updated) return;
    if (updated.name !== currentlyViewingServer.name || updated.token !== currentlyViewingServer.token) {
      setCurrentlyViewingServer(updated);
    }
  }, [servers, currentlyViewingServer]);

  return {
    servers,
    setServers: updateServers,
    currentlyViewingServer,
    setCurrentlyViewingServer: updateCurrentlyViewingServer,
    lastSelectedChannels,
    setLastSelectedChannel: updateLastSelectedChannel,
  };
}

const init: ServerSettings = {
  servers: JSON.parse(localStorage.getItem("servers") || "{}"),
  setServers: () => {},
  currentlyViewingServer: null,
  setCurrentlyViewingServer: () => {},
  lastSelectedChannels: JSON.parse(localStorage.getItem("lastSelectedChannels") || "{}"),
  setLastSelectedChannel: () => {},
};

export const useServerSettings = singletonHook(init, useServerSettingsHook);
