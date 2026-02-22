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

/**
 * Pings multiple SFU health endpoints in parallel and returns the WebSocket
 * URL whose backing server responded fastest. Falls back to the first URL
 * if every ping fails or times out.
 */
export async function selectBestSfuUrl(wsUrls: string[]): Promise<string> {
  if (wsUrls.length <= 1) return wsUrls[0];

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

  return best.url;
}
