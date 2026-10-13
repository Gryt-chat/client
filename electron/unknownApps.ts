/** App ids Rich Presence saw and no list could name, sent so the game list names them for everyone.
    Only the number goes, every ten minutes at most, and each id once per run of the app. */

export const UNKNOWN_APPS_URL = `${(process.env.GRYT_REPORTS_URL || "https://reports.gryt.chat").replace(/\/+$/, "")}/v1/unknown-apps`;
const FLUSH_EVERY_MS = 10 * 60 * 1000;
const MAX_PER_SEND = 20;

export interface UnknownAppQueue {
  note(appId: string): void;
  flush(): Promise<void>;
  stop(): void;
}

export function createUnknownAppQueue(opts: {
  fetchImpl?: typeof fetch;
  url?: string;
  everyMs?: number;
} = {}): UnknownAppQueue {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = opts.url ?? UNKNOWN_APPS_URL;
  const pending = new Set<string>();
  const sent = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;

  const flush = async () => {
    const ids = [...pending].slice(0, MAX_PER_SEND);
    if (!ids.length) return;
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-gryt-app": "desktop" },
        body: JSON.stringify({ ids }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return;
      for (const id of ids) {
        pending.delete(id);
        sent.add(id);
      }
    } catch {
      // Kept for the next try. Offline is ordinary.
    }
  };

  return {
    note(appId) {
      if (!/^\d{17,20}$/.test(appId) || sent.has(appId)) return;
      pending.add(appId);
      timer ??= setInterval(() => void flush(), opts.everyMs ?? FLUSH_EVERY_MS);
      timer.unref?.();
    },
    flush,
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
