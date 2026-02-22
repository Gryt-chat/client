import { voiceLog } from "./voiceLogger";

function wsUrlToHealthUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/?$/, "/health");
}

interface PingResult {
  url: string;
  latencyMs: number;
}

const PING_TIMEOUT_MS = 2000;
const CACHE_TTL_MS = 60_000;

interface CachedSelection {
  url: string;
  ts: number;
}

const SESSION_KEY = "gryt:sfuBest";

function getCacheMap(): Record<string, CachedSelection> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeCacheMap(map: Record<string, CachedSelection>) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(map));
  } catch { /* quota exceeded, ignore */ }
}

export function getCachedSfuUrl(host: string): string | null {
  const entry = getCacheMap()[host];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) return null;
  return entry.url;
}

function setCachedSfuUrl(host: string, url: string) {
  const map = getCacheMap();
  map[host] = { url, ts: Date.now() };
  writeCacheMap(map);
}

/**
 * Pings multiple SFU health endpoints in parallel and returns the WebSocket
 * URL whose backing server responded fastest. Falls back to the first URL
 * if every ping fails or times out.
 */
export async function selectBestSfuUrl(wsUrls: string[], host?: string): Promise<string> {
  if (wsUrls.length <= 1) {
    if (host && wsUrls[0]) setCachedSfuUrl(host, wsUrls[0]);
    return wsUrls[0];
  }

  voiceLog.info("SFU-SELECT", `Pinging ${wsUrls.length} SFU endpoints to find fastest…`);

  const raceResults: PingResult[] = [];

  const promises = wsUrls.map(async (wsUrl): Promise<PingResult | null> => {
    const healthUrl = wsUrlToHealthUrl(wsUrl);
    const start = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      await fetch(healthUrl, { method: "GET", signal: controller.signal, cache: "no-store" });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - start);
      const result = { url: wsUrl, latencyMs };
      raceResults.push(result);
      return result;
    } catch {
      voiceLog.info("SFU-SELECT", `Ping failed/timed out: ${healthUrl}`);
      return null;
    }
  });

  await Promise.allSettled(promises);

  if (raceResults.length === 0) {
    voiceLog.warn("SFU-SELECT", "All pings failed — falling back to first URL");
    return wsUrls[0];
  }

  raceResults.sort((a, b) => a.latencyMs - b.latencyMs);

  const best = raceResults[0];
  voiceLog.info(
    "SFU-SELECT",
    `Best SFU: ${best.url} (${best.latencyMs}ms)` +
      (raceResults.length > 1
        ? ` | others: ${raceResults.slice(1).map(r => `${r.url} ${r.latencyMs}ms`).join(", ")}`
        : ""),
  );

  if (host) setCachedSfuUrl(host, best.url);
  return best.url;
}

/**
 * Fire-and-forget: run the SFU ping + cache so the result is ready when
 * the user joins a voice channel.  Called from the server:details handler.
 */
export function warmSfuSelection(host: string, sfuHosts: string[]) {
  if (!sfuHosts?.length) return;
  const wsUrls = sfuHosts.map(h =>
    h.startsWith("ws://") || h.startsWith("wss://") ? h : `wss://${h}`,
  );
  voiceLog.info("SFU-SELECT", `Warming SFU selection for ${host} (${wsUrls.length} candidates)`);
  selectBestSfuUrl(wsUrls, host).catch(() => {});
}
