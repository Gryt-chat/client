import { useCallback, useEffect, useRef, useState } from "react";

import { singletonHook } from "@/common";
import { useUserId } from "@/common";

import { orderServerHosts } from "../serverOrder";
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
  /** Drop the remembered channel for addresses that are going away. */
  forgetLastSelectedChannels: (hosts: string[]) => void;
  serverOrder: string[];
  setServerOrder: (order: string[]) => void;
  dismissedLanServers: string[];
  dismissLanServer: (key: string) => void;
  undismissLanServer: (key: string) => void;
  seenLanServers: string[];
  markLanServersSeen: (keys: string[]) => void;
}

function useServerSettingsHook(): ServerSettings {
  const userId = useUserId();
  const userIdRef = useRef(userId);
  const [servers, setServersRaw] = useState<Servers>({});
  const [currentlyViewingServer, setCurrentlyViewingServer] = useState<Server | null>(null);
  const [lastSelectedChannels, setLastSelectedChannelsRaw] = useState<Record<string, string>>({});
  const [serverOrder, setServerOrderRaw] = useState<string[]>([]);
  const [dismissedLanServers, setDismissedLanServersRaw] = useState<string[]>([]);
  const [seenLanServers, setSeenLanServersRaw] = useState<string[]>([]);
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
      setServerOrderRaw(getUserValue<string[]>("serverOrder", []));
      setDismissedLanServersRaw(getUserValue<string[]>("dismissedLanServers", []));
      setSeenLanServersRaw(getUserValue<string[]>("seenLanServers", []));
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

  const forgetLastSelectedChannels = useCallback((hosts: string[]) => {
    setLastSelectedChannelsRaw(prev => {
      const next = { ...prev };
      let changed = false;
      for (const host of hosts) {
        if (host in next) {
          delete next[host];
          changed = true;
        }
      }
      if (!changed) return prev;
      if (userIdRef.current) {
        setUserValue("lastSelectedChannels", next);
      }
      return next;
    });
  }, []);

  const updateServerOrder = useCallback((order: string[]) => {
    setServerOrderRaw(order);
    if (userIdRef.current) {
      setUserValue("serverOrder", order);
    }
  }, []);

  const dismissLanServer = useCallback((key: string) => {
    setDismissedLanServersRaw((prev) => {
      if (prev.includes(key)) return prev;
      const next = [...prev, key];
      if (userIdRef.current) setUserValue("dismissedLanServers", next);
      return next;
    });
  }, []);

  const undismissLanServer = useCallback((key: string) => {
    setDismissedLanServersRaw((prev) => {
      if (!prev.includes(key)) return prev;
      const next = prev.filter((k) => k !== key);
      if (userIdRef.current) setUserValue("dismissedLanServers", next);
      return next;
    });
  }, []);

  /**
   * Remember which discovered servers have been looked at.
   *
   * This is what the rail badge is counted against. It accumulates rather than
   * being replaced, so a server that drops off the network and comes back is
   * not announced twice — the badge is meant to say "there is something here
   * you have not seen", and a machine rebooting is not that.
   */
  const markLanServersSeen = useCallback((keys: string[]) => {
    setSeenLanServersRaw((prev) => {
      const missing = keys.filter((key) => !prev.includes(key));
      if (missing.length === 0) return prev;
      const next = [...prev, ...missing];
      if (userIdRef.current) setUserValue("seenLanServers", next);
      return next;
    });
  }, []);

  /**
   * Open whatever is at the top of the rail (GRYT-642).
   *
   * This used to take `Object.keys(servers)[0]`, which is the order servers
   * were added in. Dragging one to the top of the rail therefore changed where
   * it appeared and not what opened.
   *
   * `pendingFocusServer` in useServerManagement runs after this and still wins,
   * so a deep link opens what it names rather than the top of the rail.
   */
  useEffect(() => {
    if (hasAutoFocused.current) return;

    const [topHost] = orderServerHosts(servers, serverOrder);
    if (!topHost) return;

    const server = servers[topHost];
    if (!server) return;

    setCurrentlyViewingServer(server);
    hasAutoFocused.current = true;
  }, [servers, serverOrder]);

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
    forgetLastSelectedChannels,
    serverOrder,
    setServerOrder: updateServerOrder,
    dismissedLanServers,
    dismissLanServer,
    undismissLanServer,
    seenLanServers,
    markLanServersSeen,
  };
}

const init: ServerSettings = {
  servers: {},
  setServers: () => {},
  currentlyViewingServer: null,
  setCurrentlyViewingServer: () => {},
  lastSelectedChannels: {},
  setLastSelectedChannel: () => {},
  forgetLastSelectedChannels: () => {},
  serverOrder: [],
  setServerOrder: () => {},
  dismissedLanServers: [],
  dismissLanServer: () => {},
  undismissLanServer: () => {},
  seenLanServers: [],
  markLanServersSeen: () => {},
};

export const useServerSettings = singletonHook(init, useServerSettingsHook);
