import { useEffect, useRef } from "react";

import { freshAccessToken, useAccount } from "@/common";

import { fetchServerInfo, useServerJoin } from "../packages/settings/src/hooks/useServerJoin";
import { useServerManagement } from "../packages/socket/src/hooks/useServerManagement";
import { CLOUD_CONSOLE_URL, cloudEnabled } from "./cloud";

/** On sign-in, join any Gryt Cloud server the account owns that this device doesn't have yet. Once per session. */
export function useCloudServerSync() {
  const { isSignedIn } = useAccount();
  const { servers } = useServerManagement();
  const { join } = useServerJoin();
  const done = useRef(false);

  useEffect(() => {
    if (!cloudEnabled || !isSignedIn || done.current) return;
    done.current = true;
    void (async () => {
      const token = await freshAccessToken().catch(() => null);
      if (!token) return;
      const r = await fetch(`${CLOUD_CONSOLE_URL}/api/app/servers`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      const hosts = ((await r?.json().catch(() => null)) as { servers?: string[] } | null)?.servers;
      if (!Array.isArray(hosts)) return;
      for (const host of hosts) {
        if (typeof host !== "string" || servers[host]) continue;
        const info = await fetchServerInfo(host);
        if (info.kind === "info") await join({ host, info: info.info, focus: false });
      }
    })();
  }, [isSignedIn, servers, join]);
}
