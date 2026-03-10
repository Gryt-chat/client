import { useCallback, useEffect, useState } from "react";

import {
  type EmbeddedServerInfo,
  type EmbeddedServerState,
  getElectronAPI,
} from "../../../../lib/electron";

const INITIAL_STATE: EmbeddedServerState = {
  status: "stopped",
  config: null,
  error: null,
  serverUrl: null,
};

export function useEmbeddedServer() {
  const api = getElectronAPI();
  const [state, setState] = useState<EmbeddedServerState>(INITIAL_STATE);
  const [info, setInfo] = useState<EmbeddedServerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoStart, setAutoStartState] = useState(false);

  useEffect(() => {
    if (!api) return;

    api.getEmbeddedServerInfo().then(setInfo).catch(console.error);
    api.getEmbeddedServerStatus().then(setState).catch(console.error);
    api.getEmbeddedServerAutoStart().then(setAutoStartState).catch(console.error);

    const unsubStatus = api.onEmbeddedServerStatusChanged(setState);
    return () => { unsubStatus(); };
  }, [api]);

  const createServer = useCallback(
    async (serverName: string, lanDiscoverable: boolean) => {
      if (!api) return;
      setLoading(true);
      try {
        const result = await api.createEmbeddedServer(serverName, lanDiscoverable);
        setState(result);
        const updatedInfo = await api.getEmbeddedServerInfo();
        setInfo(updatedInfo);
      } catch (err) {
        console.error("[EmbeddedServer] create failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [api],
  );

  const startServer = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.startEmbeddedServer();
      setState(result);
    } catch (err) {
      console.error("[EmbeddedServer] start failed:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const stopServer = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    try {
      const result = await api.stopEmbeddedServer();
      setState(result);
    } catch (err) {
      console.error("[EmbeddedServer] stop failed:", err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  const setAutoStart = useCallback((enabled: boolean) => {
    if (!api) return;
    api.setEmbeddedServerAutoStart(enabled);
    setAutoStartState(enabled);
  }, [api]);

  return {
    isAvailable: !!api && (info?.available ?? false),
    hasExistingServer: info?.hasExisting ?? false,
    existingConfig: info?.config ?? null,
    lanIp: info?.lanIp ?? "127.0.0.1",
    state,
    loading,
    autoStart,
    setAutoStart,
    createServer,
    startServer,
    stopServer,
  };
}
