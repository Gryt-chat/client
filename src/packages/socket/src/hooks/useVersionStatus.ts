import { useCallback, useEffect, useState } from "react";
import type { Socket } from "socket.io-client";

interface ComponentVersionInfo {
  current: string;
  latest: string;
  latestStable: string;
  latestBeta: string | null;
  updateAvailable: boolean;
  channel: "stable" | "beta";
}

export interface VersionStatus {
  server: ComponentVersionInfo;
  sfu: (ComponentVersionInfo & { current: string | null }) | null;
}

const updateFlags = new Map<string, boolean>();

export function getUpdateAvailable(host: string): boolean {
  return updateFlags.get(host) ?? false;
}

function setUpdateFlag(host: string, available: boolean) {
  const prev = updateFlags.get(host);
  updateFlags.set(host, available);
  if (prev !== available) {
    window.dispatchEvent(
      new CustomEvent("server_update_status", { detail: { host, updateAvailable: available } }),
    );
  }
}

export function useVersionStatus(
  socket: Socket | undefined,
  host: string,
  accessToken: string | null,
  enabled: boolean,
): { status: VersionStatus | null; loading: boolean } {
  const [status, setStatus] = useState<VersionStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const check = useCallback(() => {
    if (!socket || !accessToken || !enabled) return;
    setLoading(true);
    socket.emit("server:version:check", { accessToken });
  }, [socket, accessToken, enabled]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: VersionStatus) => {
      setStatus(payload);
      setLoading(false);
      const hasUpdate =
        payload.server.updateAvailable || (payload.sfu?.updateAvailable ?? false);
      setUpdateFlag(host, hasUpdate);
    };
    socket.on("server:version:status", handler);
    return () => {
      socket.off("server:version:status", handler);
    };
  }, [socket, host]);

  useEffect(() => {
    check();
  }, [check]);

  return { status, loading };
}
