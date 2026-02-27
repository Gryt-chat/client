import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useUserId } from "@/common";

import { Server, Servers } from "../types/server";
import {
  getUserValue,
  loadForUser,
  setUserValue,
} from "./userStorage";

interface ServerSettings {
  servers: Servers;
  setServers: (newServers: Servers) => void;
  currentlyViewingServer: Server | null;
  setCurrentlyViewingServer: (host: string | null) => void;
  lastSelectedChannels: Record<string, string>;
  setLastSelectedChannel: (host: string, channelId: string) => void;
}

function useServerSettingsHook(): ServerSettings {
  const userId = useUserId();
  const userIdRef = useRef(userId);
  const [servers, setServersRaw] = useState<Servers>({});
  const [currentlyViewingServer, setCurrentlyViewingServer] = useState<Server | null>(null);
  const [lastSelectedChannels, setLastSelectedChannelsRaw] = useState<Record<string, string>>({});
  const hasAutoFocused = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    userIdRef.current = userId;
    hasAutoFocused.current = false;

    (async () => {
      await loadForUser(userId);
      if (cancelled) return;

      const loaded = getUserValue<Servers>("servers", {});
      console.log("[ServerSettings] Loaded servers for", userId, "→", Object.keys(loaded).length, "servers:", Object.keys(loaded).join(", "));
      setServersRaw(loaded);
      setLastSelectedChannelsRaw(getUserValue<Record<string, string>>("lastSelectedChannels", {}));
    })();

    return () => { cancelled = true; };
  }, [userId]);

  const updateServers = useCallback((newServers: Servers) => {
    setServersRaw(newServers);
    if (userIdRef.current) {
      setUserValue("servers", newServers);
    } else {
      console.warn("[ServerSettings] updateServers: skipped persist — userIdRef not set yet, count:", Object.keys(newServers).length);
    }
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
    setLastSelectedChannelsRaw(prev => {
      const newChannels = { ...prev, [host]: channelId };
      if (userIdRef.current) {
        setUserValue("lastSelectedChannels", newChannels);
      }
      return newChannels;
    });
  }, []);

  useEffect(() => {
    const serverKeys = Object.keys(servers);
    if (serverKeys.length > 0 && !hasAutoFocused.current) {
      const server = servers[serverKeys[0]];
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
  servers: {},
  setServers: () => {},
  currentlyViewingServer: null,
  setCurrentlyViewingServer: () => {},
  lastSelectedChannels: {},
  setLastSelectedChannel: () => {},
};

export const useServerSettings = singletonHook(init, useServerSettingsHook);
