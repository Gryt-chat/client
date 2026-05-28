import { isElectron } from "@/lib/electron";
import { voiceLog } from "./voiceLogger";

function isHttpsPage(): boolean {
  try {
    return typeof window !== "undefined" && window.location?.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  ) {
    return true;
  }

  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;

  const [a, b] = ipv4.slice(1).map(Number);

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;

  // Tailscale / CGNAT range. Your failing example 100.96.x.x is here.
  if (a === 100 && b >= 64 && b <= 127) return true;

  return false;
}

function parseSfuUrl(raw: string): URL | null {
  try {
    if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
      return new URL(raw);
    }

    // Use a temporary scheme so URL can parse host:port values.
    return new URL(`ws://${raw}`);
  } catch {
    return null;
  }
}

export function normalizeSfuWsUrl(raw: string): string {
  const parsed = parseSfuUrl(raw);

  if (!parsed) {
    voiceLog.warn("SFU-SELECT", `Unable to parse SFU URL, using as-is: ${raw}`);
    return raw;
  }

  const hostIsPrivate = isLocalOrPrivateHost(parsed.hostname);

  let protocol: "ws:" | "wss:";

  if (raw.startsWith("ws://")) {
    protocol = "ws:";
  } else if (raw.startsWith("wss://")) {
    // Desktop embedded/LAN/private-IP endpoints usually do not have valid TLS certs.
    // Downgrade private IPs to ws:// in Electron only.
    protocol = isElectron() && hostIsPrivate ? "ws:" : "wss:";
  } else {
    // Raw host:port.
    // Web HTTPS must use wss:// due mixed-content blocking.
    // Electron and non-HTTPS contexts can use ws:// for LAN/private endpoints.
    if (hostIsPrivate && (isElectron() || !isHttpsPage())) {
      protocol = "ws:";
    } else {
      protocol = "wss:";
    }
  }

  parsed.protocol = protocol;
  return parsed.toString();
}

function wsUrlToHealthUrl(wsUrl: string): string {
  return wsUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://")
    .replace(/\/?$/, "/health");
}

function filterWsUrlsForPage(wsUrls: string[]): string[] {
  // Browsers will block ws:// and http:// health pings when the page is loaded over HTTPS.
  // Electron is allowed to connect to LAN/private ws:// endpoints.
  if (!isHttpsPage() || isElectron()) return wsUrls;

  return wsUrls.filter((u) => !u.startsWith("ws://"));
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
  } catch {
    // quota exceeded, ignore
  }
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
 * URL whose backing server responded fastest.
 *
 * Falls back to the first URL if every ping fails or times out.
 */
export async function selectBestSfuUrl(
  wsUrls: string[],
  host?: string,
): Promise<string> {
  const originalUrls = wsUrls.map(normalizeSfuWsUrl);
  wsUrls = filterWsUrlsForPage(originalUrls);

  if (wsUrls.length === 0) {
    voiceLog.warn(
      "SFU-SELECT",
      "No SFU URLs compatible with this page context — falling back to original list",
    );
    wsUrls = originalUrls;
  }

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
      if (isHttpsPage() && !isElectron() && healthUrl.startsWith("http://")) {
        voiceLog.info("SFU-SELECT", `Skipping mixed-content ping: ${healthUrl}`);
        return null;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

      await fetch(healthUrl, {
        method: "GET",
        signal: controller.signal,
        cache: "no-store",
      });

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
        ? ` | others: ${raceResults
            .slice(1)
            .map((r) => `${r.url} ${r.latencyMs}ms`)
            .join(", ")}`
        : ""),
  );

  if (host) setCachedSfuUrl(host, best.url);

  return best.url;
}

/**
 * Fire-and-forget: run the SFU ping + cache so the result is ready when
 * the user joins a voice channel.
 * Called from the server:details handler.
 */
export function warmSfuSelection(host: string, sfuHosts: string[]) {
  if (!sfuHosts?.length) return;

  const wsUrls = sfuHosts.map(normalizeSfuWsUrl);

  voiceLog.info(
    "SFU-SELECT",
    `Warming SFU selection for ${host} (${wsUrls.length} candidates)`,
  );

  selectBestSfuUrl(wsUrls, host).catch(() => {});
}
