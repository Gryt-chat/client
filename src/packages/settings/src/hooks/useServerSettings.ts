import { useCallback, useEffect, useRef, useState } from "react";
import { singletonHook } from "react-singleton-hook";

import { useUserId } from "@/common";

import { Server, Servers } from "../types/server";

interface ServerSettings {
  servers: Servers;
  setServers: (newServers: Servers) => void;
  currentlyViewingServer: Server | null;
  setCurrentlyViewingServer: (host: string | null) => void;
  lastSelectedChannels: Record<string, string>; // host -> channelId
  setLastSelectedChannel: (host: string, channelId: string) => void;
}

function serversKey(userId: string): string {
  return `servers:${userId}`;
}

function channelsKey(userId: string): string {
  return `lastSelectedChannels:${userId}`;
}

/**
 * Migrate legacy global keys to per-user keys on first sign-in after upgrade.
 * Only migrates if the per-user key doesn't already exist.
 */
function migrateGlobalToUser(userId: string): void {
  const GLOBAL_SERVERS = "servers";
  const GLOBAL_CHANNELS = "lastSelectedChannels";

  if (!localStorage.getItem(serversKey(userId))) {
    const global = localStorage.getItem(GLOBAL_SERVERS);
    if (global) {
      localStorage.setItem(serversKey(userId), global);
      localStorage.removeItem(GLOBAL_SERVERS);
    }
  }

  if (!localStorage.getItem(channelsKey(userId))) {
    const global = localStorage.getItem(GLOBAL_CHANNELS);
    if (global) {
      localStorage.setItem(channelsKey(userId), global);
      localStorage.removeItem(GLOBAL_CHANNELS);
    }
  }
}

function loadServersForUser(userId: string | null): Servers {
  if (!userId) return {};
  const raw = localStorage.getItem(serversKey(userId));
  return raw ? (JSON.parse(raw) as Servers) : {};
}

function loadChannelsForUser(userId: string | null): Record<string, string> {
  if (!userId) return {};
  const raw = localStorage.getItem(channelsKey(userId));
  return raw ? (JSON.parse(raw) as Record<string, string>) : {};
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

    migrateGlobalToUser(userId);
    userIdRef.current = userId;
    hasAutoFocused.current = false;

    const loadedServers = loadServersForUser(userId);
    const loadedChannels = loadChannelsForUser(userId);
    setServersRaw(loadedServers);
    setLastSelectedChannelsRaw(loadedChannels);
  }, [userId]);

  const updateServers = useCallback((newServers: Servers) => {
    setServersRaw(newServers);
    if (userIdRef.current) {
      localStorage.setItem(serversKey(userIdRef.current), JSON.stringify(newServers));
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
        localStorage.setItem(channelsKey(userIdRef.current), JSON.stringify(newChannels));
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
