import { useCallback, useEffect, useState } from "react";

import { getElectronAPI, type LanServer } from "../../../../lib/electron";

function serverKey(host: string, port: number): string {
  return `${host}:${port}`;
}

export function useLanDiscovery() {
  const [servers, setServers] = useState<Map<string, LanServer>>(new Map());
  const api = getElectronAPI();

  // Seed from what the main process already knows. Discovery announces a
  // server once, when it first appears, so a hook mounting later would
  // otherwise show nothing until the network changed.
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    api
      .getLanServers()
      .then((existing) => {
        if (cancelled) return;
        setServers((prev) => {
          const next = new Map(prev);
          for (const server of existing) {
            next.set(serverKey(server.host, server.port), server);
          }
          return next;
        });
      })
      .catch(() => {
        // Discovery not running is not an error worth surfacing — the
        // subscription below still picks up anything that appears later.
      });

    return () => {
      cancelled = true;
    };
  }, [api]);

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

  /** Ask the network again. Results arrive through the existing subscription. */
  const rescan = useCallback(() => {
    setServers(new Map());
    api?.rescanLanServers();
  }, [api]);

  return { lanServers: lanServers(), isElectron: !!api, rescan };
}
