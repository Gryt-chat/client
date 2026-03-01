import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, type LanServer } from "@/lib/electron";

function serverKey(host: string, port: number): string {
  return `${host}:${port}`;
}

export function useLanDiscovery() {
  const [servers, setServers] = useState<Map<string, LanServer>>(new Map());
  const api = getElectronAPI();

  useEffect(() => {
    if (!api) return;

    const unsubUp = api.onLanServerDiscovered((server) => {
      setServers((prev) => {
        const key = serverKey(server.host, server.port);
        if (prev.has(key)) {
          const existing = prev.get(key)!;
          if (existing.name === server.name && existing.version === server.version) return prev;
        }
        const next = new Map(prev);
        next.set(key, server);
        return next;
      });
    });

    const unsubDown = api.onLanServerRemoved((server) => {
      setServers((prev) => {
        const key = serverKey(server.host, server.port);
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
    });

    return () => {
      unsubUp();
      unsubDown();
    };
  }, [api]);

  const lanServers = useCallback(() => Array.from(servers.values()), [servers]);

  return { lanServers: lanServers(), isElectron: !!api };
}
