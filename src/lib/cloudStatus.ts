import { useEffect, useState } from "react";

import { CLOUD_CONSOLE_URL } from "./cloud";

/** What cloud.gryt.chat knows about one of its servers, when the server itself can't say. */
export type CloudStatus = { state: "live" | "paused" | "deleted" | "down" | "unknown"; name?: string; reason?: "cancelled" | "payment"; until?: string; deleted_on?: string };

/** Only Gryt Cloud addresses are asked about, so a self-hosted address never goes to Gryt. */
export const isCloudHost = (host: string) => /\.gryt\.host$/i.test(host);

export async function cloudStatus(host: string, signal?: AbortSignal): Promise<CloudStatus | null> {
  if (!isCloudHost(host)) return null;
  const r = await fetch(`${CLOUD_CONSOLE_URL}/api/public/servers/${encodeURIComponent(host.toLowerCase())}`, { signal }).catch(() => null);
  if (!r || (!r.ok && r.status !== 404)) return null;
  return (await r.json().catch(() => null)) as CloudStatus | null;
}

export function useCloudStatus(host: string, enabled = true): CloudStatus | null {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void cloudStatus(host, abort.signal).then((s) => !abort.signal.aborted && setStatus(s));
    return () => abort.abort();
  }, [host, enabled]);
  return enabled ? status : null;
}

export const cloudDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** One line for the join dialog, or null when the console has nothing to add. */
export function cloudStatusLine(s: CloudStatus | null, fallbackName: string): string | null {
  const name = s?.name || fallbackName;
  if (s?.state === "deleted") return `${name} was ${s.reason === "payment" ? "closed" : "closed by its owner"}. It was deleted on ${cloudDay(s.deleted_on ?? "")}.`;
  if (s?.state === "paused") return `${name} is paused. ${s.reason === "payment" ? "Its plan wasn’t renewed." : "Its owner cancelled it."}`;
  if (s?.state === "down") return `${name} is down on Gryt Cloud’s side. It comes back by itself.`;
  return null;
}
