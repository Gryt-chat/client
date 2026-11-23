import { useEffect, useRef } from "react";

import { freshAccessToken, useAccount } from "@/common";

import { fetchServerInfo, useServerJoin } from "../packages/settings/src/hooks/useServerJoin";
import { useServerManagement } from "../packages/socket/src/hooks/useServerManagement";
import { CLOUD_CONSOLE_URL } from "./cloud";

const EVERY = 10 * 60_000;
const SEEN = "gryt:cloudServersSeen";
// Hosts this device has already had: one removed from the sidebar on purpose isn't added back.
const seen = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) ?? "[]") as string[] | null;
    return Array.isArray(v) ? v.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
};
const remember = (hosts: string[]) => {
  try {
    localStorage.setItem(SEEN, JSON.stringify([...new Set([...seen(), ...hosts])]));
  } catch {
    // Private windows can refuse storage; the worst case is a server added back once.
  }
};

/** Joins any Gryt Cloud server the account owns that this device doesn't have yet: at launch, when the window comes back, and every 10 minutes. */
export function useCloudServerSync() {
  const { isSignedIn } = useAccount();
  const { servers } = useServerManagement();
  const { join } = useServerJoin();
  const latest = useRef({ servers, join });
  const busy = useRef(false);
  useEffect(() => {
    latest.current = { servers, join };
    remember(Object.keys(servers));
  }, [servers, join]);

  useEffect(() => {
    if (!isSignedIn) return;
    const check = () => {
      if (busy.current) return;
      busy.current = true;
      void sync().finally(() => (busy.current = false));
    };
    const sync = async () => {
      const { servers, join } = latest.current;
      const token = await freshAccessToken().catch(() => null);
      if (!token) return;
      const r = await fetch(`${CLOUD_CONSOLE_URL}/api/app/servers`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      const hosts = ((await r?.json().catch(() => null)) as { servers?: string[] } | null)?.servers;
      if (!Array.isArray(hosts)) return;
      const known = new Set(seen());
      for (const host of hosts) {
        if (typeof host !== "string" || servers[host] || known.has(host)) continue;
        const info = await fetchServerInfo(host);
        if (info.kind === "info") await join({ host, info: info.info, focus: false });
      }
    };
    check();
    const t = setInterval(check, EVERY);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", check);
    };
  }, [isSignedIn]);
}
