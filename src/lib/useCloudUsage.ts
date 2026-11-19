import { useEffect, useState } from "react";

import { freshAccessToken, useAccount } from "@/common";

import { CLOUD_CONSOLE_URL, cloudEnabled } from "./cloud";

export type CloudUsage = {
  plan: { id: string; name: string };
  cycle: "monthly" | "yearly";
  storage: { used: number | null; limit: number };
  transfer: { sent: number | null; month: string };
  manage: string;
};

/** Plan, storage and this month's transfer for a Cloud server the signed-in account owns; null otherwise. */
export function useCloudUsage(host: string | undefined, active: boolean) {
  const { isSignedIn } = useAccount();
  const [usage, setUsage] = useState<CloudUsage | null>(null);
  useEffect(() => {
    setUsage(null);
    if (!cloudEnabled || !isSignedIn || !host || !active) return;
    let live = true;
    void (async () => {
      const token = await freshAccessToken().catch(() => null);
      if (!token) return;
      const r = await fetch(`${CLOUD_CONSOLE_URL}/api/app/servers/${encodeURIComponent(host)}/usage`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
      const u = r?.ok ? ((await r.json().catch(() => null)) as CloudUsage | null) : null;
      if (live && u?.plan && u.storage) setUsage(u);
    })();
    return () => {
      live = false;
    };
  }, [host, active, isSignedIn]);
  return usage;
}
