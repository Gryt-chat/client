import { useCallback, useEffect, useRef,useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { Server, Servers } from "../types/server";

type LastSelectedChannels = Record<string, string>;

interface ServerSettings {
  servers: Servers;
  setServers: (newServers: Servers) => void;
  currentlyViewingServer: Server | null;
  setCurrentlyViewingServer: (host: string | null) => void;
  lastSelectedChannels: LastSelectedChannels;
  setLastSelectedChannel: (host: string, channelId: string) => void;
}

function useServerSettingsHook(): ServerSettings {
  const [servers, setServers] = useState<Servers>(
    JSON.parse(localStorage.getItem("servers") || "{}")
  );
  const [lastSelectedChannels, setLastSelectedChannels] = useState<LastSelectedChannels>(
    JSON.parse(localStorage.getItem("lastSelectedChannels") || "{}")
  );
  const [currentlyViewingServer, setCurrentlyViewingServer] = useState<Server | null>(null);
  const hasAutoFocused = useRef(false);

  const updateServers = useCallback((newServers: Servers) => {
    setServers(newServers);
    localStorage.setItem("servers", JSON.stringify(newServers));
  }, []);

  const updateLastSelectedChannel = useCallback((host: string, channelId: string) => {
    setLastSelectedChannels((prev) => {
      const next = { ...prev, [host]: channelId };
      localStorage.setItem("lastSelectedChannels", JSON.stringify(next));
      return next;
    });
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
