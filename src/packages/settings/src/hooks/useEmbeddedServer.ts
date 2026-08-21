import { useCallback, useEffect, useState } from "react";

import {
  type EmbeddedServerState,
  getElectronAPI,
} from "../../../../lib/electron";

/**
 * Every server this machine hosts, and the controls for each one.
 *
 * Was a single server's worth of state, because only one could exist. The list
 * is the shape now — one SFU serves all of them, so a second costs a server
 * process and an image worker rather than a whole stack.
 */
export function useEmbeddedServer() {
  const api = getElectronAPI();
  const [servers, setServers] = useState<EmbeddedServerState[]>([]);
  const [available, setAvailable] = useState(false);
  const [lanIp, setLanIp] = useState("127.0.0.1");
  /** Ids with a call in flight, so one server's spinner is not all of them. */
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [autoStart, setAutoStartState] = useState<Record<string, boolean>>({});

  const markBusy = useCallback((id: string, on: boolean) => {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refreshAutoStart = useCallback(
    async (list: EmbeddedServerState[]) => {
      if (!api) return;
      const entries = await Promise.all(
        list.map(
          async (s) => [s.id, await api.getEmbeddedServerAutoStart(s.id)] as const,
        ),
      );
      setAutoStartState(Object.fromEntries(entries));
    },
    [api],
  );

  useEffect(() => {
    if (!api) return;

    api
      .getEmbeddedServerInfo()
      .then((info) => {
        setAvailable(info.available);
        setLanIp(info.lanIp);
        setServers(info.servers);
        void refreshAutoStart(info.servers);
      })
      .catch(console.error);

    const unsubStatus = api.onEmbeddedServerStatusChanged((next) => {
      setServers(next);

      // Only when the set of servers changes, not on every status change. A
      // server starting emits twice on its own and this is one IPC round trip
      // per server — refetching an autostart flag that cannot have moved.
      setAutoStartState((prev) => {
        const known = Object.keys(prev);
        const missing = next.filter((s) => !known.includes(s.id));
        if (missing.length > 0) void refreshAutoStart(next);
        return prev;
      });
    });

    return () => {
      unsubStatus();
    };
  }, [api, refreshAutoStart]);

  const createServer = useCallback(
    async (serverName: string, lanDiscoverable: boolean, port?: number) => {
      if (!api) return null;
      setCreating(true);
      try {
        const created = await api.createEmbeddedServer(
          serverName,
          lanDiscoverable,
          port,
        );
        const info = await api.getEmbeddedServerInfo();
        setServers(info.servers);
        void refreshAutoStart(info.servers);
        return created;
      } catch (err) {
        console.error("[EmbeddedServer] create failed:", err);
        return null;
      } finally {
        setCreating(false);
      }
    },
    [api, refreshAutoStart],
  );

  const startServer = useCallback(
    async (id: string) => {
      if (!api) return;
      markBusy(id, true);
      try {
        await api.startEmbeddedServer(id);
      } catch (err) {
        console.error("[EmbeddedServer] start failed:", err);
      } finally {
        markBusy(id, false);
      }
    },
    [api, markBusy],
  );

  const stopServer = useCallback(
    async (id: string) => {
      if (!api) return;
      markBusy(id, true);
      try {
        await api.stopEmbeddedServer(id);
      } catch (err) {
        console.error("[EmbeddedServer] stop failed:", err);
      } finally {
        markBusy(id, false);
      }
    },
    [api, markBusy],
  );

  const updateAdvertisedAddresses = useCallback(
    async (id: string, addresses: string[]) => {
      if (!api) return false;
      markBusy(id, true);
      try {
        const updated = await api.updateEmbeddedServerAdvertisedAddresses(
          id,
          addresses,
        );
        if (!updated) return false;
        setServers((current) =>
          current.map((server) => (server.id === id ? updated : server)),
        );
        return true;
      } catch (err) {
        console.error("[EmbeddedServer] address update failed:", err);
        return false;
      } finally {
        markBusy(id, false);
      }
    },
    [api, markBusy],
  );

  /**
   * Change a server's ports.
   *
   * Returns the error text rather than a boolean, because every way this fails
   * is something the person can act on — a port in use, a number out of range,
   * the server still running — and "didn't work" would waste that.
   */
  const updatePorts = useCallback(
    async (
      id: string,
      ports: { serverPort?: number; sfuPort?: number; mediaPort?: number },
    ): Promise<string | null> => {
      if (!api) return "Not available";
      markBusy(id, true);
      try {
        const updated = await api.updateEmbeddedServerPorts(id, ports);
        if (!updated) return "That server no longer exists";
        setServers((current) =>
          current.map((server) => (server.id === id ? updated : server)),
        );
        return null;
      } catch (err) {
        console.error("[EmbeddedServer] port update failed:", err);
        return err instanceof Error ? err.message : "Could not change the ports";
      } finally {
        markBusy(id, false);
      }
    },
    [api, markBusy],
  );

  // Clearing a failure the user has read. Deliberately not stopServer: that
  // preserves the error status on purpose, so dismissing through it did nothing.
  const dismissError = useCallback(
    async (id: string) => {
      if (!api) return;
      try {
        await api.dismissEmbeddedServerError(id);
      } catch (err) {
        console.error("[EmbeddedServer] dismiss failed:", err);
      }
    },
    [api],
  );

  const deleteServer = useCallback(
    async (id: string) => {
      if (!api) return;
      markBusy(id, true);
      try {
        const next = await api.deleteEmbeddedServer(id);
        setServers(next);
        setAutoStartState((prev) => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
        });
      } catch (err) {
        console.error("[EmbeddedServer] delete failed:", err);
      } finally {
        markBusy(id, false);
      }
    },
    [api, markBusy],
  );

  /** A free port to offer, found the same way the server will bind it. */
  const suggestPort = useCallback(async () => {
    if (!api) return null;
    try {
      return await api.suggestEmbeddedServerPort();
    } catch {
      return null;
    }
  }, [api]);

  /** Whether a port somebody typed is actually free. */
  const checkPort = useCallback(
    async (port: number) => {
      if (!api) return false;
      try {
        return await api.checkEmbeddedServerPort(port);
      } catch {
        return false;
      }
    },
    [api],
  );

  const setAutoStart = useCallback(
    (id: string, enabled: boolean) => {
      if (!api) return;
      api.setEmbeddedServerAutoStart(id, enabled);
      setAutoStartState((prev) => ({ ...prev, [id]: enabled }));
    },
    [api],
  );

  return {
    isAvailable: !!api && available,
    hasExistingServer: servers.length > 0,
    servers,
    lanIp,
    creating,
    isBusy: (id: string) => busy.has(id),
    autoStart,
    setAutoStart,
    createServer,
    suggestPort,
    checkPort,
    startServer,
    stopServer,
    updateAdvertisedAddresses,
    updatePorts,
    deleteServer,
    dismissError,
  };
}
